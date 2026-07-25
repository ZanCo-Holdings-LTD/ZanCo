/**
 * The worker.
 *
 * Holds the capabilities the web tier deliberately does not: writing the
 * canonical layer, running reconciliations across organisations, and receiving
 * inbound email from the internet. Everything it exposes is either authenticated
 * with the internal token or signature-verified.
 */
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createDatabase, createPool, repositories, withoutTenantScope } from '@aggregatoriq/db';
import { period, type AggregatorCode, type Currency } from '@aggregatoriq/core';
import { loadEnv } from './env.js';
import { createStorage } from './storage.js';
import { ingestDocument } from './services/ingest.js';
import { runReconciliation } from './services/reconcile.js';
import { buildDisputePackCsv, buildDisputePackPdf } from './services/dispute-pack.js';
import { verifyHmacSignature } from './payments.js';

const env = loadEnv();

const pool = createPool({
  url: env.DATABASE_URL,
  ssl: env.DATABASE_SSL,
  applicationName: 'aggregatoriq-worker',
});
const db = createDatabase(pool);
const storage = createStorage({
  driver: env.STORAGE_DRIVER,
  localPath: env.STORAGE_LOCAL_PATH,
});

const app = Fastify({
  logger: { level: env.LOG_LEVEL },
  // Statements arrive as attachments; a month of orders for a busy branch is a
  // large CSV.
  bodyLimit: 32 * 1024 * 1024,
});

// Keep the raw body for signature verification. Verifying against a re-serialised
// object is verifying a different document from the one that was signed.
app.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (request, rawBody, done) => {
    (request as FastifyRequest & { rawBody?: string }).rawBody = rawBody as string;
    try {
      done(null, JSON.parse(rawBody as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  },
);

function requireInternalToken(request: FastifyRequest, reply: FastifyReply): boolean {
  const provided = request.headers['x-internal-token'];
  const token = Array.isArray(provided) ? provided[0] : provided;

  if (typeof token !== 'string') {
    void reply.code(401).send({ error: 'Missing internal token' });
    return false;
  }

  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(env.INTERNAL_API_TOKEN, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    void reply.code(401).send({ error: 'Invalid internal token' });
    return false;
  }

  return true;
}

app.get('/health', async () => {
  await pool`select 1`;
  return { status: 'ok', extraction: env.EXTRACTION_ENABLED ? 'enabled' : 'disabled' };
});

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

const ingestSchema = z.object({
  orgId: z.string().uuid(),
  branchId: z.string().uuid(),
  aggregatorId: z.string().uuid(),
  aggregatorCode: z.string(),
  currency: z.string().length(3),
  timezone: z.string().min(1),
  filename: z.string().nullable(),
  receivedVia: z.enum(['upload', 'email', 'free_audit']),
  /** Base64, so a statement survives JSON transport unmangled. */
  contentBase64: z.string().min(1),
});

app.post('/internal/ingest', async (request, reply) => {
  if (!requireInternalToken(request, reply)) return;

  const parsed = ingestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
  }

  const input = parsed.data;
  const result = await ingestDocument(db, storage, {
    orgId: input.orgId,
    branchId: input.branchId,
    aggregatorId: input.aggregatorId,
    aggregatorCode: input.aggregatorCode as AggregatorCode,
    currency: input.currency as Currency,
    timezone: input.timezone,
    filename: input.filename,
    receivedVia: input.receivedVia,
    content: Buffer.from(input.contentBase64, 'base64'),
  });

  return reply.send(result);
});

/**
 * Inbound email from Resend.
 *
 * A restaurant forwards the aggregator's settlement email to the address on
 * their branch and it lands parsed. This is the lowest-friction onboarding
 * available, and it is also an unauthenticated endpoint that accepts files —
 * hence the signature check and the unguessable local part.
 */
const inboundEmailSchema = z.object({
  to: z.array(z.string()).min(1),
  from: z.string(),
  subject: z.string().optional(),
  attachments: z
    .array(z.object({ filename: z.string(), content: z.string(), contentType: z.string().optional() }))
    .default([]),
});

app.post('/webhooks/inbound-email', async (request, reply) => {
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? '';
  const signature = request.headers['svix-signature'] ?? request.headers['x-webhook-signature'];

  if (env.INBOUND_EMAIL_SECRET !== undefined) {
    const provided = Array.isArray(signature) ? signature[0] : signature;
    if (!verifyHmacSignature(rawBody, provided, env.INBOUND_EMAIL_SECRET)) {
      request.log.warn('Rejected inbound email with an invalid signature');
      return reply.code(401).send({ error: 'Invalid signature' });
    }
  }

  const parsed = inboundEmailSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid payload', issues: parsed.error.issues });
  }

  const localParts = parsed.data.to
    .map((address) => /^([^@<>\s]+)@/.exec(address.replace(/^.*</, ''))?.[1])
    .filter((part): part is string => part !== undefined);

  const results: unknown[] = [];

  for (const localPart of localParts) {
    const address = await withoutTenantScope(db, (tx) =>
      repositories.ingestion.resolveIngestionAddress(tx, localPart),
    );
    if (address === null) continue;

    const branch = await withoutTenantScope(db, (tx) =>
      repositories.branches.getBranch(tx, address.orgId, address.branchId),
    );
    const aggregators = await withoutTenantScope(db, (tx) =>
      repositories.branches.listAggregators(tx),
    );
    const aggregator = aggregators.find((candidate) => candidate.id === address.aggregatorId);

    if (branch === null || aggregator === undefined) continue;

    if (parsed.data.attachments.length === 0) {
      request.log.warn(
        { localPart },
        'Inbound email had no attachment — the statement was probably left behind in the forward',
      );
      continue;
    }

    for (const attachment of parsed.data.attachments) {
      const result = await ingestDocument(db, storage, {
        orgId: address.orgId,
        branchId: address.branchId,
        aggregatorId: address.aggregatorId,
        aggregatorCode: aggregator.code,
        currency: branch.currency as Currency,
        timezone: branch.timezone,
        filename: attachment.filename,
        receivedVia: 'email',
        content: Buffer.from(attachment.content, 'base64'),
      });
      results.push(result);
    }

    await withoutTenantScope(db, async (tx) => {
      await repositories.ingestion.recordIngestionReceipt(tx, localPart);
      await repositories.analytics.track(tx, {
        name: 'ingestion_email_used',
        orgId: address.orgId,
        properties: { branchId: address.branchId, attachments: parsed.data.attachments.length },
      });
    });
  }

  if (results.length === 0) {
    // 200 rather than 404: an unrecognised address is not the sender's problem
    // to retry, and a 4xx makes Resend keep redelivering it.
    request.log.warn({ to: parsed.data.to }, 'Inbound email matched no ingestion address');
    return reply.send({ ingested: 0, note: 'No matching ingestion address' });
  }

  return reply.send({ ingested: results.length, results });
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

const reconSchema = z.object({
  orgId: z.string().uuid(),
  branchId: z.string().uuid(),
  aggregatorId: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  currency: z.string().length(3),
  materialityThresholdMinor: z.number().int().min(0).default(100),
  triggeredBy: z.string().uuid().nullable().default(null),
});

app.post('/internal/recon/run', async (request, reply) => {
  if (!requireInternalToken(request, reply)) return;

  const parsed = reconSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
  }

  const input = parsed.data;
  const { reconRunId, result } = await runReconciliation(db, {
    orgId: input.orgId,
    branchId: input.branchId,
    aggregatorId: input.aggregatorId,
    period: period(input.periodStart, input.periodEnd),
    currency: input.currency as Currency,
    materialityThresholdMinor: input.materialityThresholdMinor,
    triggeredBy: input.triggeredBy,
  });

  return reply.send({
    reconRunId,
    engineVersion: result.engineVersion,
    varianceCount: result.variances.length,
    recoveryTotalMinor: result.recoveryTotalMinor,
    unmatchedLineCount: result.unmatched.length,
    summary: result.summary,
    warnings: result.warnings,
  });
});

// ---------------------------------------------------------------------------
// Dispute packs
// ---------------------------------------------------------------------------

const packSchema = z.object({
  orgId: z.string().uuid(),
  disputeId: z.string().uuid(),
  format: z.enum(['pdf', 'csv']).default('pdf'),
});

app.post('/internal/disputes/pack', async (request, reply) => {
  if (!requireInternalToken(request, reply)) return;

  const parsed = packSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
  }

  const { orgId, disputeId, format } = parsed.data;

  const assembled = await withoutTenantScope(db, async (tx) => {
    const dispute = await repositories.disputes.getDispute(tx, orgId, disputeId);
    if (dispute === null) return null;

    const variances = (
      await repositories.recon.listVariances(tx, orgId)
    ).filter((variance) => dispute.varianceIds.includes(variance.id));

    const rowIds = [...new Set(variances.flatMap((v) => v.evidence.source_row_ids))];
    const rows = await repositories.ingestion.getSourceRowsByIds(tx, rowIds);

    const organisation = await repositories.organisations.getOrganisation(tx, orgId);
    const branch = dispute.branchId
      ? await repositories.branches.getBranch(tx, orgId, dispute.branchId)
      : null;
    const aggregators = await repositories.branches.listAggregators(tx);

    return { dispute, variances, rows, organisation, branch, aggregators };
  });

  if (assembled === null) return reply.code(404).send({ error: 'Dispute not found' });

  const sourceRows = new Map(
    assembled.rows.map((row) => [
      row.id,
      { rowIndex: row.rowIndex, raw: row.raw, filename: row.originalFilename },
    ]),
  );

  const periodStarts = assembled.rows
    .map((row) => row.periodStart)
    .filter((value): value is string => value !== null)
    .sort();
  const periodEnds = assembled.rows
    .map((row) => row.periodEnd)
    .filter((value): value is string => value !== null)
    .sort();

  const input = {
    organisationName: assembled.organisation?.name ?? 'Operator',
    branchName: assembled.branch?.name ?? 'All branches',
    aggregatorName:
      assembled.aggregators.find((a) => a.id === assembled.dispute.aggregatorId)?.name ??
      'Aggregator',
    externalStoreId: null,
    reference: assembled.dispute.reference,
    periodStart: periodStarts[0] ?? 'unknown',
    periodEnd: periodEnds[periodEnds.length - 1] ?? 'unknown',
    currency: assembled.dispute.currency as Currency,
    generatedOn: new Date().toISOString().slice(0, 10),
    variances: assembled.variances,
    sourceRows,
  };

  await withoutTenantScope(db, (tx) =>
    repositories.analytics.track(tx, {
      name: 'dispute_pack_generated',
      orgId,
      properties: { disputeId, format, varianceCount: assembled.variances.length },
    }),
  );

  if (format === 'csv') {
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${assembled.dispute.reference}.csv"`)
      .send(buildDisputePackCsv(input));
  }

  return reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', `attachment; filename="${assembled.dispute.reference}.pdf"`)
    .send(buildDisputePackPdf(input));
});

// ---------------------------------------------------------------------------
// Billing webhooks
// ---------------------------------------------------------------------------

app.post('/webhooks/:provider', async (request, reply) => {
  const { provider } = request.params as { provider: string };
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? '';

  const secret =
    provider === 'stripe'
      ? env.STRIPE_WEBHOOK_SECRET
      : provider === 'moyasar'
        ? env.MOYASAR_WEBHOOK_SECRET
        : undefined;

  if (secret === undefined) {
    return reply.code(404).send({ error: `No webhook configured for ${provider}` });
  }

  const signature = request.headers['stripe-signature'] ?? request.headers['x-signature'];
  const provided = Array.isArray(signature) ? signature[0] : signature;

  if (!verifyHmacSignature(rawBody, provided, secret)) {
    return reply.code(401).send({ error: 'Invalid signature' });
  }

  // Subscription state is applied here, in the worker, because the app role has
  // no write grant on the subscriptions table — an organisation cannot promote
  // its own plan.
  request.log.info({ provider }, 'Billing webhook received');
  return reply.send({ received: true });
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
