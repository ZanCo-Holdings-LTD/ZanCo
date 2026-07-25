import { customType, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './orgs.js';
import { templateFields } from './templates.js';

/**
 * pgvector column type. Drizzle has no first-class vector, so this maps the
 * literal representation Postgres expects.
 */
export const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return JSON.parse(value) as number[];
    },
  })(name);

/**
 * The compounding asset.
 *
 * Every time a reviewer edits a generated field, the (generated, final) pair is
 * written here and embedded. Those pairs are retrieved by similarity and fed
 * back into the structuring prompt for that user, so the model learns how this
 * particular surveyor writes. This is the switching cost, and it is why the
 * product gets better the longer someone uses it.
 */
export const phraseExamples = pgTable(
  'phrase_examples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => templateFields.id, { onDelete: 'cascade' }),
    generatedText: text('generated_text').notNull(),
    finalText: text('final_text').notNull(),
    /** Normalised Levenshtein between the two. The product-health metric. */
    editDistance: numeric('edit_distance', { precision: 5, scale: 4 }),
    embedding: vector('embedding', 1536),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Retrieval is always scoped to one user and one field before the ANN scan.
    userFieldIdx: index('phrase_examples_user_field_idx').on(table.userId, table.fieldId),
    orgIdx: index('phrase_examples_org_idx').on(table.orgId),
    createdIdx: index('phrase_examples_created_idx').on(table.createdAt),
  }),
);

export type PhraseExampleRow = typeof phraseExamples.$inferSelect;
export type NewPhraseExample = typeof phraseExamples.$inferInsert;
