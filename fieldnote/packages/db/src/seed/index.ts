/**
 * Seed the system templates.
 *
 * Idempotent: a template is matched by (org_id is null, name, version) and its
 * sections and fields are replaced wholesale. Safe to run on every deploy.
 *
 * System templates belong to no organisation and are read-only to every tenant
 * — a team that wants to change one forks it (templates.forkForOrg), so an
 * upstream correction to a compliance format stays shippable.
 */
import postgres from 'postgres';
import { ukDampTimberTemplate } from './templates/uk-damp-timber.js';
import { ukEicrTemplate } from './templates/uk-eicr.js';
import type { SeedTemplate } from './templates/uk-damp-timber.js';

/**
 * Only vertical one ships enabled. The EICR template is present so the shape is
 * reviewable, but it is not offered to customers until a qualified electrician
 * has signed the field list off — set SEED_ALL_VERTICALS=1 to include it.
 */
const templatesToSeed: SeedTemplate[] = [
  ukDampTimberTemplate,
  ...(process.env.SEED_ALL_VERTICALS === '1' ? [ukEicrTemplate] : []),
];

async function seedTemplate(sql: postgres.TransactionSql, template: SeedTemplate): Promise<void> {
  const [existing] = await sql<{ id: string }[]>`
    select id from templates
     where org_id is null and name = ${template.name} and version = 1
  `;

  let templateId: string;
  if (existing) {
    templateId = existing.id;
    await sql`
      update templates
         set vertical     = ${template.vertical},
             asr_keywords = ${sql.json(template.asrKeywords)},
             pdf_template = ${template.pdfTemplate}
       where id = ${templateId}
    `;
    // Cascade removes sections and their fields; they are rebuilt below.
    await sql`delete from template_sections where template_id = ${templateId}`;
  } else {
    const [created] = await sql<{ id: string }[]>`
      insert into templates (org_id, vertical, name, version, is_system, asr_keywords, pdf_template)
      values (
        null, ${template.vertical}, ${template.name}, 1, true,
        ${sql.json(template.asrKeywords)}, ${template.pdfTemplate}
      )
      returning id
    `;
    templateId = created!.id;
  }

  for (const [sectionIndex, section] of template.sections.entries()) {
    const [createdSection] = await sql<{ id: string }[]>`
      insert into template_sections (template_id, key, title, order_index, guidance)
      values (${templateId}, ${section.key}, ${section.title}, ${sectionIndex}, ${section.guidance})
      returning id
    `;
    const sectionId = createdSection!.id;

    for (const [fieldIndex, field] of section.fields.entries()) {
      await sql`
        insert into template_fields
          (section_id, key, label, type, required, enum_values, extraction_hint, order_index)
        values (
          ${sectionId}, ${field.key}, ${field.label}, ${field.type}, ${field.required},
          ${field.enumValues ? sql.json(field.enumValues) : null},
          ${field.extractionHint ?? null},
          ${fieldIndex}
        )
      `;
    }
  }

  const fieldCount = template.sections.reduce((n, s) => n + s.fields.length, 0);
  console.log(
    `  ${template.name}: ${template.sections.length} sections, ${fieldCount} fields, ` +
      `${template.asrKeywords.length} ASR keywords`,
  );
}

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DIRECT_DATABASE_URL or DATABASE_URL must be set.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    console.log('Seeding system templates...');
    await sql.begin(async (tx) => {
      for (const template of templatesToSeed) {
        await seedTemplate(tx, template);
      }
    });
    console.log('Done.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
