-- ---------------------------------------------------------------------------
-- 0004_fix_membership_bootstrap
--
-- SECURITY FIX: privilege escalation in the org_members insert policy.
--
-- The policy in 0001 allowed a self-insert when the target organisation had no
-- members yet, so that a user creating their first org could become its owner:
--
--     (user_id = fieldnote_uid()
--       and not exists (select 1 from org_members existing
--                        where existing.org_id = org_members.org_id))
--     or public.has_org_role(org_id, 'admin')
--
-- The `not exists` subquery is evaluated as the *invoker*, under RLS. An
-- outsider cannot see org_members rows for an organisation they do not belong
-- to, so the subquery returned zero rows, `not exists` was vacuously true, and
-- the branch admitted them — as owner, of any existing organisation.
--
-- The membership helpers were already SECURITY DEFINER for exactly this reason;
-- the inline subquery was the one place that reasoning was not applied. Caught
-- by tests/rls.test.ts, which is why it runs against a real Postgres in CI
-- rather than asserting on the policy text.
--
-- The fix moves the emptiness check into a SECURITY DEFINER function so it sees
-- the true row count regardless of who is asking.
-- ---------------------------------------------------------------------------

create or replace function public.org_has_members(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from org_members m where m.org_id = target_org)
$$;

comment on function public.org_has_members(uuid) is
  'True when the organisation already has at least one member. SECURITY DEFINER '
  'so the count is the real one, not the subset the caller happens to be able to '
  'see under RLS. Takes a single org id and returns a boolean, so it cannot be '
  'used to read another tenant''s data.';

revoke all on function public.org_has_members(uuid) from public, anon;
grant execute on function public.org_has_members(uuid) to authenticated, service_role;

drop policy if exists org_members_insert on org_members;

create policy org_members_insert on org_members
  for insert to authenticated
  with check (
    -- Bootstrapping: the creator claims a brand-new, genuinely empty org.
    (user_id = public.fieldnote_uid() and not public.org_has_members(org_id))
    -- Or an existing admin invites someone.
    or public.has_org_role(org_id, 'admin')
  );
