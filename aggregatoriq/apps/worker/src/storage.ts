/**
 * Object storage.
 *
 * An interface with a local-disk implementation, because the thing that must not
 * happen is a customer's statement being written somewhere nobody can find. S3
 * arrives in deployment; the contract is here so the ingestion path does not
 * change shape when it does.
 *
 * Statements are a restaurant's commercial records. Paths are namespaced by
 * organisation so that a listing bug cannot cross a tenant boundary, and the
 * original bytes are kept forever — they are the evidence behind every dispute.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

export interface StoredObject {
  readonly path: string;
  readonly checksum: string;
  readonly byteSize: number;
}

export interface Storage {
  put(path: string, content: Buffer): Promise<StoredObject>;
  get(path: string): Promise<Buffer>;
}

/**
 * Build the storage path for a document.
 *
 * Organisation first, so every path a tenant can reach shares a prefix, and the
 * checksum in the filename so the same file uploaded twice lands on the same
 * object rather than accumulating copies.
 */
export function documentPath(input: {
  orgId: string | null;
  branchId: string | null;
  checksum: string;
  filename: string | null;
}): string {
  const safeName = (input.filename ?? 'statement')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(-80);

  const scope = input.orgId ?? 'free-audit';
  const branch = input.branchId ?? 'unassigned';

  return `${scope}/${branch}/${input.checksum.slice(0, 16)}-${safeName}`;
}

export function checksumOf(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Resolve a key to a path inside the root.
   *
   * The traversal check is not theoretical: filenames arrive from email
   * attachments, which is to say from anyone who knows a customer's ingestion
   * address.
   */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, normalize(key)));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Refusing to access ${key}: resolves outside the storage root`);
    }
    return target;
  }

  async put(path: string, content: Buffer): Promise<StoredObject> {
    const target = this.resolveKey(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    return { path, checksum: checksumOf(content), byteSize: content.byteLength };
  }

  async get(path: string): Promise<Buffer> {
    return readFile(this.resolveKey(path));
  }
}

export function createStorage(config: { driver: 'local' | 's3'; localPath: string }): Storage {
  if (config.driver === 'local') return new LocalStorage(config.localPath);

  throw new Error(
    'The S3 storage driver is not implemented yet. Set STORAGE_DRIVER=local, or add the ' +
      'implementation before deploying — silently falling back to local disk would put ' +
      'customer statements on an ephemeral filesystem.',
  );
}
