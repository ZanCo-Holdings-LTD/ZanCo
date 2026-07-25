-- Row-level security.
--
-- This file is the tenant boundary. Every claim it makes is proved by a test in
-- packages/db/tests/rls.pg.test.ts, which runs in CI against a real Postgres as
-- the real `agentos_app` role — not as the owner, because a table owner bypasses
-- RLS and a test that passed as the owner would prove nothing.
--
-- The shape throughout is:
--
--   <table>_member      FOR ALL to the app role, gated on org membership
--   <table>_portal_read FOR SELECT to the portal role, gated on one entity
--
-- Postgres combines permissive policies with OR, so a portal session sees
-- exactly one entity's rows and a staff session sees exactly its own org's.

-- ---------------------------------------------------------------------------
-- Helpers that would otherwise recurse through RLS
-- ---------------------------------------------------------------------------

-- Two users share an organisation. Used so a member can resolve colleagues'
-- names without being able to enumerate every user in the system.
create or replace function app.shares_org_with(target_user uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from org_members mine
    join org_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = app.current_user_id()
      and theirs.user_id = target_user
  );
$$;

-- Whether an organisation has any members yet. This is what makes "create an
-- org on first login" possible without letting anyone join an existing org.
create or replace function app.org_has_members(target_org uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from org_members where org_id = target_org);
$$;

-- The organisation behind the current portal session.
create or replace function app.portal_org_id() returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id from client_entities where id = app.current_portal_entity_id();
$$;

revoke all on function app.shares_org_with(uuid) from public;
revoke all on function app.org_has_members(uuid) from public;
revoke all on function app.portal_org_id() from public;
grant execute on function app.shares_org_with(uuid) to agentos_app, agentos_worker;
grant execute on function app.org_has_members(uuid) to agentos_app, agentos_worker;
grant execute on function app.portal_org_id() to agentos_portal, agentos_app, agentos_worker;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
-- Enumerated explicitly rather than looped over pg_tables: a table added later
-- without a policy should be an obvious omission in review, not something a
-- loop silently locks down or silently leaves open.

alter table app_users              enable row level security;
alter table organisations          enable row level security;
alter table org_members            enable row level security;
alter table client_entities        enable row level security;
alter table documents              enable row level security;
alter table licences               enable row level security;
alter table establishment_records  enable row level security;
alter table visa_quotas            enable row level security;
alter table persons                enable row level security;
alter table person_documents       enable row level security;
alter table renewal_rules          enable row level security;
alter table renewals               enable row level security;
alter table tasks                  enable row level security;
alter table fee_ledger             enable row level security;
alter table time_logs              enable row level security;
alter table invoices               enable row level security;
alter table invoice_lines          enable row level security;
alter table client_portal_users    enable row level security;
alter table client_portal_sessions enable row level security;
alter table notification_log       enable row level security;
alter table audit_log              enable row level security;
alter table subscriptions          enable row level security;
alter table import_jobs            enable row level security;

-- ---------------------------------------------------------------------------
-- Identity and membership
-- ---------------------------------------------------------------------------

create policy app_users_self_read on app_users
  for select to agentos_app
  using (id = app.current_user_id() or app.shares_org_with(id));

create policy app_users_self_write on app_users
  for update to agentos_app
  using (id = app.current_user_id())
  with check (id = app.current_user_id());

-- First login creates the row for the authenticated user and nobody else.
create policy app_users_self_insert on app_users
  for insert to agentos_app
  with check (id = app.current_user_id());

create policy organisations_member_read on organisations
  for select to agentos_app
  using (app.is_org_member(id));

create policy organisations_admin_write on organisations
  for update to agentos_app
  using (app.has_org_role(id, 'admin'))
  with check (app.has_org_role(id, 'admin'));

-- Anyone signed in may create an organisation; they become its first member in
-- the same transaction. Creating an org grants no access to any existing one.
create policy organisations_create on organisations
  for insert to agentos_app
  with check (app.current_user_id() is not null);

create policy organisations_owner_delete on organisations
  for delete to agentos_app
  using (app.has_org_role(id, 'owner'));

create policy organisations_portal_read on organisations
  for select to agentos_portal
  using (id = app.portal_org_id());

create policy org_members_read on org_members
  for select to agentos_app
  using (app.is_org_member(org_id));

-- Either an admin is adding someone, or this is the first member of a brand new
-- organisation adding themselves. Without the second clause, org creation would
-- produce an organisation nobody could reach.
create policy org_members_insert on org_members
  for insert to agentos_app
  with check (
    app.has_org_role(org_id, 'admin')
    or (user_id = app.current_user_id() and not app.org_has_members(org_id))
  );

create policy org_members_admin_update on org_members
  for update to agentos_app
  using (app.has_org_role(org_id, 'admin'))
  with check (app.has_org_role(org_id, 'admin'));

create policy org_members_admin_delete on org_members
  for delete to agentos_app
  using (app.has_org_role(org_id, 'admin'));

-- ---------------------------------------------------------------------------
-- Client data
-- ---------------------------------------------------------------------------

create policy client_entities_member on client_entities
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy client_entities_portal_read on client_entities
  for select to agentos_portal
  using (id = app.current_portal_entity_id());

create policy documents_member on documents
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy documents_portal_read on documents
  for select to agentos_portal
  using (entity_id = app.current_portal_entity_id());

create policy licences_member on licences
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy licences_portal_read on licences
  for select to agentos_portal
  using (entity_id = app.current_portal_entity_id());

create policy establishment_records_member on establishment_records
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy establishment_records_portal_read on establishment_records
  for select to agentos_portal
  using (entity_id = app.current_portal_entity_id());

create policy visa_quotas_member on visa_quotas
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy visa_quotas_portal_read on visa_quotas
  for select to agentos_portal
  using (entity_id = app.current_portal_entity_id());

create policy persons_member on persons
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy persons_portal_read on persons
  for select to agentos_portal
  using (entity_id = app.current_portal_entity_id());

create policy person_documents_member on person_documents
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy person_documents_portal_read on person_documents
  for select to agentos_portal
  using (entity_id = app.current_portal_entity_id());

-- ---------------------------------------------------------------------------
-- Renewal rules
-- ---------------------------------------------------------------------------
-- System rules (org_id is null) are readable by every organisation and writable
-- by none of them. A firm tunes its ladders by writing its own rows, which win
-- on specificity — see packages/core/src/renewals/rules.ts.

create policy renewal_rules_read on renewal_rules
  for select to agentos_app
  using (org_id is null or app.is_org_member(org_id));

create policy renewal_rules_admin_insert on renewal_rules
  for insert to agentos_app
  with check (org_id is not null and app.has_org_role(org_id, 'admin'));

create policy renewal_rules_admin_update on renewal_rules
  for update to agentos_app
  using (org_id is not null and app.has_org_role(org_id, 'admin'))
  with check (org_id is not null and app.has_org_role(org_id, 'admin'));

create policy renewal_rules_admin_delete on renewal_rules
  for delete to agentos_app
  using (org_id is not null and app.has_org_role(org_id, 'admin'));

create policy renewals_member on renewals
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy renewals_portal_read on renewals
  for select to agentos_portal
  using (entity_id = app.current_portal_entity_id());

-- ---------------------------------------------------------------------------
-- Internal working: tasks, fees, time, invoicing
-- ---------------------------------------------------------------------------

create policy tasks_member on tasks
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy fee_ledger_member on fee_ledger
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy time_logs_member on time_logs
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy invoices_member on invoices
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy invoice_lines_member on invoice_lines
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy import_jobs_member on import_jobs
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Portal accounts and sessions
-- ---------------------------------------------------------------------------
-- Staff manage these; the portal role has no grant on either table at all, so a
-- portal session cannot read the token hash of any session, including its own.

create policy client_portal_users_member on client_portal_users
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy client_portal_sessions_member on client_portal_sessions
  for all to agentos_app
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Notifications, audit, billing
-- ---------------------------------------------------------------------------

create policy notification_log_read on notification_log
  for select to agentos_app
  using (app.is_org_member(org_id));

create policy notification_log_insert on notification_log
  for insert to agentos_app
  with check (app.is_org_member(org_id));

-- The send log is the evidence a firm shows a client who says they were never
-- told. It is append-only for the app: no update or delete policy exists, and
-- the grants are revoked below so the intent is enforced twice.
revoke update, delete on notification_log from agentos_app;

create policy audit_log_read on audit_log
  for select to agentos_app
  using (app.is_org_member(org_id));

create policy audit_log_insert on audit_log
  for insert to agentos_app
  with check (org_id is null or app.is_org_member(org_id));

revoke update, delete on audit_log from agentos_app;

create policy subscriptions_read on subscriptions
  for select to agentos_app
  using (app.is_org_member(org_id));

-- Billing state is written by the payment provider's webhook, which runs in the
-- worker. A firm cannot promote its own plan by writing to this table.
revoke insert, update, delete on subscriptions from agentos_app;
