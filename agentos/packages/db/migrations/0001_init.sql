-- AgentOS initial schema.
--
-- Hand-written SQL is the source of truth for the database, not generated
-- output. See docs/adr/0002-hand-written-sql-migrations.md — the short version
-- is that RLS policies, security-definer functions and partial indexes are the
-- parts of this schema most worth reviewing carefully, and they are exactly the
-- parts a schema-diff tool renders least legibly.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- Three roles with different reach:
--
--   agentos_app     the web app. Row-level security applies to it in full. It
--                   must never own a table, because an owner bypasses RLS.
--   agentos_worker  background jobs. Needs to see across organisations to run
--                   the nightly renewal sweep, so it bypasses RLS — and is the
--                   only role holding the document encryption keys.
--   agentos_portal  the client portal. Read-only, scoped to a single entity.
--
-- Passwords are set out of band; these statements only create the roles when a
-- deployment has not created them already (Supabase, for instance, manages its
-- own). LOGIN without a password cannot authenticate over TCP, so this is not
-- an open door.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agentos_app') then
    create role agentos_app nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'agentos_worker') then
    create role agentos_worker nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'agentos_portal') then
    create role agentos_portal nologin noinherit;
  end if;
end
$$;

create schema if not exists app;
grant usage on schema app to agentos_app, agentos_worker, agentos_portal;

-- ---------------------------------------------------------------------------
-- Session identity
-- ---------------------------------------------------------------------------
-- The current actor is read from a session GUC. Two sources are supported so
-- that the same policies work against Supabase (which sets request.jwt.claims)
-- and against a plain Postgres in CI (which sets app.user_id). The RLS tests in
-- packages/db/tests run against the latter, which means the policies proved in
-- CI are byte-for-byte the ones running in production.

create or replace function app.current_user_id() returns uuid
language plpgsql
stable
as $$
declare
  raw text;
begin
  raw := nullif(current_setting('app.user_id', true), '');

  if raw is null then
    begin
      raw := nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '');
    exception when others then
      raw := null;
    end;
  end if;

  if raw is null then
    return null;
  end if;

  return raw::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- The entity a client-portal session is scoped to. Null for staff sessions.
create or replace function app.current_portal_entity_id() returns uuid
language plpgsql
stable
as $$
declare
  raw text;
begin
  raw := nullif(current_setting('app.portal_entity_id', true), '');
  if raw is null then
    return null;
  end if;
  return raw::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- These are mirrored by the unions in packages/core/src/types.ts. A test reads
-- the labels back out of the live database and compares, so adding a value in
-- one place and forgetting the other fails CI rather than production.

create type member_role as enum ('owner', 'admin', 'manager', 'pro', 'viewer');

create type jurisdiction as enum (
  'AE-DU', 'AE-AZ', 'AE-SH', 'AE-RK', 'AE-AJ', 'AE-FU', 'AE-UQ', 'AE-FED', 'SA', 'OTHER'
);

create type entity_type as enum (
  'free_zone_llc', 'mainland_llc', 'branch', 'sole_establishment',
  'offshore', 'foundation', 'representative_office', 'other'
);

create type entity_status as enum ('active', 'onboarding', 'dormant', 'terminated');

create type renewable_doc_type as enum (
  'trade_licence', 'commercial_registration', 'establishment_card', 'immigration_card',
  'chamber_of_commerce', 'municipality_permit', 'ejari_lease', 'office_lease', 'visa_quota',
  'passport', 'residence_visa', 'iqama', 'emirates_id', 'labour_card',
  'medical_insurance', 'work_permit', 'other'
);

create type licence_type as enum (
  'commercial', 'professional', 'industrial', 'tourism',
  'e_commerce', 'freelance', 'general_trading', 'other'
);

create type establishment_record_type as enum (
  'establishment_card', 'immigration_card', 'labour_establishment', 'chamber_of_commerce',
  'vat_registration', 'corporate_tax_registration', 'gosi_registration', 'other'
);

create type doc_status as enum ('active', 'expiring', 'expired', 'cancelled', 'superseded');

create type renewal_status as enum (
  'open', 'in_progress', 'submitted', 'blocked', 'completed', 'cancelled'
);

create type renewal_source_type as enum (
  'licence', 'establishment_record', 'visa_quota', 'person_document'
);

create type task_status as enum (
  'todo', 'in_progress', 'waiting_client', 'waiting_authority', 'blocked', 'done', 'cancelled'
);

create type invoice_status as enum ('draft', 'issued', 'paid', 'void', 'overdue');

create type notification_channel as enum ('email', 'whatsapp', 'in_app');

create type notification_status as enum (
  'queued', 'sent', 'delivered', 'read', 'failed', 'skipped'
);

create type notification_audience as enum (
  'assigned_pro', 'account_manager', 'org_owner', 'client_contact'
);

create type extraction_review_status as enum (
  'pending_review', 'confirmed', 'corrected', 'rejected', 'manual_entry_required'
);

create type subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'paused'
);

create type payment_provider as enum ('stripe', 'moyasar', 'tap', 'manual');

create type plan_code as enum ('starter', 'growth', 'scale');

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table app_users (
  id uuid primary key,
  email citext not null unique,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_users is
  'Mirror of the auth provider''s user table. Held locally so org_members and '
  'assignee columns can carry a real foreign key, and so the app can join to a '
  'display name without a round trip to the auth service.';

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country char(2) not null default 'AE',
  default_currency char(3) not null default 'AED',
  default_locale text not null default 'en',
  timezone text not null default 'Asia/Dubai',
  -- Branding applied to client-facing email and the portal.
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisations_name_not_blank check (length(btrim(name)) > 0),
  constraint organisations_locale_supported check (default_locale in ('en', 'ar'))
);

create table org_members (
  org_id uuid not null references organisations (id) on delete cascade,
  user_id uuid not null references app_users (id) on delete cascade,
  role member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on org_members (user_id);

-- Membership lookup, used by every policy below.
--
-- SECURITY DEFINER because org_members is itself protected by RLS: a policy
-- that queried it directly would recurse. STABLE and marked leakproof-adjacent
-- by keeping the body to a single existence check.
create or replace function app.is_org_member(target_org uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from org_members
    where org_members.org_id = target_org
      and org_members.user_id = app.current_user_id()
  );
$$;

create or replace function app.has_org_role(target_org uuid, minimum member_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from org_members
    where org_members.org_id = target_org
      and org_members.user_id = app.current_user_id()
      and case org_members.role
            when 'owner' then 50 when 'admin' then 40 when 'manager' then 30
            when 'pro' then 20 else 10 end
          >=
          case minimum
            when 'owner' then 50 when 'admin' then 40 when 'manager' then 30
            when 'pro' then 20 else 10 end
  );
$$;

revoke all on function app.is_org_member(uuid) from public;
revoke all on function app.has_org_role(uuid, member_role) from public;
grant execute on function app.is_org_member(uuid) to agentos_app, agentos_worker, agentos_portal;
grant execute on function app.has_org_role(uuid, member_role) to agentos_app, agentos_worker;

create table client_entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  legal_name text not null,
  trade_name text,
  jurisdiction jurisdiction not null default 'OTHER',
  free_zone text,
  entity_type entity_type not null default 'other',
  incorporation_date date,
  status entity_status not null default 'active',
  primary_contact_name text,
  primary_contact_email citext,
  primary_contact_phone text,
  -- Which language this client's reminders go out in.
  preferred_locale text not null default 'en',
  account_manager_id uuid references app_users (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete. Identity documents belonging to a removed client are purged by
  -- a retention job rather than dropped mid-request; see docs/data-protection.md.
  deleted_at timestamptz,
  constraint client_entities_legal_name_not_blank check (length(btrim(legal_name)) > 0),
  constraint client_entities_locale_supported check (preferred_locale in ('en', 'ar'))
);

create index client_entities_org_idx on client_entities (org_id) where deleted_at is null;
create index client_entities_org_status_idx on client_entities (org_id, status) where deleted_at is null;
create index client_entities_jurisdiction_idx on client_entities (org_id, jurisdiction) where deleted_at is null;
create index client_entities_free_zone_idx on client_entities (org_id, free_zone) where deleted_at is null;
create index client_entities_name_trgm_idx on client_entities (org_id, lower(legal_name));

-- ---------------------------------------------------------------------------
-- Documents and the records that expire
-- ---------------------------------------------------------------------------

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid references client_entities (id) on delete cascade,
  person_id uuid,
  storage_path text not null,
  doc_type renewable_doc_type,
  mime_type text,
  size_bytes bigint,
  checksum text,
  uploaded_by uuid references app_users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  -- Model output, held verbatim for audit. Never read as authoritative.
  extracted jsonb,
  extraction_confidence numeric(4, 3),
  model_version text,
  prompt_version text,
  review_status extraction_review_status,
  reviewed_by uuid references app_users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint documents_confidence_range
    check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1)),
  -- An extraction that produced output must record which model and prompt made
  -- it, or the audit trail cannot answer "why did it say that".
  constraint documents_extraction_provenance
    check (extracted is null or (model_version is not null and prompt_version is not null))
);

create index documents_org_entity_idx on documents (org_id, entity_id);
create index documents_org_person_idx on documents (org_id, person_id);
create index documents_review_idx on documents (org_id, review_status)
  where review_status = 'pending_review';

create table licences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  licence_type licence_type not null default 'other',
  -- Encrypted at the column level. The plaintext licence number never lands
  -- here; see packages/db/src/crypto.ts and the test that proves it.
  number_encrypted text not null,
  -- Blind index (HMAC) so a number can be looked up without decrypting the table.
  number_hash text not null,
  -- Last four characters, in the clear, so a screen can identify a record
  -- without a decryption round trip.
  number_last4 text,
  issuing_authority text,
  issued_on date,
  expires_on date not null,
  status doc_status not null default 'active',
  document_id uuid references documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint licences_dates_ordered check (issued_on is null or issued_on <= expires_on),
  constraint licences_encrypted_envelope check (number_encrypted like 'v1.%')
);

create index licences_org_expiry_idx on licences (org_id, expires_on) where status = 'active';
create index licences_entity_idx on licences (entity_id);
create index licences_hash_idx on licences (org_id, number_hash);

create table establishment_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  record_type establishment_record_type not null,
  number_encrypted text not null,
  number_hash text not null,
  number_last4 text,
  issuing_authority text,
  issued_on date,
  expires_on date not null,
  status doc_status not null default 'active',
  document_id uuid references documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint establishment_records_dates_ordered check (issued_on is null or issued_on <= expires_on),
  constraint establishment_records_encrypted_envelope check (number_encrypted like 'v1.%')
);

create index establishment_records_org_expiry_idx
  on establishment_records (org_id, expires_on) where status = 'active';
create index establishment_records_entity_idx on establishment_records (entity_id);

create table visa_quotas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  total_quota integer not null default 0,
  used_quota integer not null default 0,
  as_of date not null,
  -- Quota is not strictly an expiry, but firms track a review date the same way
  -- and want it on the same dashboard.
  expires_on date,
  status doc_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visa_quotas_non_negative check (total_quota >= 0 and used_quota >= 0)
);

create index visa_quotas_org_expiry_idx on visa_quotas (org_id, expires_on) where status = 'active';
create index visa_quotas_entity_idx on visa_quotas (entity_id);

create table persons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  full_name text not null,
  role text,
  nationality text,
  email citext,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint persons_name_not_blank check (length(btrim(full_name)) > 0)
);

create index persons_entity_idx on persons (entity_id) where deleted_at is null;
create index persons_org_idx on persons (org_id) where deleted_at is null;

alter table documents
  add constraint documents_person_fk foreign key (person_id) references persons (id) on delete cascade;

create table person_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  person_id uuid not null references persons (id) on delete cascade,
  -- Denormalised from persons so entity-scoped policies and the portal filter
  -- do not need a join. Kept in step by a trigger.
  entity_id uuid not null references client_entities (id) on delete cascade,
  doc_type renewable_doc_type not null,
  number_encrypted text not null,
  number_hash text not null,
  number_last4 text,
  issuing_authority text,
  issued_on date,
  expires_on date not null,
  status doc_status not null default 'active',
  document_id uuid references documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint person_documents_dates_ordered check (issued_on is null or issued_on <= expires_on),
  constraint person_documents_encrypted_envelope check (number_encrypted like 'v1.%'),
  constraint person_documents_type_is_personal check (
    doc_type in ('passport', 'residence_visa', 'iqama', 'emirates_id',
                 'labour_card', 'medical_insurance', 'work_permit', 'other')
  )
);

create index person_documents_org_expiry_idx
  on person_documents (org_id, expires_on) where status = 'active';
create index person_documents_person_idx on person_documents (person_id);
create index person_documents_entity_idx on person_documents (entity_id);

-- ---------------------------------------------------------------------------
-- Renewal engine
-- ---------------------------------------------------------------------------

create table renewal_rules (
  id uuid primary key default gen_random_uuid(),
  -- Null means a system default shipped with the product. A firm's own row
  -- wins on specificity without the default having to be edited.
  org_id uuid references organisations (id) on delete cascade,
  jurisdiction jurisdiction,
  free_zone text,
  doc_type renewable_doc_type not null,
  lead_time_days integer not null,
  escalation_schedule jsonb not null,
  version integer not null default 1,
  effective_from date not null,
  -- Exclusive. Null means still in force.
  effective_to date,
  notes text,
  is_active boolean not null default true,
  created_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint renewal_rules_lead_time_sane check (lead_time_days >= 0 and lead_time_days <= 730),
  constraint renewal_rules_version_positive check (version >= 1),
  constraint renewal_rules_window_ordered check (effective_to is null or effective_from < effective_to),
  constraint renewal_rules_schedule_is_array check (jsonb_typeof(escalation_schedule) = 'array')
);

create index renewal_rules_lookup_idx on renewal_rules (doc_type, org_id, jurisdiction, free_zone)
  where is_active;
create unique index renewal_rules_version_unique_idx
  on renewal_rules (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    doc_type,
                    coalesce(jurisdiction::text, ''),
                    coalesce(lower(btrim(free_zone)), ''),
                    version);

create table renewals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  source_type renewal_source_type not null,
  source_id uuid not null,
  doc_type renewable_doc_type not null,
  opens_on date not null,
  due_on date not null,
  status renewal_status not null default 'open',
  assigned_to uuid references app_users (id) on delete set null,
  completed_on date,
  rule_id uuid references renewal_rules (id) on delete set null,
  rule_version integer,
  -- Frozen copy of the rule this renewal was opened under. Once a renewal
  -- exists it computes against this, not against the live rules table, so a
  -- rule change cannot silently move a ladder that is already running.
  rule_snapshot jsonb not null,
  last_client_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A renewal is identified by what it renews and when it is due, which makes
  -- the nightly generation sweep idempotent.
  constraint renewals_source_due_unique unique (org_id, source_type, source_id, due_on),
  constraint renewals_completed_consistency
    check ((status = 'completed') = (completed_on is not null))
);

create index renewals_dashboard_idx on renewals (org_id, due_on)
  where status in ('open', 'in_progress', 'submitted', 'blocked');
create index renewals_entity_idx on renewals (entity_id);
create index renewals_assignee_idx on renewals (org_id, assigned_to)
  where status in ('open', 'in_progress', 'submitted', 'blocked');

-- ---------------------------------------------------------------------------
-- Tasks, fees, invoicing
-- ---------------------------------------------------------------------------

create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  renewal_id uuid references renewals (id) on delete set null,
  task_type text not null,
  title text not null,
  status task_status not null default 'todo',
  assignee_id uuid references app_users (id) on delete set null,
  due_on date,
  notes text,
  completed_at timestamptz,
  created_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_not_blank check (length(btrim(title)) > 0),
  constraint tasks_completed_consistency
    check ((status = 'done') = (completed_at is not null))
);

create index tasks_board_idx on tasks (org_id, status, due_on);
create index tasks_entity_idx on tasks (entity_id);
create index tasks_assignee_idx on tasks (org_id, assignee_id)
  where status not in ('done', 'cancelled');
create index tasks_renewal_idx on tasks (renewal_id);

create table fee_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  task_id uuid references tasks (id) on delete set null,
  description text not null,
  -- Integer minor units. There are no floats near a ledger that reconciles
  -- money a firm has fronted on a client's behalf.
  amount_minor bigint not null,
  currency char(3) not null,
  paid_on date,
  receipt_document_id uuid references documents (id) on delete set null,
  recharged boolean not null default false,
  invoice_id uuid,
  category text,
  created_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_ledger_description_not_blank check (length(btrim(description)) > 0)
);

create index fee_ledger_entity_idx on fee_ledger (entity_id);
create index fee_ledger_org_paid_idx on fee_ledger (org_id, paid_on);
-- The reconciliation screen: money out of the door with nothing recovering it.
create index fee_ledger_unrecharged_idx on fee_ledger (org_id, entity_id)
  where recharged = false and invoice_id is null;

create table time_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  task_id uuid references tasks (id) on delete set null,
  user_id uuid references app_users (id) on delete set null,
  minutes integer not null,
  hourly_cost_minor bigint not null default 0,
  currency char(3) not null,
  logged_on date not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint time_logs_minutes_positive check (minutes > 0)
);

create index time_logs_entity_idx on time_logs (entity_id);
create index time_logs_org_date_idx on time_logs (org_id, logged_on);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  number text not null,
  issued_on date,
  due_on date,
  total_minor bigint not null default 0,
  currency char(3) not null,
  status invoice_status not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_unique unique (org_id, number)
);

create index invoices_entity_idx on invoices (entity_id);
create index invoices_org_status_idx on invoices (org_id, status);

alter table fee_ledger
  add constraint fee_ledger_invoice_fk foreign key (invoice_id) references invoices (id) on delete set null;

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  invoice_id uuid not null references invoices (id) on delete cascade,
  description text not null,
  quantity numeric(12, 3) not null default 1,
  unit_amount_minor bigint not null,
  amount_minor bigint not null,
  currency char(3) not null,
  -- Set when the line exists to recharge a government fee.
  fee_ledger_id uuid references fee_ledger (id) on delete set null,
  created_at timestamptz not null default now()
);

create index invoice_lines_invoice_idx on invoice_lines (invoice_id);

-- ---------------------------------------------------------------------------
-- Client portal
-- ---------------------------------------------------------------------------

create table client_portal_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid not null references client_entities (id) on delete cascade,
  email citext not null,
  full_name text,
  preferred_locale text not null default 'en',
  invited_at timestamptz,
  last_seen_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_portal_users_unique unique (org_id, entity_id, email),
  constraint client_portal_users_locale_supported check (preferred_locale in ('en', 'ar'))
);

create table client_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  portal_user_id uuid not null references client_portal_users (id) on delete cascade,
  -- Only the hash is stored. A leaked database does not hand out live portal links.
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index client_portal_sessions_user_idx on client_portal_sessions (portal_user_id);
create index client_portal_sessions_expiry_idx on client_portal_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Notifications, audit, billing, imports
-- ---------------------------------------------------------------------------

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  entity_id uuid references client_entities (id) on delete cascade,
  renewal_id uuid references renewals (id) on delete cascade,
  task_id uuid references tasks (id) on delete set null,
  channel notification_channel not null,
  audience notification_audience not null,
  template_key text not null,
  locale text not null default 'en',
  recipient text not null,
  -- Stable per rung, so a retry cannot double-send and a resumed worker can
  -- tell what it already did.
  dedupe_key text not null,
  status notification_status not null default 'queued',
  provider text,
  provider_message_id text,
  scheduled_on date not null,
  sent_at timestamptz,
  error text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Every reminder sent is logged against the entity, so the firm can prove to a
-- client that they were told three times.
create unique index notification_log_dedupe_idx
  on notification_log (org_id, coalesce(renewal_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key);
create index notification_log_entity_idx on notification_log (entity_id, created_at desc);
create index notification_log_renewal_idx on notification_log (renewal_id);
create index notification_log_pending_idx on notification_log (status, scheduled_on)
  where status = 'queued';

create table audit_log (
  id bigserial primary key,
  org_id uuid references organisations (id) on delete cascade,
  actor_user_id uuid references app_users (id) on delete set null,
  actor_type text not null default 'user',
  action text not null,
  target_table text not null,
  target_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_log_org_idx on audit_log (org_id, created_at desc);
create index audit_log_target_idx on audit_log (target_table, target_id);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organisations (id) on delete cascade,
  provider payment_provider not null default 'stripe',
  plan_code plan_code not null default 'starter',
  billing_interval text not null default 'monthly',
  status subscription_status not null default 'trialing',
  external_customer_id text,
  external_subscription_id text,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  -- Snapshot taken when the period opened, so a mid-period tier change is
  -- explainable on the invoice.
  entity_count_at_period_start integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_interval_supported check (billing_interval in ('monthly', 'annual'))
);

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  filename text not null,
  status text not null default 'preview',
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  issues jsonb not null default '[]'::jsonb,
  created_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint import_jobs_status_supported
    check (status in ('preview', 'importing', 'completed', 'failed'))
);

create index import_jobs_org_idx on import_jobs (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'organisations', 'app_users', 'client_entities', 'licences', 'establishment_records',
    'visa_quotas', 'persons', 'person_documents', 'renewals', 'tasks', 'fee_ledger',
    'invoices', 'subscriptions'
  ]
  loop
    execute format(
      'create trigger %I_touch_updated_at before update on %I
         for each row execute function app.touch_updated_at()',
      t, t
    );
  end loop;
end
$$;

-- person_documents.entity_id is denormalised from persons. Deriving it in a
-- trigger rather than trusting the caller means a mis-set entity_id cannot leak
-- a person document into another client's portal view.
create or replace function app.sync_person_document_entity() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner record;
begin
  select org_id, entity_id into owner from persons where id = new.person_id;
  if not found then
    raise exception 'person % does not exist', new.person_id;
  end if;
  new.org_id := owner.org_id;
  new.entity_id := owner.entity_id;
  return new;
end;
$$;

create trigger person_documents_sync_entity
  before insert or update of person_id on person_documents
  for each row execute function app.sync_person_document_entity();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- The app role gets DML on the business tables and nothing else. It cannot
-- create, alter or drop, and it does not own anything — an owner would bypass
-- every policy in 0002_rls.sql.

grant usage on schema public to agentos_app, agentos_worker, agentos_portal;

grant select, insert, update, delete on all tables in schema public to agentos_app;
grant select, insert, update, delete on all tables in schema public to agentos_worker;
grant usage, select on all sequences in schema public to agentos_app, agentos_worker;

-- The portal is read-only. Not "read-only by convention" — read-only because
-- no INSERT, UPDATE or DELETE grant exists for it.
-- Note what is absent: tasks, fee_ledger, time_logs, notes and the audit log.
-- The portal shows a client the state of their own documents and renewals, not
-- the firm's internal working.
grant select on
  client_entities, licences, establishment_records, visa_quotas, persons,
  person_documents, renewals, documents, organisations
to agentos_portal;
