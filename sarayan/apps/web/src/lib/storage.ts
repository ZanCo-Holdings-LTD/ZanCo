import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, features } from "./env";

/**
 * Document storage.
 *
 * Two backends: S3-compatible object storage (region-pinned, the production
 * path) and the local filesystem (development and single-node deployments).
 * Both write ciphertext — files are encrypted with a per-tenant key before they
 * leave this process, so the object store never holds a readable passport.
 */

// ---------------------------------------------------------------------------
// Per-tenant encryption
// ---------------------------------------------------------------------------

/**
 * Generate a data key for a new tenant, returned wrapped by the master key.
 *
 * Per-tenant keys are the difference between "one bucket policy mistake" and
 * "one bucket policy mistake exposes every customer's passports".
 */
export function createWrappedDataKey(): string {
  const dataKey = randomBytes(32);
  return wrapKey(dataKey);
}

function masterKey(): Buffer {
  const configured = env.masterEncryptionKey;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) {
      throw new Error("MASTER_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
    }
    return key;
  }
  if (env.isProduction) {
    throw new Error("MASTER_ENCRYPTION_KEY is required in production.");
  }
  // Development only: derived, stable, and useless to anyone who obtains it,
  // because it is published right here in the source.
  return createHash("sha256").update("sarayan-development-master-key").digest();
}

function wrapKey(dataKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), wrapped.toString("base64")].join(".");
}

function unwrapKey(wrapped: string): Buffer {
  const [ivB64, tagB64, dataB64] = wrapped.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed wrapped data key.");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
}

export function encryptBytes(plaintext: Uint8Array, wrappedDataKey: string): Buffer {
  const key = unwrapKey(wrappedDataKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // iv ‖ tag ‖ ciphertext — self-describing, so decryption needs only the key.
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBytes(payload: Uint8Array, wrappedDataKey: string): Buffer {
  const buffer = Buffer.from(payload);
  const key = unwrapKey(wrappedDataKey);
  const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]);
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

export interface StoredObject {
  key: string;
  bytes: number;
}

export function storageKeyFor(organisationId: string, recordId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-80);
  return `org/${organisationId}/records/${recordId}/${randomBytes(8).toString("hex")}-${safe}`;
}

export async function putObject(
  key: string,
  plaintext: Uint8Array,
  wrappedDataKey: string,
): Promise<StoredObject> {
  const ciphertext = encryptBytes(plaintext, wrappedDataKey);
  if (features.objectStorage) {
    await s3Request("PUT", key, ciphertext);
  } else {
    const target = localPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, ciphertext);
  }
  return { key, bytes: plaintext.byteLength };
}

export async function getObject(key: string, wrappedDataKey: string): Promise<Buffer> {
  const ciphertext = features.objectStorage
    ? Buffer.from(await s3Request("GET", key))
    : await readFile(localPath(key));
  return decryptBytes(ciphertext, wrappedDataKey);
}

export async function deleteObject(key: string): Promise<void> {
  if (features.objectStorage) {
    await s3Request("DELETE", key);
    return;
  }
  await unlink(localPath(key)).catch(() => undefined);
}

function localPath(key: string): string {
  const base = path.resolve(process.cwd(), env.storage.localDir);
  const resolved = path.resolve(base, key);
  // Storage keys are generated internally, but path traversal is cheap to rule out.
  if (!resolved.startsWith(base + path.sep)) throw new Error("Invalid storage key.");
  return resolved;
}

// ---------------------------------------------------------------------------
// Minimal SigV4 S3 client
// ---------------------------------------------------------------------------

/**
 * Signed directly rather than via the AWS SDK: three verbs against one bucket
 * does not justify a 20 MB dependency, and this works unchanged against S3,
 * Cloudflare R2, Backblaze B2 and any other SigV4 endpoint — which matters when
 * a customer demands in-country hosting.
 */
async function s3Request(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer): Promise<ArrayBuffer> {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = env.storage;
  if (!bucket || !accessKeyId || !secretAccessKey) throw new Error("Object storage is not configured.");

  const host = endpoint
    ? new URL(endpoint).host
    : `${bucket}.s3.${region}.amazonaws.com`;
  const canonicalUri = endpoint
    ? `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`
    : `/${key.split("/").map(encodeURIComponent).join("/")}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256")
    .update(body ?? Buffer.alloc(0))
    .digest("hex");

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signature = hmacChain(secretAccessKey, dateStamp, region, stringToSign);

  const response = await fetch(`https://${host}${canonicalUri}`, {
    method,
    headers: {
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...(body ? { "content-length": String(body.byteLength) } : {}),
    },
    body: body ? new Uint8Array(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Storage ${method} failed with ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.arrayBuffer();
}

function hmacChain(secret: string, dateStamp: string, region: string, stringToSign: string): string {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  return createHmac("sha256", kSigning).update(stringToSign).digest("hex");
}
