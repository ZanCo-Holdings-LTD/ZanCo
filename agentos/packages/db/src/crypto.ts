/**
 * Column-level encryption for document numbers.
 *
 * AgentOS holds licence numbers, passport numbers, Emirates IDs and iqama
 * numbers for thousands of people across several jurisdictions. Saudi PDPL and
 * UAE data protection expectations are not theoretical, and a GCC B2B buyer
 * asks about this earlier in the sale than a UK one does. So these values are
 * encrypted in the column, not merely in the disk volume.
 *
 * Three properties are worth calling out, because each closes a specific hole:
 *
 *   Keys live in the worker. The web app's environment schema does not contain
 *   the key material at all — it obtains ciphertext from the worker over an
 *   internal endpoint. A compromised web process cannot decrypt the table.
 *
 *   Ciphertext is bound to its context. The org id and column name are the AEAD
 *   associated data, so a ciphertext lifted out of one firm's row and pasted
 *   into another's fails to decrypt rather than silently succeeding.
 *
 *   Lookup does not require decryption. A separate HMAC blind index lets
 *   "find the entity with licence DL-123456" run as an indexed equality search.
 *   The index is salted per-org, so the same passport number under two
 *   different firms produces two different indexes and the table cannot be used
 *   to correlate a person across customers.
 *
 * Envelope format: `v1.<keyId>.<iv>.<tag>.<ciphertext>`, base64url throughout.
 * The version prefix is checked by a database constraint, so a plaintext value
 * written by a code path that skipped this module is rejected by Postgres.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ENVELOPE_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class EncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionConfigError';
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

export interface EncryptionContext {
  /** Binds the ciphertext to one organisation. */
  readonly orgId: string;
  /** Binds it to one column, e.g. `licences.number`. */
  readonly field: string;
}

export interface KeyRing {
  readonly activeKeyId: string;
  /** All keys, including retired ones, so old rows still decrypt. */
  readonly keys: ReadonlyMap<string, Buffer>;
  readonly blindIndexKey: Buffer;
}

function decodeKey(value: string, label: string): Buffer {
  let raw: Buffer;
  try {
    raw = Buffer.from(value, 'base64');
  } catch {
    throw new EncryptionConfigError(`${label} is not valid base64`);
  }
  if (raw.length !== KEY_BYTES) {
    throw new EncryptionConfigError(
      `${label} must decode to ${KEY_BYTES} bytes, got ${raw.length}`,
    );
  }
  return raw;
}

/**
 * Build a key ring from environment values.
 *
 * `keys` is `id:base64,id:base64` so that a rotation can add a key without
 * losing the ability to read rows written under the old one. `activeKeyId`
 * selects which key new writes use.
 */
export function createKeyRing(input: {
  keys: string;
  activeKeyId: string;
  blindIndexKey: string;
}): KeyRing {
  const keys = new Map<string, Buffer>();

  for (const entry of input.keys.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      throw new EncryptionConfigError(
        'DOC_ENCRYPTION_KEYS entries must be "keyId:base64key"',
      );
    }
    const id = trimmed.slice(0, separator).trim();
    if (!/^[a-z0-9_-]{1,32}$/i.test(id)) {
      throw new EncryptionConfigError(`Key id ${JSON.stringify(id)} is not a safe identifier`);
    }
    keys.set(id, decodeKey(trimmed.slice(separator + 1).trim(), `key ${id}`));
  }

  if (keys.size === 0) {
    throw new EncryptionConfigError('DOC_ENCRYPTION_KEYS contained no keys');
  }
  if (!keys.has(input.activeKeyId)) {
    throw new EncryptionConfigError(
      `DOC_ENCRYPTION_ACTIVE_KEY "${input.activeKeyId}" is not present in DOC_ENCRYPTION_KEYS`,
    );
  }

  return {
    activeKeyId: input.activeKeyId,
    keys,
    blindIndexKey: decodeKey(input.blindIndexKey, 'DOC_BLIND_INDEX_KEY'),
  };
}

/** Generate a key in the format the environment variables expect. */
export function generateKeyMaterial(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

function associatedData(context: EncryptionContext): Buffer {
  return Buffer.from(`${ENVELOPE_VERSION}|${context.orgId}|${context.field}`, 'utf8');
}

/**
 * Normalise before hashing so that `DL-123456`, `dl 123456` and ` DL123456 `
 * all find the same record. Casing and separators vary wildly between the
 * spreadsheet, the licence itself and what someone types into a search box.
 */
export function normaliseDocumentNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9٠-٩۰-۹]/g, '');
}

export function encryptField(
  keyRing: KeyRing,
  plaintext: string,
  context: EncryptionContext,
): string {
  if (plaintext === '') {
    throw new EncryptionConfigError('Refusing to encrypt an empty value');
  }

  const key = keyRing.keys.get(keyRing.activeKeyId)!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(associatedData(context));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    keyRing.activeKeyId,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptField(
  keyRing: KeyRing,
  envelope: string,
  context: EncryptionContext,
): string {
  const parts = envelope.split('.');
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION) {
    throw new DecryptionError('Value is not a v1 encryption envelope');
  }

  const [, keyId, ivPart, tagPart, ciphertextPart] = parts as [string, string, string, string, string];
  const key = keyRing.keys.get(keyId);
  if (!key) {
    throw new DecryptionError(
      `Envelope was written with key "${keyId}", which is not in the key ring. ` +
        `A retired key must stay in DOC_ENCRYPTION_KEYS until every row is re-encrypted.`,
    );
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptionError('Envelope has a malformed IV or authentication tag');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Deliberately opaque: the common cause is a ciphertext being read under a
    // different org or column than it was written under, and echoing which
    // check failed would confirm that a given ciphertext belongs to a given org.
    throw new DecryptionError('Could not decrypt value — wrong key or wrong context');
  }
}

/**
 * Deterministic index for equality lookup. Salted with the org id, so the same
 * document number held by two customers hashes differently.
 */
export function blindIndex(
  keyRing: KeyRing,
  plaintext: string,
  context: EncryptionContext,
): string {
  return createHmac('sha256', keyRing.blindIndexKey)
    .update(`${context.orgId}|${context.field}|${normaliseDocumentNumber(plaintext)}`, 'utf8')
    .digest('hex');
}

export function blindIndexMatches(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The tail of a document number, kept in the clear so a list can identify a
 * record without a decryption round trip. Four characters of a licence number
 * is not enough to be useful to anyone who obtains the table.
 */
export function lastFour(plaintext: string): string {
  const normalised = normaliseDocumentNumber(plaintext);
  return normalised.slice(-4);
}

export interface SecureFieldValue {
  readonly numberEncrypted: string;
  readonly numberHash: string;
  readonly numberLast4: string;
}

/** Everything the three columns need, produced in one place. */
export function secureField(
  keyRing: KeyRing,
  plaintext: string,
  context: EncryptionContext,
): SecureFieldValue {
  return {
    numberEncrypted: encryptField(keyRing, plaintext, context),
    numberHash: blindIndex(keyRing, plaintext, context),
    numberLast4: lastFour(plaintext),
  };
}

export function isEncryptionEnvelope(value: string): boolean {
  return /^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Re-encrypt an envelope under the current active key. Used by the rotation
 * job; the plaintext exists only inside this function's frame.
 */
export function rotateField(
  keyRing: KeyRing,
  envelope: string,
  context: EncryptionContext,
): string {
  return encryptField(keyRing, decryptField(keyRing, envelope, context), context);
}
