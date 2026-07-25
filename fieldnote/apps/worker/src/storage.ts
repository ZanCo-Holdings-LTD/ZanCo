import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError, STORAGE_BUCKETS } from '@fieldnote/shared';
import { env } from './env.js';

/**
 * Object storage.
 *
 * Every bucket is private. Nothing is ever served from a public URL: audio,
 * photos and rendered PDFs are all client material about real properties, and a
 * guessable path is a data breach waiting for a crawler. Access is by
 * short-lived signed URL only.
 */

let client: SupabaseClient | undefined;

function storage(): SupabaseClient {
  client ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export type BucketName = keyof typeof STORAGE_BUCKETS;

export async function download(bucket: BucketName, path: string): Promise<Uint8Array> {
  const { data, error } = await storage().storage.from(STORAGE_BUCKETS[bucket]).download(path);
  if (error || !data) {
    throw new AppError('upstream_failed', `Could not download ${bucket}/${path}`, {
      retryable: true,
      cause: error,
    });
  }
  return new Uint8Array(await data.arrayBuffer());
}

export async function upload(
  bucket: BucketName,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await storage()
    .storage.from(STORAGE_BUCKETS[bucket])
    .upload(path, bytes, { contentType, upsert: true });

  if (error) {
    throw new AppError('upstream_failed', `Could not upload ${bucket}/${path}`, {
      retryable: true,
      cause: error,
    });
  }
}

/**
 * A signed URL for a private object.
 *
 * Kept short: an emailed report link that stays valid for a week is a link
 * that gets forwarded, indexed and archived. Delivery embeds the PDF instead.
 */
export async function signedUrl(
  bucket: BucketName,
  path: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { data, error } = await storage()
    .storage.from(STORAGE_BUCKETS[bucket])
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new AppError('upstream_failed', `Could not sign ${bucket}/${path}`, {
      retryable: true,
      cause: error,
    });
  }
  return data.signedUrl;
}

export async function remove(bucket: BucketName, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await storage().storage.from(STORAGE_BUCKETS[bucket]).remove(paths);
}

/** Best-effort content type from a storage path. */
export function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'webm':
      return 'audio/webm';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
