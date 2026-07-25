import type { TemplateFieldDef, TemplateSectionDef } from '@fieldnote/shared';

/**
 * Build the JSON Schema for one section's structured output.
 *
 * Constraining the response shape at the API level rather than parsing prose
 * means the model cannot return a field we did not ask for, omit one we did, or
 * invent an enum option. What it can still do is claim a source span that does
 * not exist — that is what guardrails.ts is for.
 *
 * `additionalProperties: false` and a complete `required` list are load-bearing:
 * without both, strict validation is not applied.
 */
export function buildSectionSchema(section: TemplateSectionDef): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      sectionKey: { type: 'string', const: section.key },
      fields: {
        type: 'array',
        // One entry per defined field, including the nulls.
        items: {
          anyOf: section.fields.map((field) => fieldEntrySchema(field)),
        },
      },
    },
    required: ['sectionKey', 'fields'],
    additionalProperties: false,
  };
}

function fieldEntrySchema(field: TemplateFieldDef): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      fieldKey: { type: 'string', const: field.key },
      value: valueSchema(field),
      confidence: {
        type: 'number',
        description:
          'Probability a reviewer accepts this unchanged. 0 when the field was not mentioned.',
      },
      sourceSpan: sourceSpanSchema(),
    },
    required: ['fieldKey', 'value', 'confidence', 'sourceSpan'],
    additionalProperties: false,
  };
}

function valueSchema(field: TemplateFieldDef): Record<string, unknown> {
  // Every value is nullable: "not stated" is always a legal answer, and making
  // it easy to give is how we avoid guesses.
  const nullOption = { type: 'null' };

  switch (field.type) {
    case 'number':
      return { anyOf: [{ type: 'number' }, nullOption] };
    case 'boolean':
      return { anyOf: [{ type: 'boolean' }, nullOption] };
    case 'enum':
      return {
        anyOf: [{ type: 'string', enum: field.enumValues ?? [] }, nullOption],
      };
    case 'multi_enum':
      return {
        anyOf: [
          { type: 'array', items: { type: 'string', enum: field.enumValues ?? [] } },
          nullOption,
        ],
      };
    case 'date':
      return { anyOf: [{ type: 'string', format: 'date' }, nullOption] };
    case 'text':
    case 'long_text':
    default:
      return { anyOf: [{ type: 'string' }, nullOption] };
  }
}

function sourceSpanSchema(): Record<string, unknown> {
  return {
    anyOf: [
      {
        type: 'object',
        properties: {
          charStart: {
            type: 'integer',
            description: 'Inclusive character offset into the transcript string.',
          },
          charEnd: {
            type: 'integer',
            description: 'Exclusive character offset into the transcript string.',
          },
          quote: {
            type: 'string',
            description: 'The exact substring between charStart and charEnd. Checked mechanically.',
          },
        },
        required: ['charStart', 'charEnd', 'quote'],
        additionalProperties: false,
      },
      { type: 'null' },
    ],
  };
}

/** Shape the model returns, before grounding turns it into a SourceSpan. */
export interface RawSourceSpan {
  charStart: number;
  charEnd: number;
  quote: string;
}

export interface RawFieldEntry {
  fieldKey: string;
  value: string | number | boolean | string[] | null;
  confidence: number;
  sourceSpan: RawSourceSpan | null;
}

export interface RawSectionOutput {
  sectionKey: string;
  fields: RawFieldEntry[];
}
