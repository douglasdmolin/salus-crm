-- ============================================================
-- Migration 002: Pipeline Salus Water
-- Adiciona colunas system_prompt/ai_model/ai_enabled,
-- insere 13 stages Salus e migra leads existentes.
-- ============================================================

-- 1. Adicionar colunas à kanban_stages
ALTER TABLE public.kanban_stages
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ai_model      TEXT DEFAULT 'claude-haiku-4-5',
  ADD COLUMN IF NOT EXISTS ai_enabled    BOOLEAN DEFAULT true;

-- 2. Inserir (ou atualizar) os 13 stages do pipeline Salus
INSERT INTO public.kanban_stages
  (id, label, short, color, description, owner, position, ai_model, ai_enabled, is_active)
VALUES
  ('lead_qualificado',  'Lead Qualificado',  'Lead',    '#94a3b8', 'Lead da planilha, aguardando disparo',          'ia',    0,  'claude-haiku-4-5',   false, true),
  ('followup_1',        'Follow-up 1',       'F1',      '#06b6d4', 'Disparo + cadência D+3/7/14/28',                'ia',    1,  'claude-haiku-4-5',   true,  true),
  ('diagnostico',       'Diagnóstico',       'Diag.',   '#8b5cf6', 'Confirmar dor + imóvel (máx 3 turnos)',         'ia',    2,  'claude-sonnet-4-6',  true,  true),
  ('agendamento',       'Agendamento',       'Agenda',  '#3b82f6', '3 horários + contornar objeção (máx 4 turnos)', 'ia',    3,  'claude-sonnet-4-6',  true,  true),
  ('visita_tecnica',    'Visita Técnica',    'Visita',  '#0ea5e9', 'Logística + checklist 5 itens',                 'ia',    4,  'claude-sonnet-4-6',  true,  true),
  ('proposta_enviada',  'Proposta Enviada',  'Proposta','#f59e0b', 'Vendedor enviou proposta. IA pausada.',         'human', 5,  'claude-haiku-4-5',   false, true),
  ('followup_2',        'Follow-up 2',       'F2',      '#d97706', 'Lembrete pós-proposta D+2/5/10',                'ia',    6,  'claude-haiku-4-5',   true,  true),
  ('negociacao',        'Negociação',        'Nego.',   '#f97316', 'Vendedor negocia. IA pausada.',                 'human', 7,  'claude-haiku-4-5',   false, true),
  ('followup_3',        'Follow-up 3',       'F3',      '#ef4444', 'Última tentativa D+3/7',                        'ia',    8,  'claude-haiku-4-5',   true,  true),
  ('fechamento',        'Fechamento',        'Ganho',   '#16a34a', 'Contrato fechado. Terminal.',                   'human', 9,  'claude-haiku-4-5',   false, true),
  ('perdido',           'Perdido',           'Perdido', '#dc2626', 'Terminal — motivo registrado.',                 'human', 10, 'claude-haiku-4-5',   false, true),
  ('descartado',        'Descartado',        'Descart.','#6b7280', 'Não-fit explícito. Terminal.',                  'ia',    11, 'claude-haiku-4-5',   false, true),
  ('contato_futuro',    'Contato Futuro',    'Futuro',  '#a855f7', 'Reabordagem 30/60/90 dias',                     'ia',    12, 'claude-haiku-4-5',   true,  true)
ON CONFLICT (id) DO UPDATE SET
  label       = EXCLUDED.label,
  short       = EXCLUDED.short,
  color       = EXCLUDED.color,
  description = EXCLUDED.description,
  owner       = EXCLUDED.owner,
  position    = EXCLUDED.position,
  ai_model    = EXCLUDED.ai_model,
  ai_enabled  = EXCLUDED.ai_enabled,
  is_active   = true;

-- 3. Migrar leads existentes para novos stage IDs
UPDATE public.applications SET crm_stage = 'followup_1'   WHERE crm_stage = 'novo';
UPDATE public.applications SET crm_stage = 'followup_1'   WHERE crm_stage = 'contato_respondido_pela_ia';
UPDATE public.applications SET crm_stage = 'diagnostico'  WHERE crm_stage = 'em_contato';
UPDATE public.applications SET crm_stage = 'agendamento'  WHERE crm_stage = 'ligacao_agendada';
UPDATE public.applications SET crm_stage = 'agendamento'  WHERE crm_stage = 'call_agendada';
UPDATE public.applications SET crm_stage = 'negociacao'   WHERE crm_stage = 'em_negociacao';
UPDATE public.applications SET crm_stage = 'fechamento'   WHERE crm_stage = 'ganho';

-- 4. Desativar stages antigos substituídos
UPDATE public.kanban_stages
  SET is_active = false
  WHERE id IN ('novo','contato_respondido_pela_ia','em_contato','ligacao_agendada','call_agendada','em_negociacao','ganho');

-- ============================================================
-- Verificação:
-- SELECT id, label, ai_model, is_active FROM kanban_stages ORDER BY position;
-- SELECT id, full_name, crm_stage FROM applications;
-- ============================================================
