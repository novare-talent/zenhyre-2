-- Zenhyre 1.0 (`public`) → 2.0 (`zenhyre2`) data import.
--
-- Run in the Supabase SQL editor as `postgres` (it reads `public` and `auth.users`, which the `zenhyre_api` role cannot),
-- after the 2.0 migrations (supabase/apply-migrations.sql or `pnpm db:migrate`) have been applied.
--
--   1. Paste this file and run it: it only (re)creates the function below.
--   2. Dry run (the default): changes nothing, returns the report.
--        select zenhyre2.import_from_v1();
--   3. Real run, once the report looks right:
--        select zenhyre2.import_from_v1(p_dry_run => false);
--      Add p_grant_staff => true to make 1.0 admins 2.0 staff.
--   4. Safe to run again (e.g. just before switching over): it adds what is new and refreshes the legacy copies.
--
-- `public` is only ever read: no table, row, policy or trigger there is changed, so 1.0 keeps working and `public`
-- stays as the outdated schema. 1.0 profile ids are Supabase Auth ids, which 2.0 uses as its user ids too, so every
-- imported person signs in to 2.0 with the same account.
--
-- What goes where:
--   profiles + auth.users        → zenhyre2.user (with the same person columns: names, phone, links, image, resume),
--                                  zenhyre2.user_email (verified as 1.0/Supabase had it); zenhyre2.profiles shows them in 1.0's shape
--   clients on a work domain     → zenhyre2.company (one per domain) + company_user (earliest = owner)
--   every profile                → zenhyre2.legacy_profile (role, resume text, GST no., campus hint, the raw 1.0 row)
--   jobs + forms + evaluations   → zenhyre2.legacy_job (history only; not live 2.0 roles; company = the employer's)
--   responses                    → zenhyre2.legacy_application
--   onboarding, client_submission, signed_contracts, bot_fulltime_leads, subscriptions, assignments
--                                → zenhyre2.legacy_record (row for row, as JSON)
--   not imported: job_email_queue, rankings_sighire, candidate_mappings (1.0 working state) and resume embeddings
--   (2.0 recomputes them). Candidates get no zenhyre2.candidate row: 2.0 needs campus, graduation date and course,
--   which 1.0 never asked for, so they complete onboarding on first sign-in.

create or replace function zenhyre2.import_from_v1(p_dry_run boolean default true, p_grant_staff boolean default false)
returns jsonb
language plpgsql
set search_path = zenhyre2, public
as $fn$
declare
  v_report jsonb := '{}'::jsonb;
  v_n integer;
  v_freemail text[];
  v_run uuid;
  v_t record;
begin
  if to_regclass('public.profiles') is null or to_regclass('auth.users') is null then
    raise exception 'import_from_v1: public.profiles or auth.users not found (run this on the shared Supabase project)';
  end if;
  if to_regclass('zenhyre2.legacy_profile') is null then
    raise exception 'import_from_v1: apply the 2.0 migrations through 0004_legacy_1_0_import first';
  end if;

  insert into zenhyre2.legacy_import_run (dry_run, grant_staff, run_by) values (p_dry_run, p_grant_staff, current_user) returning id into v_run;

  -- Personal mailbox domains: the staff-edited list if there is one, else 2.0's default (packages/ops/src/defaults.ts).
  select coalesce((select array(select jsonb_array_elements_text(value)) from zenhyre2.config_value where key = 'identity.freemail_domains'),
    array['gmail.com','googlemail.com','yahoo.com','yahoo.co.in','yahoo.in','ymail.com','outlook.com','outlook.in','hotmail.com','live.com',
          'live.in','msn.com','icloud.com','me.com','mac.com','proton.me','protonmail.com','pm.me','rediffmail.com','aol.com','zoho.com',
          'zohomail.in','gmx.com','mail.com','yandex.com']) into v_freemail;

  begin -- everything below is undone at the end of a dry run
    drop table if exists pg_temp.v1_src;
    create temp table v1_src on commit drop as
      select p.id, lower(trim(coalesce(u.email, p.email))) as email,
             split_part(lower(trim(coalesce(u.email, p.email))), '@', 2) as domain,
             coalesce(nullif(trim(p.role), ''), 'user') as role,
             u.email_confirmed_at, coalesce(u.created_at, p.created_at, now()) as created_at,
             nullif(trim(p.company_name), '') as company_name,
             to_jsonb(p) as row
      from public.profiles p
      join auth.users u on u.id = p.id
      where coalesce(u.email, p.email) is not null and position('@' in coalesce(u.email, p.email)) > 1;
    alter table v1_src add column campus_id uuid, add column conflict text;

    update v1_src s set campus_id = (select c.id from zenhyre2.campus c
      where s.domain = any(c.email_domains) or exists (select 1 from unnest(c.email_domains) d where s.domain like '%.' || d) limit 1);

    v_report := v_report || jsonb_build_object(
      'source_profiles', (select count(*) from public.profiles),
      'profiles_without_auth_user', (select count(*) from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)),
      'importable', (select count(*) from v1_src),
      'by_role', (select coalesce(jsonb_object_agg(role, n), '{}') from (select role, count(*) n from v1_src group by role) r),
      'with_campus_email', (select count(*) from v1_src where campus_id is not null));

    -- Conflicts: the address already belongs to a different 2.0 user. Such people are left out entirely.
    update v1_src s set conflict = 'email already held by another 2.0 user'
      where exists (select 1 from zenhyre2.user_email e where e.email = s.email and e.user_id <> s.id);

    -- 1. Users and their email.
    insert into zenhyre2."user" (id, is_staff, created_at)
      select id, p_grant_staff and role = 'admin', created_at from v1_src where conflict is null
      on conflict (id) do nothing;
    get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('users_created', v_n);
    if p_grant_staff then
      update zenhyre2."user" z set is_staff = true from v1_src s where s.id = z.id and s.role = 'admin' and s.conflict is null and not z.is_staff;
      get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('staff_granted', v_n);
    end if;
    insert into zenhyre2.user_email (user_id, email, verified_at, is_primary, campus_id)
      select s.id, s.email, s.email_confirmed_at,
             not exists (select 1 from zenhyre2.user_email e where e.user_id = s.id and e.is_primary), s.campus_id
      from v1_src s where s.conflict is null
      on conflict (email) do nothing;
    get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('emails_created', v_n);
    -- Person details onto the user, in the same columns 1.0 had (migration 0005). Anything already set in 2.0 is kept.
    if exists (select 1 from information_schema.columns where table_schema = 'zenhyre2' and table_name = 'user' and column_name = 'first_name') then
      update zenhyre2."user" z set
        first_name = coalesce(z.first_name, nullif(trim(s.row->>'first_name'), '')),
        last_name = coalesce(z.last_name, nullif(trim(s.row->>'last_name'), '')),
        phone = coalesce(z.phone, nullif(trim(s.row->>'phone'), '')),
        github_link = coalesce(z.github_link, nullif(trim(s.row->>'github_link'), '')),
        linkedin_link = coalesce(z.linkedin_link, nullif(trim(s.row->>'linkedin_link'), '')),
        profile_image = coalesce(z.profile_image, nullif(trim(s.row->>'profile_image'), '')),
        resume_url = coalesce(z.resume_url, nullif(trim(s.row->>'resume_url'), '')),
        is_subscribed = coalesce((s.row->>'is_subscribed')::boolean, z.is_subscribed),
        updated_at = now()
      from v1_src s where s.id = z.id and s.conflict is null;
      get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('person_details_copied', v_n);
    end if;

    -- 2. Companies: 1.0 clients on a work domain, one company per domain (2.0 needs a verified work domain; §6.4).
    --    A client who is already a 2.0 candidate keeps that one role and is not added.
    update v1_src s set conflict = 'already a 2.0 candidate, not added to a company'
      where s.role = 'client' and s.conflict is null and exists (select 1 from zenhyre2.candidate c where c.user_id = s.id);
    insert into zenhyre2.company (name, verified_domain, created_at)
      select coalesce(mode() within group (order by s.company_name) filter (where s.company_name is not null),
                      initcap(split_part(s.domain, '.', 1))), s.domain, min(s.created_at)
      from v1_src s
      where s.role = 'client' and s.conflict is null and s.domain <> all(v_freemail) and s.campus_id is null
        and not exists (select 1 from zenhyre2.company c where c.verified_domain = s.domain)
      group by s.domain;
    get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('companies_created', v_n);
    insert into zenhyre2.company_user (user_id, company_id, role, joined_at)
      select s.id, c.id,
             (case when not exists (select 1 from zenhyre2.company_user o where o.company_id = c.id and o.role = 'owner')
                    and s.created_at = min(s.created_at) over (partition by c.id) then 'owner' else 'member' end)::zenhyre2.company_user_role,
             s.created_at
      from v1_src s
      join lateral (select id from zenhyre2.company c where c.verified_domain = s.domain order by created_at limit 1) c on true
      where s.role = 'client' and s.conflict is null and s.domain <> all(v_freemail) and s.campus_id is null
        and not exists (select 1 from zenhyre2.company_user m where m.user_id = s.id)
      on conflict do nothing;
    get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('company_users_added', v_n);
    v_report := v_report || jsonb_build_object('clients_on_personal_email',
      (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'company', company_name) order by email), '[]')
       from v1_src where role = 'client' and conflict is null and (domain = any(v_freemail) or campus_id is not null)));

    -- 3. Legacy profiles (refreshed on every run).
    insert into zenhyre2.legacy_profile (user_id, legacy_role, resume_path, resume_text, gst_number, campus_id, source, imported_at)
      select s.id, s.role, r.resume_path, r.resume_text, sub.gst_number, s.campus_id, s.row, now()
      from v1_src s
      left join public.candidate_resumes r on r.profile_id = s.id
      left join public.subscriptions sub on sub.profile_id = s.id
      where s.conflict is null and exists (select 1 from zenhyre2."user" z where z.id = s.id)
      on conflict (user_id) do update set legacy_role = excluded.legacy_role, resume_path = excluded.resume_path,
        resume_text = excluded.resume_text, gst_number = excluded.gst_number, campus_id = excluded.campus_id,
        source = excluded.source, imported_at = excluded.imported_at;
    get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('legacy_profiles', v_n);

    -- 4. Jobs, with their forms and evaluations, as history.
    insert into zenhyre2.legacy_job (id, employer_user_id, title, description, jd_pdf_url, status, level, location, duration,
                                     stipend, tags, closing_at, form_link, forms, evaluations, created_at, source, imported_at)
      select j.job_id,
             (select z.id from zenhyre2."user" z where z.id = j.employer_id),
             j."Job_Name", j."Job_Description", nullif(j."JD_pdf", ''), j.status, j.level, j.location, j.duration, j.stipend,
             coalesce(j.tags, '{}'), j."closingTime", j.form_link,
             coalesce((select jsonb_agg(f.form order by f.created_at) from public.forms f where f.job_id = j.job_id), '[]'),
             coalesce((select jsonb_agg(e.results) from public.evaluations e where e.job_id = j.job_id), '[]'),
             j.created_at, to_jsonb(j), now()
      from public.jobs j
      on conflict (id) do update set employer_user_id = excluded.employer_user_id, title = excluded.title,
        description = excluded.description, jd_pdf_url = excluded.jd_pdf_url, status = excluded.status, level = excluded.level,
        location = excluded.location, duration = excluded.duration, stipend = excluded.stipend, tags = excluded.tags,
        closing_at = excluded.closing_at, form_link = excluded.form_link, forms = excluded.forms, evaluations = excluded.evaluations,
        source = excluded.source, imported_at = excluded.imported_at;
    get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('legacy_jobs', v_n,
      'legacy_jobs_without_company', (select count(*) from zenhyre2.legacy_job l
        where not exists (select 1 from zenhyre2.company_user cu where cu.user_id = l.employer_user_id)));

    -- 5. Applications.
    insert into zenhyre2.legacy_application (id, legacy_job_id, user_id, answers, shortlisted, applied_at, imported_at)
      select r.id, (select l.id from zenhyre2.legacy_job l where l.id = r.job_id), (select z.id from zenhyre2."user" z where z.id = r.profile_id),
             r.answers, coalesce(r.profile_id = any(j."Shortlisted_Candidates"), false), r.created_at, now()
      from public.responses r left join public.jobs j on j.job_id = r.job_id
      on conflict (id) do update set legacy_job_id = excluded.legacy_job_id, user_id = excluded.user_id, answers = excluded.answers,
        shortlisted = excluded.shortlisted, applied_at = excluded.applied_at, imported_at = excluded.imported_at;
    get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('legacy_applications', v_n);

    -- 6. Everything else worth keeping, row for row. Tables 1.0 no longer has are skipped.
    for v_t in select * from (values
        ('onboarding', 'x.id::text', 'x.created_by'),
        ('client_submission', 'x.id::text', 'x.created_by'),
        ('signed_contracts', 'x.id::text', 'null::uuid'),
        ('bot_fulltime_leads', 'x.id::text', 'x.profile_id'),
        ('subscriptions', 'x.id::text', 'x.profile_id'),
        ('assignments', 'x.job_id::text || '':'' || x.candidate_id::text', 'x.candidate_id')) t(name, id_expr, user_expr)
    loop
      if to_regclass('public.' || v_t.name) is null then continue; end if;
      execute format($q$
        insert into zenhyre2.legacy_record (source_table, source_id, user_id, data, imported_at)
          select %L, %s, (select z.id from zenhyre2."user" z where z.id = %s), to_jsonb(x), now() from public.%I x
        on conflict (source_table, source_id) do update set user_id = excluded.user_id, data = excluded.data, imported_at = excluded.imported_at
      $q$, v_t.name, v_t.id_expr, v_t.user_expr, v_t.name);
      get diagnostics v_n = row_count;
      v_report := jsonb_set(v_report, '{legacy_records}', coalesce(v_report->'legacy_records', '{}') || jsonb_build_object(v_t.name, v_n));
    end loop;

    v_report := v_report || jsonb_build_object(
      'conflicts', (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'role', role, 'reason', conflict) order by email), '[]')
                    from v1_src where conflict is not null),
      'admins', (select coalesce(jsonb_agg(email order by email), '[]') from v1_src where role = 'admin'),
      'unknown_roles', (select coalesce(jsonb_agg(distinct role), '[]') from v1_src where role not in ('user', 'client', 'admin')));

    if p_dry_run then
      raise exception using errcode = 'ZH001', message = 'dry run: rolling back';
    end if;
  exception when sqlstate 'ZH001' then
    null; -- the dry run's changes are undone; the report in v_report is kept
  end;

  v_report := jsonb_build_object('dry_run', p_dry_run, 'grant_staff', p_grant_staff, 'run_id', v_run) || v_report;
  update zenhyre2.legacy_import_run set finished_at = now(), report = v_report where id = v_run;
  return v_report;
end
$fn$;

revoke all on function zenhyre2.import_from_v1(boolean, boolean) from public;
