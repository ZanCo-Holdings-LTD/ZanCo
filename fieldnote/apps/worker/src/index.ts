import cors from '@fastify/cors';
import Fastify from 'fastify';
import { z } from 'zod';
import { toAppError } from '@fieldnote/shared';
import { closeBrowser } from '@fieldnote/pdf';
import { requireInternal, requireUser, verifyResendSignature } from './auth.js';
import { repositories, workerDb } from './db.js';
import { env } from './env.js';
import { errorFields, log } from './logger.js';
import { Runner } from './runner.js';

/**
 * The worker.
 *
 * Two jobs in one process: an HTTP surface for enqueueing and webhooks, and the
 * queue runner. Keeping them together means one deploy, one set of secrets and
 * one place holding the ASR and LLM keys — neither the mobile app nor the
 * browser ever sees them.
 */

const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
const runner = new Runner();

await app.register(cors, {
  origin: [env.APP_URL],
  methods: ['GET', 'POST'],
  credentials: true,
});

// Raw body is needed to verify webhook signatures; a re-serialised body will
// not produce the same HMAC.
app.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (request, body: string, done) => {
    (request as { rawBody?: string }).rawBody = body;
    try {
      done(null, body.length === 0 ? {} : JSON.parse(body));
    } catch (error: unknown) {
      done(error as Error, undefined);
    }
  },
);

app.setErrorHandler((error, request, reply) => {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    log.error('request failed', { path: request.url, ...errorFields(error) });
  }
  void reply.status(appError.status).send(appError.toJSON());
});

/**
 * Health.
 *
 * The only unauthenticated route. Reports queue depth so a backed-up or dying
 * queue is visible to alerting rather than only in the logs — a stuck queue
 * means someone's survey never became a report.
 */
app.get('/health', async () => {
  const started = Date.now();
  let database: 'ok' | 'error' = 'ok';
  let queue = { queued: 0, running: 0, dead: 0, oldestQueuedAgeSeconds: null as number | null };

  try {
    queue = await repositories.jobs.depth(workerDb());
  } catch (error: unknown) {
    database = 'error';
    log.error('health check could not reach the database', errorFields(error));
  }

  return {
    status: database === 'ok' ? 'ok' : 'degraded',
    version: process.env.FLY_IMAGE_REF ?? 'dev',
    database,
    queue,
    runner: runner.stats,
    checkedAtMs: Date.now() - started,
  };
});

const enqueueBody = z.object({
  orgId: z.string().uuid(),
  kind: z.enum([
    'transcribe_capture',
    'structure_report',
    'render_pdf',
    'deliver_report',
    'embed_phrase_example',
  ]),
  payload: z.record(z.unknown()),
  idempotencyKey: z.string().min(1).max(200),
});

/**
 * Enqueue a job.
 *
 * Machine-to-machine: the web app calls this with the shared secret after it
 * has already checked the caller's permissions against RLS. The worker does not
 * re-derive authorisation from a user token here, because there isn't one.
 */
app.post('/jobs', { preHandler: requireInternal }, async (request, reply) => {
  const body = enqueueBody.parse(request.body);
  const id = await repositories.jobs.enqueue(workerDb(), {
    orgId: body.orgId,
    kind: body.kind,
    payload: body.payload,
    idempotencyKey: body.idempotencyKey,
  });
  // A null id means it was already queued. That is success, not a conflict.
  return reply.status(202).send({ jobId: id, deduplicated: id === null });
});

/**
 * Register an uploaded capture and queue its transcription.
 *
 * Called by the phone with the user's own token. The upload itself goes
 * straight to storage with a signed URL — audio never passes through here.
 */
const registerCaptureBody = z.object({
  orgId: z.string().uuid(),
  reportId: z.string().uuid(),
  clientId: z.string().min(1).max(120),
  storagePath: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  sectionKey: z.string().nullable().optional(),
  localTranscript: z.string().nullable().optional(),
});

app.post('/captures', { preHandler: requireUser }, async (request, reply) => {
  const body = registerCaptureBody.parse(request.body);

  const role = await repositories.organisations.roleOf(
    workerDb(),
    body.orgId,
    request.user!.userId,
  );
  if (!role) {
    return reply.status(403).send({ error: { code: 'forbidden', message: 'Not a member' } });
  }

  const captureId = await repositories.captures.register(workerDb(), {
    orgId: body.orgId,
    reportId: body.reportId,
    clientId: body.clientId,
    storagePath: body.storagePath,
    durationMs: body.durationMs,
    sectionKey: body.sectionKey ?? null,
    localTranscript: body.localTranscript ?? null,
  });

  await repositories.jobs.enqueue(workerDb(), {
    orgId: body.orgId,
    kind: 'transcribe_capture',
    payload: { orgId: body.orgId, reportId: body.reportId, captureId },
    // Keyed on the capture, so the phone's aggressive retries collapse.
    idempotencyKey: `transcribe:${captureId}`,
  });

  return reply.status(201).send({ captureId });
});

/**
 * Resend delivery webhooks.
 *
 * Signature-verified. Without that, an unauthenticated caller could mark any
 * report as delivered and opened — a record customers may rely on in a dispute.
 */
app.post('/webhooks/resend', async (request, reply) => {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret)
    return reply.status(503).send({ error: { code: 'internal', message: 'Not configured' } });

  const raw = (request as { rawBody?: string }).rawBody ?? '';
  const signature = request.headers['svix-signature'] ?? request.headers['resend-signature'];

  if (!verifyResendSignature(raw, typeof signature === 'string' ? signature : undefined, secret)) {
    return reply.status(401).send({ error: { code: 'unauthorized', message: 'Bad signature' } });
  }

  const event = request.body as { type?: string; data?: { email_id?: string } };
  const messageId = event.data?.email_id;

  if (event.type === 'email.opened' && messageId) {
    await repositories.delivery.markOpened(workerDb(), messageId);
  }

  return reply.status(204).send();
});

/**
 * Graceful shutdown.
 *
 * Fly sends SIGTERM before replacing a machine. Draining in-flight jobs first
 * avoids sending a client the same report twice.
 */
async function shutdown(signal: string): Promise<void> {
  log.info('shutting down', { signal });
  try {
    await app.close();
    await runner.stop();
    await closeBrowser();
  } catch (error: unknown) {
    log.error('error during shutdown', errorFields(error));
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', errorFields(reason));
});

try {
  await app.listen({ port: env.WORKER_PORT, host: '0.0.0.0' });
  log.info('worker listening', { port: env.WORKER_PORT });
  runner.start();
} catch (error: unknown) {
  log.error('failed to start', errorFields(error));
  process.exit(1);
}
