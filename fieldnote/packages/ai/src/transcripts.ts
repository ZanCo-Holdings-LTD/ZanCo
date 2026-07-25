import type { Transcript } from '@fieldnote/shared';

/**
 * Concatenate several captures into one transcript.
 *
 * Character offsets are what the provenance guarantee rests on: the model cites
 * a range into the exact string it was shown, and the reviewer is later shown
 * the words at that range. So the merged text must be precisely what goes into
 * the prompt, and each capture's word timings must be shifted by the elapsed
 * duration of everything before it.
 *
 * Getting this wrong would make every citation in a multi-capture report point
 * at the wrong moment in the wrong recording — which is worse than no citation,
 * because it looks correct.
 */
export function mergeTranscripts(transcripts: Transcript[]): Transcript {
  if (transcripts.length === 1) return transcripts[0]!;

  const separator = '\n\n';
  let text = '';
  let elapsedMs = 0;
  const words: Transcript['words'] = [];

  for (const [index, transcript] of transcripts.entries()) {
    if (index > 0) text += separator;
    text += transcript.text;
    for (const word of transcript.words) {
      words.push({
        ...word,
        startMs: word.startMs + elapsedMs,
        endMs: word.endMs + elapsedMs,
      });
    }
    elapsedMs += transcript.durationMs;
  }

  const meanConfidence =
    words.length === 0 ? 0 : words.reduce((sum, word) => sum + word.confidence, 0) / words.length;

  return {
    text,
    words,
    provider: transcripts[0]!.provider,
    model: transcripts[0]!.model,
    meanConfidence,
    durationMs: elapsedMs,
  };
}
