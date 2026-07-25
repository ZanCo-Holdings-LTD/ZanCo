-- Row-level security: the tenant boundary.
--
-- Every claim in this file is proved by packages/db/tests/rls.pg.test.ts, which
-- runs in CI against a real Postgres as the real `aggregatoriq_app` role — not
-- as the owner, because a table owner bypasses RLS and a test that passed as the
-- owner would prove nothing at all.

alter table app_users                 enable row level security;
alter table organisations             enable row level security;
alter table org_members               enable row level security;
alter table brands                    enable row level security;
alter table branches                  enable row level security;
alter table aggregators               enable row level security;
alter table branch_aggregator_accounts enable row level security;
alter table source_documents          enable row level security;
alter table source_rows               enable row level security;
alter table orders                    enable row level security;
alter table payouts                   enable row level security;
alter table payout_lines              enable row level security;
alter table cause_codes               enable row level security;
alter table recon_runs                enable row level security;
alter table matches                   enable row level security;
alter table unmatched_lines           enable row level security;
alter table variances                 enable row level security;
alter table disputes                  enable row level security;
alter table ingestion_addresses        enable row level security;
alter table parser_fingerprints       enable row level security;
alter table subscriptions             enable row level security;
alter table analytics_events          enable row level security;
alter table audit_log                 enable row level security;

-- ---------------------------------------------------------------------------
-- Identity and membership
-- ---------------------------------------------------------------------------

create policy app_users_read on app_users
  for select to aggregatoriq_app
  using (id = app.current_user_id() or app.shares_org_with(id));

create policy app_users_self_insert on app_users
  for insert to aggregatoriq_app
  with check (id = app.current_user_id());

create policy app_users_self_update on app_users
  for update to aggregatoriq_app
  using (id = app.current_user_id())
  with check (id = app.current_user_id());

create policy organisations_read on organisations
  for select to aggregatoriq_app
  using (app.is_org_member(id));

-- Anyone signed in may create an organisation and becomes its first member in
-- the same transaction. Creating one grants no access to any existing one.
create policy organisations_create on organisations
  for insert to aggregatoriq_app
  with check (app.current_user_id() is not null);

create policy organisations_admin_update on organisations
  for update to aggregatoriq_app
  using (app.has_org_role(id, 'admin'))
  with check (app.has_org_role(id, 'admin'));

create policy organisations_owner_delete on organisations
  for delete to aggregatoriq_app
  using (app.has_org_role(id, 'owner'));

create policy org_members_read on org_members
  for select to aggregatoriq_app
  using (app.is_org_member(org_id));

-- Either an admin is adding someone, or this is the first member of a brand new
-- organisation adding themselves. Without the second clause, org creation would
-- produce an organisation nobody could reach.
create policy org_members_insert on org_members
  for insert to aggregatoriq_app
  with check (
    app.has_org_role(org_id, 'admin')
    or (user_id = app.current_user_id() and not app.org_has_members(org_id))
  );

create policy org_members_admin_update on org_members
  for update to aggregatoriq_app
  using (app.has_org_role(org_id, 'admin'))
  with check (app.has_org_role(org_id, 'admin'));

create policy org_members_admin_delete on org_members
  for delete to aggregatoriq_app
  using (app.has_org_role(org_id, 'admin'));

-- ---------------------------------------------------------------------------
-- Reference data, readable by everyone signed in
-- ---------------------------------------------------------------------------
-- Aggregators and cause codes are the product's own reference data, not tenant
-- data. Readable by all, writable by none: they are maintained by migration and
-- seed, so no INSERT/UPDATE/DELETE policy exists and the grants are revoked.

create policy aggregators_read on aggregators
  for select to aggregatoriq_app using (true);

create policy cause_codes_read on cause_codes
  for select to aggregatoriq_app using (true);

revoke insert, update, delete on aggregators from aggregatoriq_app;
revoke insert, update, delete on cause_codes from aggregatoriq_app;

-- Fingerprints are learned by the worker as documents arrive. The app reads them
-- to show format-drift alerts.
create policy parser_fingerprints_read on parser_fingerprints
  for select to aggregatoriq_app using (true);

revoke insert, update, delete on parser_fingerprints from aggregatoriq_app;

-- ---------------------------------------------------------------------------
-- Tenant data
-- ---------------------------------------------------------------------------

create policy brands_member on brands
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create policy branches_member on branches
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create policy baa_member on branch_aggregator_accounts
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Raw layer
-- ---------------------------------------------------------------------------
-- Readable and insertable by members; never updatable or deletable by the app.
-- Immutability is enforced by the trigger in 0001 and by these grants, because
-- an append-only guarantee held in one place is a guarantee held nowhere.

create policy source_documents_read on source_documents
  for select to aggregatoriq_app
  using (org_id is not null and app.is_org_member(org_id));

create policy source_documents_insert on source_documents
  for insert to aggregatoriq_app
  with check (org_id is not null and app.is_org_member(org_id));

-- Parse status and period are written by the worker after parsing; the app may
-- update its own document rows only to reclassify branch or kind.
create policy source_documents_update on source_documents
  for update to aggregatoriq_app
  using (org_id is not null and app.is_org_member(org_id))
  with check (org_id is not null and app.is_org_member(org_id));

create policy source_rows_read on source_rows
  for select to aggregatoriq_app
  using (org_id is not null and app.is_org_member(org_id));

create policy source_rows_insert on source_rows
  for insert to aggregatoriq_app
  with check (org_id is not null and app.is_org_member(org_id));

revoke update, delete on source_rows from aggregatoriq_app;

-- ---------------------------------------------------------------------------
-- Canonical layer
-- ---------------------------------------------------------------------------

create policy orders_member on orders
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create policy payouts_member on payouts
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create policy payout_lines_member on payout_lines
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Derived layer
-- ---------------------------------------------------------------------------

create policy recon_runs_member on recon_runs
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create policy matches_member on matches
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create policy unmatched_lines_member on unmatched_lines
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create policy variances_member on variances
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create policy disputes_member on disputes
  for all to aggregatoriq_app
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Ingestion, billing, analytics, audit
-- ---------------------------------------------------------------------------

create policy ingestion_addresses_read on ingestion_addresses
  for select to aggregatoriq_app
  using (app.is_org_member(org_id));

create policy ingestion_addresses_admin_write on ingestion_addresses
  for insert to aggregatoriq_app
  with check (app.has_org_role(org_id, 'admin'));

create policy ingestion_addresses_admin_update on ingestion_addresses
  for update to aggregatoriq_app
  using (app.has_org_role(org_id, 'admin'))
  with check (app.has_org_role(org_id, 'admin'));

create policy subscriptions_read on subscriptions
  for select to aggregatoriq_app
  using (app.is_org_member(org_id));

-- Billing state is written by the payment provider's webhook in the worker. An
-- organisation cannot promote its own plan by writing to this table.
revoke insert, update, delete on subscriptions from aggregatoriq_app;

create policy analytics_events_insert on analytics_events
  for insert to aggregatoriq_app
  with check (org_id is null or app.is_org_member(org_id));

create policy analytics_events_read on analytics_events
  for select to aggregatoriq_app
  using (org_id is not null and app.is_org_member(org_id));

revoke update, delete on analytics_events from aggregatoriq_app;

create policy audit_log_read on audit_log
  for select to aggregatoriq_app
  using (app.is_org_member(org_id));

create policy audit_log_insert on audit_log
  for insert to aggregatoriq_app
  with check (org_id is null or app.is_org_member(org_id));

-- Append-only, twice over: no update or delete policy, and the grants revoked.
revoke update, delete on audit_log from aggregatoriq_app;
