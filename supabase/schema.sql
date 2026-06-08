-- ============================================================
-- NEXIA CRM TEMPLATE — Consolidated schema
-- Run this on a fresh Supabase project (SQL Editor) before first deploy.
-- ============================================================

create extension if not exists pg_net;
create extension if not exists pgcrypto;

-- ============================================================
-- ENUM: crm_stage (columns in the kanban)
-- ============================================================
do $$ begin
  create type crm_stage as enum (
    'novo',
    'contato_respondido_pela_ia',
    'em_contato',
    'ligacao_agendada',
    'call_agendada',
    'em_negociacao',
    'ganho',
    'perdido',
    'descartado',
    'contato_futuro'
  );
exception when duplicate_object then null; end $$;

-- ============================================================
-- applications — main lead table (also used as intake form destination)
-- ============================================================
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- identity (form submission)
  full_name text not null,
  phone text not null,
  email text,
  birth_date date,

  -- legacy review workflow (kept for backward compat, unused by CRM)
  status text,
  assigned_to text,
  notes text,
  contact_date timestamptz,
  scheduled_date timestamptz,
  approach_copy text,
  deleted_at timestamptz,

  -- OSINT enrichment pipeline (optional, unused in template default)
  pipeline_status text,
  enriched_at timestamptz,
  enrichment_score integer,
  enrichment_tier text,
  enrichment_confidence numeric,
  enrichment_flags jsonb,

  -- WhatsApp tracking
  do_not_contact boolean not null default false,
  message_status text,
  message_sent_at timestamptz,
  whatsapp_chatid text,
  whatsapp_messageid text,
  replied_at timestamptz,
  last_reply_text text,
  reply_count integer not null default 0,

  -- CRM core (populated by workflows)
  crm_stage crm_stage default 'novo',
  workflow_run_id text,
  reengage_at timestamptz,
  call_link text,
  call_scheduled_at timestamptz,
  qualification_notes text,
  ai_paused boolean default false,
  ai_paused_at timestamptz,

  -- Captured by AI during conversation
  role text,
  company text,

  -- AI-classified sentiment from latest message
  ai_sentiment text check (ai_sentiment in ('positive','neutral','negative') or ai_sentiment is null),
  ai_sentiment_at timestamptz,

  -- Justification when discarded
  descarte_motivo text
);

create index if not exists idx_applications_crm_stage on public.applications(crm_stage);
create index if not exists idx_applications_phone on public.applications(phone);
create index if not exists idx_applications_updated_at on public.applications(updated_at desc);
create index if not exists idx_applications_created_at on public.applications(created_at desc);

-- ============================================================
-- message_log — all outbound messages (AI or human-via-API)
-- ============================================================
create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  numero_normalizado text,
  texto text,
  http_status integer,
  uazapi_response jsonb,
  status text, -- 'sent' | 'failed'
  error_reason text, -- null (AI) | 'human_sent_crm' | 'human_sent_phone' | 'rate_limited' | etc
  attempted_at timestamptz default now()
);

create index if not exists idx_message_log_app on public.message_log(application_id, attempted_at desc);
create index if not exists idx_message_log_status on public.message_log(status, attempted_at desc);

-- ============================================================
-- messages_received — all inbound replies from leads
-- ============================================================
create table if not exists public.messages_received (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  uazapi_message_id text,
  chatid text,
  numero text,
  texto text,
  message_type text,
  received_at timestamptz default now(),
  raw_payload jsonb
);

create index if not exists idx_messages_received_app on public.messages_received(application_id, received_at desc);

-- ============================================================
-- processed_uazapi_crm_messages — idempotency for webhook
-- ============================================================
create table if not exists public.processed_uazapi_crm_messages (
  uazapi_id text primary key,
  application_id uuid references public.applications(id) on delete cascade,
  processed_at timestamptz default now()
);

-- ============================================================
-- crm_config — runtime key/value settings (prompts, model, dispatch, etc)
-- ============================================================
create table if not exists public.crm_config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- ============================================================
-- TRIGGER: auto-update updated_at on applications
-- ============================================================
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists applications_updated_at on public.applications;
create trigger applications_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- ============================================================
-- TRIGGER: auto-pause AI when stage advances to a human-owned stage
-- ============================================================
create or replace function public.auto_pause_ai_on_human_stage()
returns trigger as $$
declare
  human_stages text[] := array['ligacao_agendada','call_agendada','em_negociacao','ganho','perdido'];
begin
  if new.crm_stage::text = any(human_stages)
     and (old.crm_stage::text is null or old.crm_stage::text <> new.crm_stage::text)
     and new.ai_paused is not true then
    new.ai_paused := true;
    new.ai_paused_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_auto_pause_ai on public.applications;
create trigger trg_auto_pause_ai
  before update of crm_stage on public.applications
  for each row execute function public.auto_pause_ai_on_human_stage();

-- ============================================================
-- TRIGGER: webhook → /api/leads/new when a new lead is created
-- Reads webhook_url + webhook_secret from crm_config table.
-- ============================================================
create or replace function public.notify_new_application() returns trigger as $$
declare
  webhook_url text;
  webhook_secret text;
begin
  select value into webhook_url from public.crm_config where key = 'webhook_url';
  select value into webhook_secret from public.crm_config where key = 'webhook_secret';

  if webhook_url is null or webhook_secret is null then
    raise notice 'notify_new_application: webhook_url/secret not set in crm_config — skipping';
    return new;
  end if;

  if new.crm_stage = 'novo' and new.phone is not null and new.phone <> '' then
    perform net.http_post(
      url := webhook_url,
      body := jsonb_build_object('leadId', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || webhook_secret
      )
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_application_created_crm on public.applications;
create trigger on_application_created_crm
  after insert on public.applications
  for each row execute function public.notify_new_application();

-- ============================================================
-- RLS — crm_config table (service_role only + authenticated read)
-- ============================================================
alter table public.crm_config enable row level security;

grant select, insert, update, delete on public.crm_config to service_role;
grant select on public.crm_config to authenticated;

drop policy if exists service_role_all on public.crm_config;
create policy service_role_all on public.crm_config
  for all to service_role using (true) with check (true);

drop policy if exists authenticated_select on public.crm_config;
create policy authenticated_select on public.crm_config
  for select to authenticated using (true);

-- ============================================================
-- SEED defaults — dispatch config (safe: disabled by default)
-- ============================================================
insert into public.crm_config (key, value) values
  ('dispatch_enabled', 'false'),
  ('dispatch_mode', 'whitelist'),
  ('dispatch_whitelist_phones', '')
on conflict (key) do nothing;
