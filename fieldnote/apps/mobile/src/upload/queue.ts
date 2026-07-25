import * as FileSystem from 'expo-file-system';
import * as Network from 'expo-network';
import {
  nextPendingCaptures,
  pendingCount,
  purgeUploaded,
  setCaptureState,
  type LocalCapture,
} from '../store/local';

/**
 * Background upload queue.
 *
 * Survives app termination because its state lives in SQLite, not in memory —
 * on relaunch the queue simply asks the database what is still pending. Nothing
 * here is ever on the path of a recording: pressing record must work in a
 * basement with the radio off.
 *
 * Uploads go straight to object storage with a signed URL. Audio never passes
 * through the API, so a forty-minute file does not tie up a request handler.
 */

export interface QueueDeps {
  /** Mint a signed upload URL. Short-lived; re-requested per attempt. */
  requestUploadUrl(input: {
    reportId: string;
    captureId: string;
    contentType: string;
  }): Promise<{ uploadUrl: string; storagePath: string }>;

  /** Tell the API the object has landed, so transcription can be queued. */
  registerCapture(input: {
    reportId: string;
    clientId: string;
    storagePath: string;
    durationMs: number;
    sectionKey: string | null;
  }): Promise<{ captureId: string }>;
}

const MAX_ATTEMPTS = 8;
/** Local audio is kept for a day after upload, in case the server lost it. */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

let running = false;

export interface QueueStatus {
  pending: number;
  online: boolean;
  running: boolean;
}

export async function queueStatus(): Promise<QueueStatus> {
  const state = await Network.getNetworkStateAsync();
  return {
    pending: await pendingCount(),
    online: Boolean(state.isConnected && state.isInternetReachable !== false),
    running,
  };
}

/**
 * Drain the queue.
 *
 * Safe to call repeatedly and from anywhere — on app foreground, on regaining
 * connectivity, or from a background task. Re-entrant calls return immediately
 * rather than uploading the same file twice.
 */
export async function drain(deps: QueueDeps): Promise<void> {
  if (running) return;

  const network = await Network.getNetworkStateAsync();
  if (!network.isConnected || network.isInternetReachable === false) return;

  running = true;
  try {
    for (;;) {
      const batch = await nextPendingCaptures(3);
      if (batch.length === 0) break;

      for (const capture of batch) {
        // Give up rather than retry forever. A capture stuck here is visible on
        // the queue screen, where the surveyor can retry it deliberately.
        if (capture.attempts >= MAX_ATTEMPTS) {
          await setCaptureState(capture.id, 'failed', {
            error: `Gave up after ${MAX_ATTEMPTS} attempts`,
          });
          continue;
        }
        await uploadCapture(capture, deps);
      }
    }

    for (const uri of await purgeUploaded(PURGE_AFTER_MS)) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {
        // A file already gone is the outcome we wanted.
      });
    }
  } finally {
    running = false;
  }
}

async function uploadCapture(capture: LocalCapture, deps: QueueDeps): Promise<void> {
  await setCaptureState(capture.id, 'uploading');

  try {
    const info = await FileSystem.getInfoAsync(capture.file_uri);
    if (!info.exists) {
      // The OS reclaimed the file. Nothing to upload and no way to recover it;
      // recording it as failed at least makes the loss visible.
      await setCaptureState(capture.id, 'failed', { error: 'Local audio file no longer exists' });
      return;
    }

    const { uploadUrl, storagePath } = await deps.requestUploadUrl({
      reportId: capture.report_id,
      captureId: capture.id,
      contentType: 'audio/mp4',
    });

    const result = await FileSystem.uploadAsync(uploadUrl, capture.file_uri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'audio/mp4' },
    });

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Storage returned ${result.status}`);
    }

    // The capture id generated on the phone is the idempotency key, so a
    // retry after a lost response cannot create a duplicate server-side.
    const { captureId } = await deps.registerCapture({
      reportId: capture.report_id,
      clientId: capture.id,
      storagePath,
      durationMs: capture.duration_ms,
      sectionKey: capture.section_key,
    });

    await setCaptureState(capture.id, 'uploaded', { remoteId: captureId });
  } catch (error: unknown) {
    await setCaptureState(capture.id, 'failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Exponential backoff with a ceiling, for the caller's retry timer. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 5 * 60 * 1000);
}
