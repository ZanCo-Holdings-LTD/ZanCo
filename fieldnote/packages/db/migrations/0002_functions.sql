-- ---------------------------------------------------------------------------
-- 0002_functions: triggers, the queue claim, org bootstrap, vector index.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'organisations', 'profiles', 'reports', 'report_values', 'subscriptions', 'report_costs'
  ]
  loop
    execute format(
      'create trigger %1$s_touch_updated_at before update on public.%1$I
       for each row execute function public.touch_updated_at()', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- generated_value is immutable
--
-- Once the model has produced a value we keep it verbatim, forever, alongside
-- whatever the human signed off. Enforced in the database rather than the
-- repository layer because it is a liability control, not a convention — a
-- future migration script or an ad-hoc psql session must not be able to
-- rewrite history either.
-- ---------------------------------------------------------------------------
create or replace function public.freeze_generated_value()
returns trigger
language plpgsql
as $$
begin
  if old.generated_value is not null
     and new.generated_value is distinct from old.generated_value then
    raise exception
      'report_values.generated_value is immutable (report %, field %)',
      old.report_id, old.field_id
      using errcode = 'restrict_violation';
  end if;

  -- Editing the value is what marks a field as human-touched. Doing it here
  -- means no caller can update a value and forget to set the flag.
  if new.value is distinct from old.value then
    new.edited_by_human := true;
  end if;

  return new;
end $$;

create trigger report_values_freeze_generated
  before update on public.report_values
  for each row execute function public.freeze_generated_value();

-- ---------------------------------------------------------------------------
-- Report version numbering
--
-- Assigned server-side under the unique constraint so two concurrent exports
-- cannot both claim v3.
-- ---------------------------------------------------------------------------
create or replace function public.assign_report_version_no()
returns trigger
language plpgsql
as $$
begin
  if new.version_no is null or new.version_no = 0 then
    select coalesce(max(version_no), 0) + 1
      into new.version_no
      from report_versions
     where report_id = new.report_id;
  end if;
  return new;
end $$;

create trigger report_versions_assign_no
  before insert on public.report_versions
  for each row execute function public.assign_report_version_no();

-- ---------------------------------------------------------------------------
-- Organisation bootstrap
--
-- Creating an org and joining it must be one atomic step: an org with no owner
-- is unreachable, and RLS would then make it unrecoverable. Runs as definer so
-- the membership insert is not evaluated against a policy that needs the
-- membership to already exist.
-- ---------------------------------------------------------------------------
create or replace function public.create_organisation(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller  uuid := public.fieldnote_uid();
  new_org uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  insert into organisations (name) values (org_name) returning id into new_org;
  insert into org_members (org_id, user_id, role) values (new_org, caller, 'owner');
  insert into subscriptions (org_id, status, trial_ends_at)
    values (new_org, 'trialing', now() + interval '14 days');
  insert into profiles (id, org_id) values (caller, new_org)
    on conflict (id) do nothing;

  return new_org;
end $$;

revoke all on function public.create_organisation(text) from public, anon;
grant execute on function public.create_organisation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Queue claim
--
-- FOR UPDATE SKIP LOCKED gives at-least-once delivery across any number of
-- worker processes without a broker. A row whose lease has expired (the worker
-- died mid-job) is reclaimed rather than stranded.
-- ---------------------------------------------------------------------------
create or replace function public.claim_jobs(
  worker_id     text,
  batch_size    integer default 1,
  lease_seconds integer default 300
)
returns setof jobs
language plpgsql
volatile
as $$
begin
  -- Return abandoned leases to the queue before claiming, so a worker that was
  -- killed mid-job does not strand its work until someone notices.
  update jobs
     set state = 'queued', locked_at = null, locked_by = null
   where state = 'running'
     and locked_at < now() - make_interval(secs => lease_seconds);

  return query
  with claimable as (
    select j.id
      from jobs j
     where j.state = 'queued'
       and j.run_after <= now()
     order by j.run_after
     limit batch_size
       for update skip locked
  )
  update jobs
     set state      = 'running',
         locked_at  = now(),
         locked_by  = worker_id,
         started_at = coalesce(jobs.started_at, now()),
         attempts   = jobs.attempts + 1
   where jobs.id in (select id from claimable)
  returning jobs.*;
end $$;

revoke all on function public.claim_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Vector index for phrase-example retrieval
--
-- IVFFlat over cosine distance. `lists` is deliberately small: retrieval is
-- always pre-filtered to one user and one field, so each scan sees a handful
-- of rows. Revisit when the corpus passes ~100k rows.
-- ---------------------------------------------------------------------------
create index phrase_examples_embedding_idx
  on phrase_examples
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------------
-- Dashboard counts
--
-- One round trip instead of five, and it keeps the status chips honest under
-- RLS: the caller only ever counts rows they can already see.
-- ---------------------------------------------------------------------------
create or replace function public.report_status_counts(target_org uuid)
returns table (status report_status, count bigint)
language sql
stable
as $$
  select r.status, count(*)
    from reports r
   where r.org_id = target_org
     and r.deleted_at is null
   group by r.status
$$;

grant execute on function public.report_status_counts(uuid) to authenticated, service_role;
