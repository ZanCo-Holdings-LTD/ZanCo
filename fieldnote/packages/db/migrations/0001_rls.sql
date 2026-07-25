-- ---------------------------------------------------------------------------
-- 0001_rls: row level security.
--
-- The rule is uniform and deliberately boring: a row is visible if and only if
-- the caller is a member of the organisation that owns it. Every table carries
-- org_id for exactly this reason, including the ones where it is technically
-- derivable through a join — a policy that has to join is a policy that gets
-- an index wrong and fails open under load.
--
-- Tables are FORCE'd so that even the table owner is subject to policy. The
-- worker connects as `service_role`, which is BYPASSRLS by design: it acts on
-- behalf of many tenants at once and scopes by org_id in the query itself.
--
-- tests/rls.test.ts proves cross-org reads and writes fail, and runs in CI.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Membership helpers
--
-- SECURITY DEFINER because a policy on org_members that queries org_members
-- recurses. These run as the definer with RLS bypassed, take a single org id,
-- and return a boolean — there is no way to use them to read another tenant's
-- data.
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from org_members m
    where m.org_id = target_org
      and m.user_id = public.fieldnote_uid()
  )
$$;

create or replace function public.has_org_role(target_org uuid, minimum org_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from org_members m
    where m.org_id = target_org
      and m.user_id = public.fieldnote_uid()
      and case m.role
            when 'owner'  then 3
            when 'admin'  then 2
            when 'member' then 1
          end
          >=
          case minimum
            when 'owner'  then 3
            when 'admin'  then 2
            when 'member' then 1
          end
  )
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, org_role) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, org_role) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable and force RLS everywhere. No table is exempt.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organisations', 'org_members', 'profiles',
    'templates', 'template_sections', 'template_fields',
    'reports', 'captures', 'media_assets', 'report_values',
    'report_versions', 'deliveries', 'phrase_examples',
    'jobs', 'subscriptions', 'report_costs', 'audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- Column-level grants still gate what is reachable; RLS gates which rows.
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Anonymous callers get nothing anywhere.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- organisations
-- ---------------------------------------------------------------------------
create policy organisations_select on organisations
  for select to authenticated
  using (public.is_org_member(id));

-- Any signed-in user may create their first org; membership is added in the
-- same transaction by create_organisation().
create policy organisations_insert on organisations
  for insert to authenticated
  with check (public.fieldnote_uid() is not null);

create policy organisations_update on organisations
  for update to authenticated
  using (public.has_org_role(id, 'admin'))
  with check (public.has_org_role(id, 'admin'));

create policy organisations_delete on organisations
  for delete to authenticated
  using (public.has_org_role(id, 'owner'));

-- ---------------------------------------------------------------------------
-- org_members
-- ---------------------------------------------------------------------------
create policy org_members_select on org_members
  for select to authenticated
  using (user_id = public.fieldnote_uid() or public.is_org_member(org_id));

create policy org_members_insert on org_members
  for insert to authenticated
  with check (
    -- Bootstrapping: the creator adds themselves as owner of a brand-new org.
    (user_id = public.fieldnote_uid()
      and not exists (select 1 from org_members existing where existing.org_id = org_members.org_id))
    -- Or an admin invites someone.
    or public.has_org_role(org_id, 'admin')
  );

create policy org_members_update on org_members
  for update to authenticated
  using (public.has_org_role(org_id, 'admin'))
  with check (public.has_org_role(org_id, 'admin'));

create policy org_members_delete on org_members
  for delete to authenticated
  using (public.has_org_role(org_id, 'admin') or user_id = public.fieldnote_uid());

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on profiles
  for select to authenticated
  using (public.is_org_member(org_id));

create policy profiles_insert on profiles
  for insert to authenticated
  with check (id = public.fieldnote_uid() and public.is_org_member(org_id));

-- Branding is per-user. An admin cannot rewrite a colleague's signature.
create policy profiles_update on profiles
  for update to authenticated
  using (id = public.fieldnote_uid())
  with check (id = public.fieldnote_uid());

create policy profiles_delete on profiles
  for delete to authenticated
  using (id = public.fieldnote_uid() or public.has_org_role(org_id, 'admin'));

-- ---------------------------------------------------------------------------
-- templates
--
-- System templates (org_id is null) are readable by every authenticated user
-- and writable by none — they are shipped through migrations and seeds.
-- ---------------------------------------------------------------------------
create policy templates_select on templates
  for select to authenticated
  using (org_id is null or public.is_org_member(org_id));

create policy templates_insert on templates
  for insert to authenticated
  with check (org_id is not null and public.has_org_role(org_id, 'admin'));

create policy templates_update on templates
  for update to authenticated
  using (org_id is not null and public.has_org_role(org_id, 'admin'))
  with check (org_id is not null and public.has_org_role(org_id, 'admin'));

create policy templates_delete on templates
  for delete to authenticated
  using (org_id is not null and public.has_org_role(org_id, 'admin'));

-- Sections and fields inherit their template's visibility.
create policy template_sections_select on template_sections
  for select to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_sections.template_id
      and (t.org_id is null or public.is_org_member(t.org_id))
  ));

create policy template_sections_write on template_sections
  for all to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_sections.template_id
      and t.org_id is not null and public.has_org_role(t.org_id, 'admin')
  ))
  with check (exists (
    select 1 from templates t
    where t.id = template_sections.template_id
      and t.org_id is not null and public.has_org_role(t.org_id, 'admin')
  ));

create policy template_fields_select on template_fields
  for select to authenticated
  using (exists (
    select 1
    from template_sections s
    join templates t on t.id = s.template_id
    where s.id = template_fields.section_id
      and (t.org_id is null or public.is_org_member(t.org_id))
  ));

create policy template_fields_write on template_fields
  for all to authenticated
  using (exists (
    select 1
    from template_sections s
    join templates t on t.id = s.template_id
    where s.id = template_fields.section_id
      and t.org_id is not null and public.has_org_role(t.org_id, 'admin')
  ))
  with check (exists (
    select 1
    from template_sections s
    join templates t on t.id = s.template_id
    where s.id = template_fields.section_id
      and t.org_id is not null and public.has_org_role(t.org_id, 'admin')
  ));

-- ---------------------------------------------------------------------------
-- Org-scoped content: one identical policy shape per table.
--
-- Generated in a loop so a new table cannot accidentally ship with a subtly
-- different rule. `deliveries` and `audit_log` deviate and are handled after.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'reports', 'captures', 'media_assets', 'report_values',
    'report_versions', 'phrase_examples', 'report_costs'
  ]
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (public.is_org_member(org_id));
    $f$, t);

    execute format($f$
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (public.is_org_member(org_id));
    $f$, t);

    execute format($f$
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (public.is_org_member(org_id))
        with check (public.is_org_member(org_id));
    $f$, t);

    execute format($f$
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (public.is_org_member(org_id));
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- deliveries
--
-- Read and create like any other org content, but never mutable or removable
-- from the application: a delivery record is evidence of what was sent to a
-- client and when. Only the worker (service_role) writes the sent/opened
-- timestamps, from provider webhooks.
-- ---------------------------------------------------------------------------
create policy deliveries_select on deliveries
  for select to authenticated
  using (public.is_org_member(org_id));

create policy deliveries_insert on deliveries
  for insert to authenticated
  with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- audit_log — append only
--
-- No update or delete policy exists, so both are denied for every application
-- role regardless of table grants.
-- ---------------------------------------------------------------------------
create policy audit_log_select on audit_log
  for select to authenticated
  using (public.has_org_role(org_id, 'admin'));

create policy audit_log_insert on audit_log
  for insert to authenticated
  with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- subscriptions — readable by members, mutated only by the Stripe webhook
-- handler running as service_role.
-- ---------------------------------------------------------------------------
create policy subscriptions_select on subscriptions
  for select to authenticated
  using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- jobs — worker-only.
--
-- No policy grants any authenticated access at all, so the table is invisible
-- to the web app's user connection. Enqueueing goes through the worker's
-- internal endpoint, which authenticates with a shared secret.
-- ---------------------------------------------------------------------------
revoke all on public.jobs from authenticated;
