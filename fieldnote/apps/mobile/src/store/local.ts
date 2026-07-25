import * as SQLite from 'expo-sqlite';

/**
 * The local store.
 *
 * During a survey this is the source of truth, not the server. A surveyor in a
 * loft with no signal must be able to record forty minutes of audio, attach
 * twenty photographs, background the app, have it killed by the OS, and come
 * back to find everything intact.
 *
 * Everything therefore writes to disk immediately, in a state the upload queue
 * can pick up later. Nothing is held in memory waiting for a network call, and
 * recording never blocks on one.
 *
 * Sync is one-way. Captures go up; report values are edited on the web and
 * never come back down. There is no merge conflict to solve here, so there is
 * no CRDT — building one would be solving a problem we deliberately do not
 * have.
 */

let database: SQLite.SQLiteDatabase | undefined;

export async function getLocalDb(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;

  database = await SQLite.openDatabaseAsync('fieldnote.db');

  await database.execAsync(`
    pragma journal_mode = WAL;
    pragma foreign_keys = ON;

    create table if not exists reports (
      id                text primary key,
      org_id            text not null,
      template_id       text not null,
      property_address  text not null,
      client_name       text,
      client_email      text,
      reference         text,
      inspected_at      integer,
      created_at        integer not null,
      -- 'local' until the server has acknowledged it. A report created with no
      -- signal is still a real report the surveyor can record against.
      sync_state        text not null default 'local'
    );

    create table if not exists captures (
      id            text primary key,
      report_id     text not null references reports(id) on delete cascade,
      file_uri      text not null,
      duration_ms   integer not null default 0,
      section_key   text,
      created_at    integer not null,
      upload_state  text not null default 'pending',
      attempts      integer not null default 0,
      last_error    text,
      remote_id     text
    );
    create index if not exists captures_pending_idx
      on captures(upload_state, created_at);

    create table if not exists photos (
      id                text primary key,
      report_id         text not null references reports(id) on delete cascade,
      capture_id        text,
      file_uri          text not null,
      section_key       text,
      caption           text,
      -- Position within the recording, so the reviewer sees the photograph
      -- against what was being said when it was taken.
      capture_offset_ms integer,
      created_at        integer not null,
      upload_state      text not null default 'pending',
      attempts          integer not null default 0,
      last_error        text,
      remote_id         text
    );
    create index if not exists photos_pending_idx
      on photos(upload_state, created_at);
  `);

  return database;
}

export interface LocalReport {
  id: string;
  org_id: string;
  template_id: string;
  property_address: string;
  client_name: string | null;
  client_email: string | null;
  reference: string | null;
  inspected_at: number | null;
  created_at: number;
  sync_state: 'local' | 'synced';
}

export interface LocalCapture {
  id: string;
  report_id: string;
  file_uri: string;
  duration_ms: number;
  section_key: string | null;
  created_at: number;
  upload_state: 'pending' | 'uploading' | 'uploaded' | 'failed';
  attempts: number;
  last_error: string | null;
  remote_id: string | null;
}

export async function createReport(report: Omit<LocalReport, 'sync_state'>): Promise<void> {
  const db = await getLocalDb();
  await db.runAsync(
    `insert into reports
       (id, org_id, template_id, property_address, client_name, client_email,
        reference, inspected_at, created_at, sync_state)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')`,
    report.id,
    report.org_id,
    report.template_id,
    report.property_address,
    report.client_name,
    report.client_email,
    report.reference,
    report.inspected_at,
    report.created_at,
  );
}

export async function listReports(): Promise<LocalReport[]> {
  const db = await getLocalDb();
  return db.getAllAsync<LocalReport>('select * from reports order by created_at desc');
}

/**
 * Record a finished capture.
 *
 * Called the moment recording stops, before anything is attempted over the
 * network. The row exists on disk with `pending` state; the queue takes it from
 * there whenever a connection appears.
 */
export async function addCapture(
  capture: Omit<LocalCapture, 'upload_state' | 'attempts' | 'last_error' | 'remote_id'>,
): Promise<void> {
  const db = await getLocalDb();
  await db.runAsync(
    `insert into captures (id, report_id, file_uri, duration_ms, section_key, created_at)
     values (?, ?, ?, ?, ?, ?)`,
    capture.id,
    capture.report_id,
    capture.file_uri,
    capture.duration_ms,
    capture.section_key,
    capture.created_at,
  );
}

export async function addPhoto(photo: {
  id: string;
  report_id: string;
  capture_id: string | null;
  file_uri: string;
  section_key: string | null;
  caption: string | null;
  capture_offset_ms: number | null;
  created_at: number;
}): Promise<void> {
  const db = await getLocalDb();
  await db.runAsync(
    `insert into photos
       (id, report_id, capture_id, file_uri, section_key, caption, capture_offset_ms, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    photo.id,
    photo.report_id,
    photo.capture_id,
    photo.file_uri,
    photo.section_key,
    photo.caption,
    photo.capture_offset_ms,
    photo.created_at,
  );
}

/** Everything still to go up, oldest first, across both tables. */
export async function pendingCount(): Promise<number> {
  const db = await getLocalDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `select
       (select count(*) from captures where upload_state in ('pending', 'failed')) +
       (select count(*) from photos   where upload_state in ('pending', 'failed')) as count`,
  );
  return row?.count ?? 0;
}

export async function nextPendingCaptures(limit = 3): Promise<LocalCapture[]> {
  const db = await getLocalDb();
  return db.getAllAsync<LocalCapture>(
    `select * from captures
      where upload_state in ('pending', 'failed')
      order by created_at
      limit ?`,
    limit,
  );
}

export async function setCaptureState(
  id: string,
  state: LocalCapture['upload_state'],
  options: { error?: string; remoteId?: string } = {},
): Promise<void> {
  const db = await getLocalDb();
  await db.runAsync(
    `update captures
        set upload_state = ?,
            attempts     = attempts + case when ? = 'failed' then 1 else 0 end,
            last_error   = ?,
            remote_id    = coalesce(?, remote_id)
      where id = ?`,
    state,
    state,
    options.error ?? null,
    options.remoteId ?? null,
    id,
  );
}

/**
 * Delete a capture's local audio once the server has it.
 *
 * Deliberately not automatic on upload: a forty-minute survey is a large file,
 * but deleting it the instant an HTTP 201 comes back means a server-side
 * failure loses the recording entirely. Cleared on a later run, once the
 * capture has been transcribed.
 */
export async function purgeUploaded(olderThanMs: number): Promise<string[]> {
  const db = await getLocalDb();
  const cutoff = Date.now() - olderThanMs;
  const rows = await db.getAllAsync<{ id: string; file_uri: string }>(
    `select id, file_uri from captures where upload_state = 'uploaded' and created_at < ?`,
    cutoff,
  );
  for (const row of rows) {
    await db.runAsync('delete from captures where id = ?', row.id);
  }
  return rows.map((row) => row.file_uri);
}
