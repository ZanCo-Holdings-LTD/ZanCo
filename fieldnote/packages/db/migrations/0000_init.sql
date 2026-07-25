-- ---------------------------------------------------------------------------
-- 0000_init: extensions, enums, tables, indexes.
--
-- Written by hand rather than generated, because the RLS policies in 0001 are
-- the security boundary and they need to be reviewable alongside the tables
-- they protect.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- Supabase ships `authenticated` / `anon` / `service_role`; a bare Postgres in
-- CI does not. Create them if missing so migrations apply identically in both.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Identity helper
--
-- Reads the subject from the request JWT exactly the way Supabase's auth.uid()
-- does, but lives in our own schema so the RLS tests can exercise the real
-- policies against a plain Postgres container in CI. Every policy resolves
-- through this one function.
-- ---------------------------------------------------------------------------
create or replace function public.fieldnote_uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

comment on function public.fieldnote_uid() is
  'Current authenticated user id from the request JWT. Null when unauthenticated.';

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type org_role       as enum ('owner', 'admin', 'member');
create type report_status  as enum ('draft', 'processing', 'needs_review', 'ready', 'sent');
create type upload_state   as enum ('pending', 'uploading', 'uploaded', 'failed');
create type field_type     as enum ('text', 'long_text', 'number', 'boolean', 'enum', 'date', 'multi_enum');
create type vertical       as enum ('uk_damp_timber', 'uk_eicr', 'gcc_snagging');
create type job_state      as enum ('queued', 'running', 'succeeded', 'failed', 'dead');
create type job_kind       as enum (
  'transcribe_capture', 'structure_report', 'render_pdf', 'deliver_report', 'embed_phrase_example'
);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table org_members (
  org_id        uuid not null references organisations(id) on delete cascade,
  user_id       uuid not null,
  role          org_role not null default 'member',
  invited_email text,
  created_at    timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on org_members(user_id);

create table profiles (
  id                uuid primary key,
  org_id            uuid not null references organisations(id) on delete cascade,
  full_name         text,
  company_name      text,
  logo_path         text,
  letterhead_path   text,
  signature_path    text,
  professional_body text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index profiles_org_idx on profiles(org_id);

-- Tie memberships and profiles to Supabase auth so account deletion cascades.
-- Skipped on a bare Postgres (CI), where auth.users does not exist.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    alter table org_members
      add constraint org_members_user_fk
      foreign key (user_id) references auth.users(id) on delete cascade;
    alter table profiles
      add constraint profiles_user_fk
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Templates — the moat
-- ---------------------------------------------------------------------------
create table templates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references organisations(id) on delete cascade,
  vertical     vertical not null,
  name         text not null,
  version      integer not null default 1,
  is_system    boolean not null default false,
  asr_keywords jsonb not null default '[]'::jsonb,
  pdf_template text not null default 'default',
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint templates_name_version_unique unique (org_id, name, version),
  -- A system template belongs to no org; an org template is never "system".
  constraint templates_system_has_no_org check ((is_system and org_id is null) or (not is_system))
);
create index templates_org_idx on templates(org_id);
create index templates_vertical_idx on templates(vertical);

create table template_sections (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  key         text not null,
  title       text not null,
  order_index integer not null,
  guidance    text,
  constraint template_sections_key_unique unique (template_id, key)
);
create index template_sections_template_idx on template_sections(template_id);

create table template_fields (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references template_sections(id) on delete cascade,
  key             text not null,
  label           text not null,
  type            field_type not null,
  required        boolean not null default false,
  enum_values     jsonb,
  extraction_hint text,
  order_index     integer not null,
  constraint template_fields_key_unique unique (section_id, key),
  -- An enum field without options cannot be filled in, generated or rendered.
  constraint template_fields_enum_has_values check (
    type not in ('enum', 'multi_enum')
    or (enum_values is not null and jsonb_array_length(enum_values) > 0)
  )
);
create index template_fields_section_idx on template_fields(section_id);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table reports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade,
  owner_id         uuid not null,
  template_id      uuid not null references templates(id) on delete restrict,
  template_version integer not null,
  status           report_status not null default 'draft',
  property_address text not null,
  client_name      text,
  client_email     text,
  reference        text,
  inspected_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index reports_org_idx on reports(org_id);
create index reports_org_created_idx on reports(org_id, created_at desc);
create index reports_org_status_idx on reports(org_id, status);
create index reports_owner_idx on reports(owner_id);

-- ---------------------------------------------------------------------------
-- Captures and media
-- ---------------------------------------------------------------------------
create table captures (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade,
  report_id        uuid not null references reports(id) on delete cascade,
  storage_path     text not null,
  duration_ms      integer not null default 0,
  section_key      text,
  local_transcript text,
  cloud_transcript jsonb,
  asr_provider     text,
  asr_model        text,
  upload_state     upload_state not null default 'pending',
  transcribed_at   timestamptz,
  client_id        text,
  created_at       timestamptz not null default now(),
  -- The phone retries uploads aggressively; this makes a retry idempotent.
  constraint captures_client_id_unique unique (report_id, client_id)
);
create index captures_report_idx on captures(report_id);
create index captures_org_idx on captures(org_id);
create index captures_upload_state_idx on captures(upload_state);

create table media_assets (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  report_id         uuid not null references reports(id) on delete cascade,
  capture_id        uuid references captures(id) on delete set null,
  section_key       text,
  storage_path      text not null,
  caption           text,
  captured_at       timestamptz,
  capture_offset_ms integer,
  exif              jsonb,
  order_index       integer not null default 0,
  client_id         text,
  created_at        timestamptz not null default now(),
  constraint media_assets_client_id_unique unique (report_id, client_id)
);
create index media_assets_report_idx on media_assets(report_id);
create index media_assets_report_section_idx on media_assets(report_id, section_key);
create index media_assets_org_idx on media_assets(org_id);

-- ---------------------------------------------------------------------------
-- Report values — generated vs final
-- ---------------------------------------------------------------------------
create table report_values (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  report_id       uuid not null references reports(id) on delete cascade,
  field_id        uuid not null references template_fields(id) on delete cascade,
  value           jsonb,
  generated_value jsonb,
  confidence      numeric(4,3),
  source_span     jsonb,
  model_version   text,
  prompt_version  text,
  edited_by_human boolean not null default false,
  reviewed_at     timestamptz,
  reviewed_by     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint report_values_report_field_unique unique (report_id, field_id),
  constraint report_values_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);
create index report_values_report_idx on report_values(report_id);
create index report_values_org_idx on report_values(org_id);

-- ---------------------------------------------------------------------------
-- Versions and delivery
-- ---------------------------------------------------------------------------
create table report_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  report_id   uuid not null references reports(id) on delete cascade,
  version_no  integer not null,
  pdf_path    text not null,
  snapshot    text,
  byte_size   integer,
  rendered_at timestamptz not null default now(),
  rendered_by uuid,
  constraint report_versions_report_version_unique unique (report_id, version_no)
);
create index report_versions_report_idx on report_versions(report_id);

create table deliveries (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  report_id           uuid not null references reports(id) on delete cascade,
  version_id          uuid not null references report_versions(id) on delete restrict,
  to_email            text not null,
  subject             text,
  message             text,
  sent_at             timestamptz,
  opened_at           timestamptz,
  failed_at           timestamptz,
  failure_reason      text,
  provider_message_id text,
  sent_by             uuid,
  created_at          timestamptz not null default now()
);
create index deliveries_report_idx on deliveries(report_id);
create index deliveries_provider_message_idx on deliveries(provider_message_id);

-- ---------------------------------------------------------------------------
-- Learning loop
-- ---------------------------------------------------------------------------
create table phrase_examples (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organisations(id) on delete cascade,
  user_id        uuid not null,
  field_id       uuid not null references template_fields(id) on delete cascade,
  generated_text text not null,
  final_text     text not null,
  edit_distance  numeric(5,4),
  embedding      vector(1536),
  created_at     timestamptz not null default now()
);
create index phrase_examples_user_field_idx on phrase_examples(user_id, field_id);
create index phrase_examples_org_idx on phrase_examples(org_id);
create index phrase_examples_created_idx on phrase_examples(created_at desc);

-- ---------------------------------------------------------------------------
-- Queue
-- ---------------------------------------------------------------------------
create table jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  kind            job_kind not null,
  state           job_state not null default 'queued',
  payload         jsonb not null,
  idempotency_key text not null,
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  run_after       timestamptz not null default now(),
  locked_at       timestamptz,
  locked_by       text,
  last_error      text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint jobs_idempotency_unique unique (kind, idempotency_key)
);
create index jobs_claim_idx on jobs(state, run_after) where state = 'queued';
create index jobs_org_idx on jobs(org_id);
create index jobs_locked_idx on jobs(locked_at) where state = 'running';

-- ---------------------------------------------------------------------------
-- Billing and cost instrumentation
-- ---------------------------------------------------------------------------
create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null unique references organisations(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan_id                text not null default 'solo_monthly',
  seats                  integer not null default 1,
  status                 text not null default 'trialing',
  trial_ends_at          timestamptz,
  current_period_end     timestamptz,
  cancel_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint subscriptions_seats_positive check (seats > 0)
);
create index subscriptions_stripe_customer_idx on subscriptions(stripe_customer_id);

create table report_costs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  report_id           uuid not null unique references reports(id) on delete cascade,
  transcription_usd   numeric(10,6) not null default 0,
  structuring_usd     numeric(10,6) not null default 0,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cached_input_tokens integer not null default 0,
  audio_ms            integer not null default 0,
  updated_at          timestamptz not null default now()
);
create index report_costs_org_idx on report_costs(org_id);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index audit_log_org_created_idx on audit_log(org_id, created_at desc);
create index audit_log_entity_idx on audit_log(entity_type, entity_id);
