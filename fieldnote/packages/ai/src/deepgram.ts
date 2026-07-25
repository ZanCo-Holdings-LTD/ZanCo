import { AppError } from '@fieldnote/shared';
import type { Transcript, TranscriptWord } from '@fieldnote/shared';

/**
 * Stage 1: cloud transcription.
 *
 * Deepgram Nova with a per-vertical keyword boost list loaded from the template
 * record. The on-device draft the phone produced is stored separately and never
 * replaced — the raw transcripts are the provenance source and the liability
 * defence, so nothing here discards one.
 */

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

export interface TranscribeOptions {
  apiKey: string;
  model: string;
  language: string;
  /** Domain vocabulary the model otherwise mishears. From templates.asr_keywords. */
  keywords?: string[];
  /** Abort signal so a stuck request cannot hold a worker slot open. */
  signal?: AbortSignal;
}

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

interface DeepgramResponse {
  results?: {
    channels?: {
      alternatives?: {
        transcript?: string;
        confidence?: number;
        words?: DeepgramWord[];
      }[];
    }[];
  };
  metadata?: { duration?: number };
}

/**
 * Transcribe a pre-recorded audio buffer.
 *
 * Smart formatting and punctuation are on: the structuring stage reads the
 * transcript as prose and character offsets are the provenance anchor, so the
 * text it sees must be the text the reviewer will later see quoted back.
 */
export async function transcribe(
  audio: ArrayBuffer | Uint8Array,
  contentType: string,
  options: TranscribeOptions,
): Promise<Transcript> {
  const params = new URLSearchParams({
    model: options.model,
    language: options.language,
    punctuate: 'true',
    smart_format: 'true',
    // Word timings are what let a reviewer tap a field and hear the audio.
    utterances: 'false',
    diarize: 'false',
    filler_words: 'false',
  });

  // Deepgram caps keyword boosting; send the highest-value terms only.
  for (const keyword of (options.keywords ?? []).slice(0, 100)) {
    params.append('keyterm', keyword);
  }

  const response = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${options.apiKey}`,
      'Content-Type': contentType,
    },
    body: audio instanceof Uint8Array ? audio : new Uint8Array(audio),
    signal: options.signal ?? null,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AppError('upstream_failed', `Deepgram returned ${response.status}`, {
      // 4xx is our bug (bad audio, bad params); 5xx and 429 are worth retrying.
      retryable: response.status >= 500 || response.status === 429,
      details: { status: response.status, body: body.slice(0, 500) },
    });
  }

  const payload = (await response.json()) as DeepgramResponse;
  return normalise(payload, options.model);
}

/** Convert Deepgram's seconds-based shape into our millisecond wire type. */
export function normalise(payload: DeepgramResponse, model: string): Transcript {
  const alternative = payload.results?.channels?.[0]?.alternatives?.[0];

  if (!alternative) {
    throw new AppError('upstream_failed', 'Deepgram returned no transcript alternative', {
      retryable: true,
    });
  }

  const words: TranscriptWord[] = (alternative.words ?? []).map((word) => ({
    // Prefer the punctuated form: it is what the transcript text contains, so
    // character offsets computed from these words line up with the prose.
    word: word.punctuated_word ?? word.word,
    startMs: Math.round(word.start * 1000),
    endMs: Math.round(word.end * 1000),
    confidence: word.confidence,
  }));

  const meanConfidence =
    words.length > 0 ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0;

  return {
    text: alternative.transcript ?? '',
    words,
    provider: 'deepgram',
    model,
    meanConfidence,
    durationMs: Math.round((payload.metadata?.duration ?? 0) * 1000),
  };
}

/**
 * Map a character range in the transcript text back to audio timestamps.
 *
 * This is what makes tap-through work: the model cites a character range, and
 * the reviewer gets a playable audio position. Walks the word list accumulating
 * offsets rather than searching, so repeated phrases resolve to the right
 * occurrence.
 */
export function charRangeToTimestamps(
  transcript: Transcript,
  startChar: number,
  endChar: number,
): { startMs: number; endMs: number } | null {
  if (transcript.words.length === 0) return null;

  let cursor = 0;
  let startMs: number | null = null;
  let endMs: number | null = null;

  for (const word of transcript.words) {
    const wordStart = transcript.text.indexOf(word.word, cursor);
    if (wordStart === -1) continue;
    const wordEnd = wordStart + word.word.length;
    cursor = wordEnd;

    if (startMs === null && wordEnd > startChar) startMs = word.startMs;
    if (wordStart < endChar) endMs = word.endMs;
    if (wordStart >= endChar) break;
  }

  if (startMs === null || endMs === null) return null;
  return { startMs, endMs };
}

/**
 * Below this mean word confidence the capture was probably recorded in a plant
 * room with something running. Surfaced to the reviewer rather than silently
 * degrading the report.
 */
export const POOR_AUDIO_CONFIDENCE = 0.65;

export function isPoorAudio(transcript: Transcript): boolean {
  return transcript.meanConfidence > 0 && transcript.meanConfidence < POOR_AUDIO_CONFIDENCE;
}
