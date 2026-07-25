import type {
  PhotoContext,
  PhraseExample,
  TemplateSectionDef,
  Transcript,
} from '@fieldnote/shared';

/**
 * The per-section half of the prompt.
 *
 * Split into two pieces on purpose:
 *
 *  - `renderSectionSpec` is the field definitions. Identical for every report
 *    on a given template, so it carries the second cache breakpoint.
 *  - `renderSectionInput` is the transcript, photos and this user's phrase
 *    examples. Different every call, so it goes last, after both breakpoints.
 *
 * Reversing that order would make the cache useless.
 */

export function renderSectionSpec(section: TemplateSectionDef): string {
  const lines: string[] = [
    `## Section: ${section.title}`,
    '',
    section.guidance ? `Guidance for this section: ${section.guidance}` : '',
    '',
    'Fields to extract:',
    '',
  ];

  for (const field of section.fields) {
    lines.push(`### ${field.key}`);
    lines.push(`- Label: ${field.label}`);
    lines.push(`- Type: ${describeType(field.type)}`);
    lines.push(`- Required: ${field.required ? 'yes' : 'no'}`);
    if (field.enumValues?.length) {
      lines.push(`- Allowed values (choose exactly one of these, or null):`);
      for (const value of field.enumValues) lines.push(`  - ${value}`);
    }
    if (field.extractionHint) {
      lines.push(`- How this is usually said on site: ${field.extractionHint}`);
    }
    lines.push('');
  }

  return lines.filter((line) => line !== undefined).join('\n');
}

function describeType(type: string): string {
  switch (type) {
    case 'long_text':
      return "prose (several sentences; keep the inspector's phrasing)";
    case 'text':
      return 'short text (a phrase, not a sentence)';
    case 'number':
      return "number (digits only, no units — put units in the label's terms)";
    case 'boolean':
      return 'true or false';
    case 'enum':
      return 'one of the allowed values below';
    case 'multi_enum':
      return 'an array of zero or more of the allowed values below';
    case 'date':
      return 'date as YYYY-MM-DD, only if a date was explicitly stated';
    default:
      return type;
  }
}

export interface SectionInputOptions {
  section: TemplateSectionDef;
  transcript: Transcript;
  photos: PhotoContext[];
  /** Nearest-neighbour examples, keyed by field key. */
  phraseExamples: Record<string, PhraseExample[]>;
}

export function renderSectionInput(options: SectionInputOptions): string {
  const { transcript, photos, phraseExamples, section } = options;
  const blocks: string[] = [];

  blocks.push(
    '## Transcript',
    '',
    'This is the exact string your character offsets index into. Offsets start at 0.',
    '',
    '<transcript>',
    transcript.text,
    '</transcript>',
    '',
    `Transcript length: ${transcript.text.length} characters.`,
  );

  if (transcript.meanConfidence > 0 && transcript.meanConfidence < 0.75) {
    blocks.push(
      '',
      `Note: this recording has a mean word confidence of ${transcript.meanConfidence.toFixed(2)}, ` +
        'which suggests difficult site conditions. Be more willing to return null and lower your confidence accordingly.',
    );
  }

  if (photos.length > 0) {
    blocks.push(
      '',
      '## Photographs in this section',
      '',
      'Context only. A photograph never supports a finding on its own.',
      '',
    );
    for (const photo of photos) {
      const at =
        photo.captureOffsetMs === null
          ? ''
          : ` (taken at ${formatOffset(photo.captureOffsetMs)} into the recording)`;
      blocks.push(`- ${photo.caption ?? 'No caption'}${at}`);
    }
  }

  const examples = collectExamples(section, phraseExamples);
  if (examples.length > 0) {
    blocks.push(
      '',
      '## How this surveyor writes',
      '',
      'Previous drafts of yours alongside the wording this surveyor changed them to. Match their register, ordering and level of detail. These are style guidance only — never a source of facts, and never a reason to carry a finding across from one property to another.',
      '',
    );
    for (const example of examples) {
      blocks.push(`### ${example.fieldKey}`);
      blocks.push(`- You wrote: ${example.generatedText}`);
      blocks.push(`- They changed it to: ${example.finalText}`);
      blocks.push('');
    }
  }

  blocks.push(
    '',
    'Extract the fields defined above from this transcript. Return one entry per field, including fields you are returning as null.',
  );

  return blocks.join('\n');
}

function collectExamples(
  section: TemplateSectionDef,
  phraseExamples: Record<string, PhraseExample[]>,
): { fieldKey: string; generatedText: string; finalText: string }[] {
  const collected: { fieldKey: string; generatedText: string; finalText: string }[] = [];
  for (const field of section.fields) {
    for (const example of phraseExamples[field.key] ?? []) {
      collected.push({
        fieldKey: field.key,
        generatedText: example.generatedText,
        finalText: example.finalText,
      });
    }
  }
  return collected;
}

function formatOffset(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
