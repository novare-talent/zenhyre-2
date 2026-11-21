-- A stand-in for the shared Supabase project's 1.0 side: `auth.users` and the `public` tables the import reads, as in
-- the real schema (2026-11-21 dump) minus the pgvector column. Synthetic people only.
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now());
create table public.profiles (id uuid primary key, first_name text, last_name text, phone text, github_link text, linkedin_link text,
  profile_image text, created_at timestamptz default now(), updated_at timestamptz default now(), email text unique, role text not null default 'user',
  resume_url text, github_profile json, company_name text, is_subscribed boolean default true, welcome_email boolean default false, referral_applied boolean default false);
create table public.candidate_resumes (profile_id uuid primary key references public.profiles(id), resume_path text not null, file_hash text,
  resume_text text not null, extraction_method text, extracted_at timestamptz default now(), updated_at timestamptz default now());
create table public.jobs ("Job_Name" text not null, "Job_Description" text not null, "JD_pdf" text not null, "Applied_Candidates" uuid[],
  "Shortlisted_Candidates" uuid[], created_at timestamptz default now(), job_id uuid primary key default gen_random_uuid(), form_link text,
  form_id text, employer_id uuid references public.profiles(id), status text default 'draft', "closingTime" timestamptz, tags text[],
  level text, location text, duration text, stipend text, email_status text default 'pending', rejection_emails_sent boolean default false);
create table public.forms (form_id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(job_id), form jsonb, created_at timestamptz default now());
create table public.evaluations (evaluation_id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(job_id), results jsonb);
create table public.responses (id uuid primary key default gen_random_uuid(), form_id uuid references public.forms(form_id), profile_id uuid references public.profiles(id),
  answers jsonb, created_at timestamptz default now(), job_id uuid references public.jobs(job_id));
create table public.subscriptions (id uuid primary key, profile_id uuid unique references public.profiles(id), status text default 'pending',
  jobs_remaining integer default 0, evaluations_remaining integer default 0, created_at timestamp default now(), updated_at timestamp default now(), gst_number text);
create table public.onboarding (id uuid primary key default gen_random_uuid(), company_name text, internship_fee_pct integer, ppo_fee_pct real,
  minimum_fee integer, interest_pct integer, created_at timestamptz default now(), status text default 'draft', company_address text,
  template_docx_path text, created_by uuid, updated_at timestamptz default now());
create table public.assignments (job_id uuid references public.jobs(job_id), candidate_id uuid, assignment_json jsonb, primary key (job_id, candidate_id));
-- signed_contracts, client_submission and bot_fulltime_leads are left out on purpose: the import skips missing tables.
