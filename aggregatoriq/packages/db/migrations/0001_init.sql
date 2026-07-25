-- AggregatorIQ initial schema.
--
-- Three layers, never blurred. See docs/adr/0001-raw-canonical-derived-layers.md.
--
--   RAW        source_documents, source_rows. Written once, never updated. The
--              statement as the aggregator sent it.
--   CANONICAL  orders, payouts, payout_lines. Interpreted, every row pointing
--              back at the raw row it came from.
--   DERIVED    recon_runs, matches, variances, disputes. Recomputable from
--              raw plus configuration, and safe to throw away and rebuild.
--
-- Hand-written SQL is the source of truth. Drizzle provides the typed query
-- layer, kept honest by a parity test that reads the live catalogue.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
--   aggregatoriq_app     the web app. RLS applies in full. Never owns a table,
--                        because an owner bypasses RLS.
--   aggregatoriq_worker  ingestion, parsing and reconciliation jobs. Needs to
--                        see across organisations, so it bypasses RLS.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aggregatoriq_app') then
    create role aggregatoriq_app nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'aggregatoriq_worker') then
    create role aggregatoriq_worker nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists app;
grant usage on schema app to aggregatoriq_app, aggregatoriq_worker;

-- The current actor, read from a session GUC. Two sources so the same policies
-- work against Supabase (request.jwt.claims) and a plain Postgres in CI
-- (app.user_id) — meaning the policies proved in CI are the ones in production.
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

-- ---------------------------------------------------------------------------
-- Enums (mirrored by packages/core/src/types.ts, checked by a test)
-- ---------------------------------------------------------------------------

create type member_role as enum ('owner', 'admin', 'analyst', 'viewer');

create type aggregator_code as enum (
  'talabat', 'hungerstation', 'jahez', 'deliveroo', 'careem', 'noon'
);

create type source_document_kind as enum (
  'payout_statement', 'order_export', 'invoice', 'adjustment_report', 'unknown'
);

create type received_via as enum ('upload', 'email', 'free_audit');

create type parse_status as enum (
  'pending', 'parsed', 'partially_parsed', 'needs_review', 'failed'
);

create type parse_method as enum ('deterministic', 'llm', 'manual');

create type order_status as enum (
  'delivered', 'cancelled', 'rejected', 'refunded', 'partially_refunded', 'unknown'
);

create type payout_line_type as enum (
  'gross_sale', 'commission', 'delivery_fee', 'promo_funding', 'promo_recharge',
  'refund', 'cancellation', 'chargeback', 'vat', 'adjustment', 'penalty', 'tip', 'other'
);

create type vat_treatment as enum (
  'commission_on_net', 'commission_on_gross', 'zero_rated', 'exempt'
);

create type match_method as enum (
  'exact_order_id', 'order_id_and_amount', 'fuzzy_time_and_amount', 'manual'
);

create type recon_run_status as enum ('running', 'completed', 'failed');

create type variance_status as enum ('open', 'dismissed', 'disputed', 'recovered', 'rejected');

create type dispute_outcome as enum (
  'pending', 'accepted', 'partially_accepted', 'rejected', 'withdrawn'
);

create type recoverability as enum ('recoverable', 'investigate', 'flag');

create type fee_bearer as enum ('aggregator', 'operator', 'customer');

create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'paused');

create type payment_provider as enum ('stripe', 'moyasar', 'tap', 'manual');

create type plan_code as enum ('standard', 'multi_branch', 'recovery_share');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table app_users (
  id uuid primary key,
  email citext not null unique,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_users is
  'Mirror of the auth provider''s user table, held locally so memberships and '
  'assignee columns can carry a real foreign key.';

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country char(2) not null default 'AE',
  base_currency char(3) not null default 'AED',
  default_locale text not null default 'en',
  -- Per-org materiality. Variance noise destroys trust faster than missed
  -- variances, and every firm draws that line somewhere slightly different.
  materiality_threshold_minor bigint not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisations_name_not_blank check (length(btrim(name)) > 0),
  constraint organisations_locale_supported check (default_locale in ('en', 'ar')),
  constraint organisations_materiality_non_negative check (materiality_threshold_minor >= 0)
);

create table org_members (
  org_id uuid not null references organisations (id) on delete cascade,
  user_id uuid not null references app_users (id) on delete cascade,
  role member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on org_members (user_id);

-- Membership lookup used by every policy in 0002_rls.sql. SECURITY DEFINER
-- because org_members is itself protected by RLS and a policy querying it
-- directly would recurse.
create or replace function app.is_org_member(target_org uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from org_members
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
    select 1 from org_members
    where org_members.org_id = target_org
      and org_members.user_id = app.current_user_id()
      and case org_members.role
            when 'owner' then 40 when 'admin' then 30 when 'analyst' then 20 else 10 end
          >=
          case minimum
            when 'owner' then 40 when 'admin' then 30 when 'analyst' then 20 else 10 end
  );
$$;

create or replace function app.org_has_members(target_org uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from org_members where org_id = target_org);
$$;

create or replace function app.shares_org_with(target_user uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from org_members mine
    join org_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = app.current_user_id() and theirs.user_id = target_user
  );
$$;

revoke all on function app.is_org_member(uuid) from public;
revoke all on function app.has_org_role(uuid, member_role) from public;
revoke all on function app.org_has_members(uuid) from public;
revoke all on function app.shares_org_with(uuid) from public;
grant execute on function app.is_org_member(uuid) to aggregatoriq_app, aggregatoriq_worker;
grant execute on function app.has_org_role(uuid, member_role) to aggregatoriq_app, aggregatoriq_worker;
grant execute on function app.org_has_members(uuid) to aggregatoriq_app, aggregatoriq_worker;
grant execute on function app.shares_org_with(uuid) to aggregatoriq_app, aggregatoriq_worker;

create table brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_name_not_blank check (length(btrim(name)) > 0),
  constraint brands_name_unique unique (org_id, name)
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  brand_id uuid references brands (id) on delete set null,
  name text not null,
  city text,
  -- IANA zone. Load-bearing: it decides which statement period an order falls in.
  timezone text not null default 'Asia/Dubai',
  currency char(3) not null default 'AED',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint branches_name_not_blank check (length(btrim(name)) > 0)
);

create index branches_org_idx on branches (org_id) where deleted_at is null;
create index branches_brand_idx on branches (brand_id);

-- ---------------------------------------------------------------------------
-- Aggregator configuration
-- ---------------------------------------------------------------------------

create table aggregators (
  id uuid primary key default gen_random_uuid(),
  code aggregator_code not null unique,
  name text not null,
  countries char(2)[] not null default '{}',
  -- Known statement layouts, keyed by header fingerprint. Format drift is
  -- detected by a fingerprint miss, which is what stops silent wrong numbers.
  statement_formats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table branch_aggregator_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  aggregator_id uuid not null references aggregators (id) on delete restrict,
  external_store_id text not null,
  -- What the contract says, as a fraction: 0.2500 is 25%.
  contracted_commission_rate numeric(6, 4) not null,
  -- Who funds what, by promo type.
  promo_share_terms jsonb not null default '{"terms":[],"defaultAggregatorSharePct":0}'::jsonb,
  vat_treatment vat_treatment not null default 'commission_on_net',
  vat_rate numeric(6, 4) not null default 0.05,
  payout_cycle_days integer not null default 14,
  delivery_fee_bearer fee_bearer not null default 'customer',
  currency char(3) not null default 'AED',
  -- Rates change and history matters: a March order is judged against March's
  -- terms. Exclusive upper bound.
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint baa_rate_range check (contracted_commission_rate >= 0 and contracted_commission_rate <= 1),
  constraint baa_vat_range check (vat_rate >= 0 and vat_rate <= 1),
  constraint baa_cycle_positive check (payout_cycle_days > 0),
  constraint baa_window_ordered check (effective_to is null or effective_from < effective_to)
);

create index baa_lookup_idx
  on branch_aggregator_accounts (branch_id, aggregator_id, effective_from desc);
create index baa_org_idx on branch_aggregator_accounts (org_id);
create index baa_store_idx on branch_aggregator_accounts (aggregator_id, external_store_id);

-- Overlapping periods for the same branch and aggregator would make "which rate
-- applied in March" ambiguous, and an ambiguous rate is a commission variance
-- nobody can defend. Enforced with an exclusion constraint rather than left to
-- application code.
create extension if not exists btree_gist;
alter table branch_aggregator_accounts
  add constraint baa_no_overlapping_periods
  exclude using gist (
    branch_id with =,
    aggregator_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

-- ---------------------------------------------------------------------------
-- RAW LAYER — written once, never updated
-- ---------------------------------------------------------------------------

create table source_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organisations (id) on delete cascade,
  branch_id uuid references branches (id) on delete cascade,
  aggregator_id uuid references aggregators (id) on delete restrict,
  kind source_document_kind not null default 'unknown',
  storage_path text not null,
  original_filename text,
  received_via received_via not null,
  received_at timestamptz not null default now(),
  period_start date,
  period_end date,
  -- Content hash. Re-uploading the same statement must not double-count it.
  checksum text not null,
  byte_size bigint,
  -- Which parser and which rung of the ladder produced the rows.
  parser_key text,
  parser_version text,
  parse_method parse_method,
  header_fingerprint text,
  parse_status parse_status not null default 'pending',
  parse_error text,
  parsed_at timestamptz,
  row_count integer not null default 0,
  -- Free-audit uploads have no org yet. They are claimed on signup or expire.
  audit_token text,
  created_at timestamptz not null default now(),
  constraint source_documents_period_ordered
    check (period_start is null or period_end is null or period_start <= period_end),
  -- Either it belongs to an organisation, or it is an anonymous free-audit
  -- upload holding a token. Never neither.
  constraint source_documents_ownership
    check (org_id is not null or audit_token is not null)
);

-- Checksum deduplication, scoped per org so two customers uploading the same
-- aggregator template do not collide.
create unique index source_documents_checksum_idx
  on source_documents (org_id, checksum) where org_id is not null;
create index source_documents_branch_idx on source_documents (branch_id, period_start);
create index source_documents_status_idx on source_documents (parse_status)
  where parse_status in ('pending', 'needs_review', 'failed');
create unique index source_documents_audit_token_idx on source_documents (audit_token)
  where audit_token is not null;

create table source_rows (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references source_documents (id) on delete cascade,
  org_id uuid references organisations (id) on delete cascade,
  row_index integer not null,
  -- The row exactly as it arrived. Never edited: a parser fix is a replay, not
  -- an update, which is what makes historical results reproducible.
  raw jsonb not null,
  created_at timestamptz not null default now(),
  constraint source_rows_unique unique (source_document_id, row_index)
);

create index source_rows_document_idx on source_rows (source_document_id, row_index);

-- The raw layer is immutable, enforced rather than promised. A parser fix
-- replays into a new canonical set; it never rewrites what the aggregator sent.
--
-- UPDATE only. Deletion is deliberately left to grants and foreign keys, for two
-- reasons: an organisation deleting its account must actually take its raw
-- statements with it, and `orders.source_row_id` is `on delete restrict`, so a
-- raw row cannot be removed while anything derived from it survives. Blocking
-- DELETE here as well would make "delete my account" impossible, which is a
-- worse outcome than the one this trigger is guarding against — and the app role
-- has no DELETE grant on this table anyway (see 0002_rls.sql).
create or replace function app.forbid_raw_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception
    'source_rows is append-only. Raw rows are immutable so that a parser fix is '
    'replayable and historical reconciliations stay reproducible. Re-parse into a '
    'new canonical set instead of editing the raw row.';
end;
$$;

create trigger source_rows_no_update
  before update on source_rows
  for each row execute function app.forbid_raw_mutation();

-- ---------------------------------------------------------------------------
-- CANONICAL LAYER
-- ---------------------------------------------------------------------------

create table orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  aggregator_id uuid not null references aggregators (id) on delete restrict,
  external_order_id text not null,
  ordered_at timestamptz not null,
  -- The calendar date in the branch's own timezone. Stored because it decides
  -- statement-period membership and recomputing it per query invites drift.
  local_date date not null,
  gross_amount_minor bigint not null,
  item_total_minor bigint not null,
  delivery_fee_minor bigint not null default 0,
  vat_amount_minor bigint not null default 0,
  discount_total_minor bigint not null default 0,
  promo_funding jsonb not null default '[]'::jsonb,
  status order_status not null default 'unknown',
  currency char(3) not null,
  -- Mandatory lineage. Every canonical value points at the raw row it came from.
  source_row_id uuid not null references source_rows (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint orders_external_id_not_blank check (length(btrim(external_order_id)) > 0),
  constraint orders_promo_funding_is_array check (jsonb_typeof(promo_funding) = 'array'),
  -- Re-parsing the same document must not create a second copy of the order.
  constraint orders_unique unique (org_id, branch_id, aggregator_id, external_order_id)
);

create index orders_period_idx on orders (branch_id, aggregator_id, local_date);
create index orders_org_idx on orders (org_id, local_date);
create index orders_external_idx on orders (aggregator_id, external_order_id);
create index orders_source_row_idx on orders (source_row_id);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  aggregator_id uuid not null references aggregators (id) on delete restrict,
  external_payout_id text not null,
  period_start date not null,
  period_end date not null,
  gross_minor bigint not null default 0,
  deductions_minor bigint not null default 0,
  net_minor bigint not null default 0,
  currency char(3) not null,
  paid_on date,
  source_document_id uuid not null references source_documents (id) on delete restrict,
  source_row_id uuid not null references source_rows (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint payouts_period_ordered check (period_start <= period_end),
  constraint payouts_unique unique (org_id, branch_id, aggregator_id, external_payout_id)
);

create index payouts_period_idx on payouts (branch_id, aggregator_id, period_start, period_end);
create index payouts_document_idx on payouts (source_document_id);

create table payout_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  payout_id uuid not null references payouts (id) on delete cascade,
  -- Null when the aggregator gave no order reference — itself a finding.
  external_order_id text,
  line_type payout_line_type not null,
  amount_minor bigint not null,
  currency char(3) not null,
  description text,
  reference text,
  source_row_id uuid not null references source_rows (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- The sign convention, enforced in the database. A parser emitting a positive
  -- commission fails here rather than producing a plausible wrong number.
  constraint payout_lines_deductions_negative check (
    line_type not in ('commission', 'promo_recharge', 'refund', 'cancellation', 'chargeback', 'penalty')
    or amount_minor <= 0
  ),
  constraint payout_lines_sales_positive check (
    line_type <> 'gross_sale' or amount_minor >= 0
  )
);

create index payout_lines_payout_idx on payout_lines (payout_id);
create index payout_lines_order_idx on payout_lines (payout_id, external_order_id);
create index payout_lines_source_row_idx on payout_lines (source_row_id);

-- ---------------------------------------------------------------------------
-- DERIVED LAYER — recomputable from raw plus configuration
-- ---------------------------------------------------------------------------

create table cause_codes (
  code text primary key,
  label text not null,
  label_ar text,
  description text not null,
  dispute_template_key text,
  recoverability recoverability not null,
  -- Whether the amount counts towards the headline recovery number. The single
  -- most consequential flag in the product.
  counts_towards_recovery boolean not null,
  created_at timestamptz not null default now(),
  constraint cause_codes_recoverability_consistent
    check (counts_towards_recovery = (recoverability = 'recoverable'))
);

create table recon_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  aggregator_id uuid not null references aggregators (id) on delete restrict,
  period_start date not null,
  period_end date not null,
  -- Recorded so historical results stay explainable when the engine changes.
  engine_version text not null,
  rule_set_version text not null,
  run_key text not null,
  materiality_threshold_minor bigint not null,
  currency char(3) not null,
  status recon_run_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  order_count integer not null default 0,
  payout_line_count integer not null default 0,
  variance_count integer not null default 0,
  unmatched_line_count integer not null default 0,
  recovery_total_minor bigint not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  error text,
  triggered_by uuid references app_users (id) on delete set null,
  constraint recon_runs_period_ordered check (period_start <= period_end)
);

create index recon_runs_branch_idx on recon_runs (branch_id, period_start desc);
create index recon_runs_org_idx on recon_runs (org_id, started_at desc);
create index recon_runs_run_key_idx on recon_runs (run_key);

create table matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  recon_run_id uuid not null references recon_runs (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  payout_line_ids uuid[] not null,
  method match_method not null,
  confidence numeric(4, 3) not null,
  constraint matches_confidence_range check (confidence >= 0 and confidence <= 1),
  constraint matches_lines_present check (cardinality(payout_line_ids) > 0)
);

create index matches_run_idx on matches (recon_run_id);
create index matches_order_idx on matches (order_id);

create table unmatched_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  recon_run_id uuid not null references recon_runs (id) on delete cascade,
  payout_line_id uuid not null references payout_lines (id) on delete cascade,
  reason text not null,
  resolved_at timestamptz,
  resolved_by uuid references app_users (id) on delete set null,
  constraint unmatched_lines_unique unique (recon_run_id, payout_line_id)
);

create index unmatched_lines_run_idx on unmatched_lines (recon_run_id) where resolved_at is null;

create table variances (
  -- Deterministic, derived from the variance's own content, so a re-run of an
  -- unchanged period upserts rather than duplicating.
  id uuid primary key,
  recon_run_id uuid not null references recon_runs (id) on delete cascade,
  org_id uuid not null references organisations (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  aggregator_id uuid not null references aggregators (id) on delete restrict,
  order_id uuid references orders (id) on delete set null,
  cause_code text not null references cause_codes (code) on delete restrict,
  expected_minor bigint not null,
  actual_minor bigint not null,
  delta_minor bigint not null,
  currency char(3) not null,
  confidence numeric(4, 3) not null,
  -- {source_row_ids: [...], rule: '...', computation: '...', inputs: {...}}
  evidence jsonb not null,
  status variance_status not null default 'open',
  dismissed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variances_confidence_range check (confidence >= 0 and confidence <= 1),
  constraint variances_delta_consistent check (delta_minor = expected_minor - actual_minor),
  -- The lineage invariant, enforced for the third time. No variance may exist
  -- without source rows: it is checked in createVariance, asserted in the
  -- engine tests, and constrained here.
  --
  -- Every branch is coalesced, because a CHECK whose expression evaluates to
  -- NULL *passes*. Written the obvious way, an `evidence` that was a JSON string
  -- rather than an object would make `jsonb_typeof(evidence -> 'source_row_ids')`
  -- NULL and sail straight through the constraint meant to stop it.
  constraint variances_evidence_is_object check (
    coalesce(jsonb_typeof(evidence), '') = 'object'
  ),
  constraint variances_evidence_has_source_rows check (
    coalesce(jsonb_typeof(evidence -> 'source_row_ids'), '') = 'array'
    and coalesce(jsonb_array_length(evidence -> 'source_row_ids'), 0) > 0
  ),
  constraint variances_evidence_has_rule check (
    coalesce(length(btrim(evidence ->> 'rule')), 0) > 0
  ),
  constraint variances_evidence_has_computation check (
    coalesce(length(btrim(evidence ->> 'computation')), 0) > 0
  )
);

create index variances_run_idx on variances (recon_run_id);
create index variances_org_status_idx on variances (org_id, status);
create index variances_branch_idx on variances (branch_id, created_at desc);
create index variances_cause_idx on variances (org_id, cause_code);
create index variances_order_idx on variances (order_id);
-- The disputes workflow: open recoverable findings, biggest first.
create index variances_open_recoverable_idx on variances (org_id, delta_minor desc)
  where status = 'open';

create table disputes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  branch_id uuid references branches (id) on delete set null,
  aggregator_id uuid not null references aggregators (id) on delete restrict,
  reference text not null,
  variance_ids uuid[] not null,
  claimed_minor bigint not null default 0,
  currency char(3) not null,
  pack_document_path text,
  submitted_at timestamptz,
  external_reference text,
  outcome dispute_outcome not null default 'pending',
  recovered_minor bigint not null default 0,
  outcome_recorded_at timestamptz,
  notes text,
  created_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disputes_reference_unique unique (org_id, reference),
  constraint disputes_variances_present check (cardinality(variance_ids) > 0),
  constraint disputes_recovered_non_negative check (recovered_minor >= 0)
);

create index disputes_org_idx on disputes (org_id, created_at desc);
create index disputes_outcome_idx on disputes (org_id, outcome);

-- ---------------------------------------------------------------------------
-- Ingestion plumbing, billing, audit
-- ---------------------------------------------------------------------------

create table ingestion_addresses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  aggregator_id uuid not null references aggregators (id) on delete restrict,
  -- The local part of b7k2m9@in.aggregatoriq.com. Random, not guessable: it is
  -- an unauthenticated ingestion endpoint.
  local_part text not null unique,
  is_active boolean not null default true,
  last_received_at timestamptz,
  received_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint ingestion_addresses_local_part_format check (local_part ~ '^[a-z0-9]{6,32}$'),
  constraint ingestion_addresses_unique unique (branch_id, aggregator_id)
);

create table parser_fingerprints (
  id uuid primary key default gen_random_uuid(),
  aggregator_id uuid not null references aggregators (id) on delete cascade,
  parser_key text not null,
  -- Hash of the normalised header row. A miss means the aggregator changed
  -- their format without telling anyone, and that alert is what stops silent
  -- wrong numbers.
  fingerprint text not null,
  header_sample jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  is_known boolean not null default true,
  constraint parser_fingerprints_unique unique (aggregator_id, fingerprint)
);

create index parser_fingerprints_unknown_idx on parser_fingerprints (aggregator_id)
  where is_known = false;

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organisations (id) on delete cascade,
  provider payment_provider not null default 'stripe',
  plan_code plan_code not null default 'standard',
  billing_interval text not null default 'monthly',
  status subscription_status not null default 'trialing',
  -- Founding rate is locked per account, so it lives on the row rather than
  -- being recomputed from a price list that will change.
  price_per_branch_minor bigint not null,
  currency char(3) not null default 'GBP',
  branch_limit integer,
  external_customer_id text,
  external_subscription_id text,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_interval_supported check (billing_interval in ('monthly', 'annual'))
);

create table analytics_events (
  id bigserial primary key,
  org_id uuid references organisations (id) on delete cascade,
  user_id uuid references app_users (id) on delete set null,
  name text not null,
  properties jsonb not null default '{}'::jsonb,
  -- Anonymous free-audit events have no org. Correlated by session id.
  anonymous_id text,
  created_at timestamptz not null default now()
);

create index analytics_events_name_idx on analytics_events (name, created_at desc);
create index analytics_events_org_idx on analytics_events (org_id, created_at desc);

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
    'app_users', 'organisations', 'brands', 'branches', 'branch_aggregator_accounts',
    'variances', 'disputes', 'subscriptions'
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to aggregatoriq_app, aggregatoriq_worker;
grant select, insert, update, delete on all tables in schema public to aggregatoriq_app;
grant select, insert, update, delete on all tables in schema public to aggregatoriq_worker;
grant usage, select on all sequences in schema public to aggregatoriq_app, aggregatoriq_worker;
