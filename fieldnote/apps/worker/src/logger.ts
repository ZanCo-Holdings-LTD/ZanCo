/**
 * Structured logging.
 *
 * JSON lines so Fly's log shipper and Sentry both parse them without a
 * grok pattern. Never log a transcript or a report value: those are client
 * documents about real properties, and a log aggregator is not a place they
 * belong.
 */
type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const threshold = LEVEL_RANK[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 30;

function emit(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (LEVEL_RANK[level] < threshold) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: message,
    ...fields,
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  trace: (msg: string, fields?: Record<string, unknown>) => emit('trace', msg, fields),
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

/** Reduce an unknown thrown value to something safe to serialise. */
export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack?.split('\n').slice(0, 5).join('\n') };
  }
  return { error: String(error) };
}
