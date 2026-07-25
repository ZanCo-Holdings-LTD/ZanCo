-- ---------------------------------------------------------------------------
-- 0003_locale_and_versioning
--
-- Three things the platform standards require and the initial schema missed.
--
-- 1. Tenancy carries country and base currency. Vertical one is the UK, but the
--    GCC port is a stated destination and retrofitting currency onto a table
--    that already holds money is far worse than carrying it from the start.
--
-- 2. Money is stored as integer minor units plus an ISO currency code. No
--    floats anywhere. Inference cost was numeric, which is exact, but the rule
--    is uniform for a reason: one numeric column is how the exception starts.
--
-- 3. Every derived value records the engine version that produced it, not just
--    the model and prompt. A structuring change that alters output must be
--    attributable to a released version, and historical rows must stay
--    explainable after the code that made them is gone.
-- ---------------------------------------------------------------------------

-- --- 1. Locale -------------------------------------------------------------

alter table organisations
  add column country       char(2)  not null default 'GB',
  add column base_currency char(3)  not null default 'GBP',
  -- Drives the default UI language and text direction. Arabic is RTL, and the
  -- GCC vertical is an English-speaking buyer market with Arabic-speaking
  -- field crews, so the two are set independently of country.
  add column default_locale text    not null default 'en';

alter table organisations
  add constraint organisations_locale_supported check (default_locale in ('en', 'ar'));

comment on column organisations.base_currency is
  'ISO 4217. All minor-unit money columns on this org''s rows are denominated in it.';

-- --- 2. Money as minor units ----------------------------------------------

-- Inference spend is billed to us in USD regardless of what the customer pays
-- in, so it carries its own currency rather than the org''s.
alter table report_costs
  add column transcription_micros_usd bigint  not null default 0,
  add column structuring_micros_usd   bigint  not null default 0,
  add column cost_currency            char(3) not null default 'USD';

-- Carry across whatever the numeric columns already hold, then retire them.
update report_costs
   set transcription_micros_usd = round(transcription_usd * 1000000)::bigint,
       structuring_micros_usd   = round(structuring_usd   * 1000000)::bigint;

alter table report_costs
  drop column transcription_usd,
  drop column structuring_usd;

comment on column report_costs.structuring_micros_usd is
  'Millionths of a USD. Integer only — a per-report inference cost is a fraction of a cent.';

-- Subscriptions already price in integer pence; make the unit explicit.
alter table subscriptions
  add column unit_amount_minor bigint  not null default 0,
  add column currency          char(3) not null default 'GBP';

comment on column subscriptions.unit_amount_minor is
  'Per-seat price in minor units of `currency`. Pence for GBP, fils for AED.';

-- --- 3. Engine versioning --------------------------------------------------

alter table report_values
  add column engine_version text;

comment on column report_values.engine_version is
  'Release that produced this value. With model_version and prompt_version, '
  'lets any historical row be traced to the exact code that generated it.';

alter table report_versions
  add column engine_version text;

-- A run of the pipeline over one report. Makes "why did this report change"
-- answerable without diffing two PDFs.
create table recon_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organisations(id) on delete cascade,
  report_id      uuid not null references reports(id) on delete cascade,
  engine_version text not null,
  model_version  text,
  prompt_version text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running',
  sections_total integer not null default 0,
  sections_done  integer not null default 0,
  ungrounded_fields integer not null default 0,
  constraint recon_runs_status_known check (status in ('running', 'succeeded', 'failed'))
);
create index recon_runs_report_idx on recon_runs(report_id, started_at desc);
create index recon_runs_org_idx on recon_runs(org_id);

alter table recon_runs enable row level security;
alter table recon_runs force row level security;
grant select, insert, update, delete on recon_runs to authenticated;
grant all on recon_runs to service_role;

create policy recon_runs_select on recon_runs
  for select to authenticated
  using (public.is_org_member(org_id));

create policy recon_runs_insert on recon_runs
  for insert to authenticated
  with check (public.is_org_member(org_id));

create policy recon_runs_update on recon_runs
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy recon_runs_delete on recon_runs
  for delete to authenticated
  using (public.is_org_member(org_id));
