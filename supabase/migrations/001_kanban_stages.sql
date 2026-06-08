-- ============================================================
-- Migration: kanban_stages
-- Cria tabela de etapas dinâmicas e converte crm_stage de
-- ENUM para TEXT com FK, preservando todos os dados existentes.
-- Rodar no Supabase SQL Editor: https://supabase.com/dashboard
-- ============================================================

-- 1. Criar tabela kanban_stages
create table if not exists public.kanban_stages (
  id          text primary key,
  label       text not null,
  short       text not null,
  color       text not null default '#94a3b8',
  description text not null default '',
  owner       text not null default 'human' check (owner in ('ia', 'human')),
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 2. Seed com as etapas existentes
insert into public.kanban_stages (id, label, short, color, description, owner, position) values
  ('novo',                       'Novo',               'Novo',    '#94a3b8', 'Acabou de cadastrar',          'ia',    0),
  ('contato_respondido_pela_ia', 'Respondido pela IA', 'IA',      '#8b5cf6', 'Primeiro contato automático',  'ia',    1),
  ('em_contato',                 'Em contato',         'Contato', '#06b6d4', 'Qualificação em andamento',    'ia',    2),
  ('ligacao_agendada',           'Ligação agendada',   'Ligação', '#0ea5e9', 'Ligação marcada',              'human', 3),
  ('call_agendada',              'Call agendada',      'Call',    '#2563eb', 'Videochamada marcada',         'human', 4),
  ('em_negociacao',              'Em negociação',      'Nego.',   '#d97706', 'Proposta em andamento',        'human', 5),
  ('ganho',                      'Ganho',              'Ganho',   '#16a34a', 'Fechado',                      'human', 6),
  ('perdido',                    'Perdido',            'Perdido', '#dc2626', 'Oportunidade perdida',         'human', 7),
  ('descartado',                 'Descartado',         'Descart.','#94a3b8', 'Não-fit',                      'ia',    8),
  ('contato_futuro',             'Contato futuro',     'Futuro',  '#64748b', 'Reabordar',                    'ia',    9)
on conflict (id) do nothing;

-- 3. Remover trigger que depende da coluna crm_stage (ENUM)
drop trigger if exists trg_auto_pause_ai on public.applications;

-- 4. Remover default antes de converter o tipo
alter table public.applications
  alter column crm_stage drop default;

-- 5. Converter crm_stage de ENUM para TEXT
alter table public.applications
  alter column crm_stage type text using crm_stage::text;

-- 6. Restaurar default
alter table public.applications
  alter column crm_stage set default 'novo';

-- 7. Remover o ENUM antigo
drop type if exists public.crm_stage;

-- 8. Adicionar FK de applications.crm_stage → kanban_stages.id
alter table public.applications
  add constraint fk_applications_crm_stage
  foreign key (crm_stage) references public.kanban_stages(id)
  on update cascade;

-- 9. Recriar trigger agora que a coluna é TEXT
--    (a função auto_pause_ai_on_human_stage já usa ::text, funciona igual)
create trigger trg_auto_pause_ai
  before update of crm_stage on public.applications
  for each row execute function public.auto_pause_ai_on_human_stage();

-- 10. RLS para kanban_stages
alter table public.kanban_stages enable row level security;

create policy "kanban_stages_public_read" on public.kanban_stages
  for select using (true);

create policy "kanban_stages_service_role_all" on public.kanban_stages
  for all to service_role using (true) with check (true);

-- ============================================================
-- Verificação: deve retornar 10 linhas
-- select id, label, owner, position from kanban_stages order by position;
-- ============================================================
