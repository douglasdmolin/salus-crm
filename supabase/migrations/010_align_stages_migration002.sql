-- ============================================================
-- Migration 010: Pipeline definitivo Salus Water
-- ============================================================
-- Etapas finais (IDs canônicos):
--   lead_qualificado → lead_contatado → respondeu → aquecendo
--   → agendado → pos_visita → fechado
--   → objecao (saída: agendado | aquecendo | contato_futuro | perdido)
--   → contato_futuro (saída: respondeu | aquecendo | perdido)
--   terminais: fechado, perdido, descartado
--
-- Esta migration é idempotente: pode rodar mesmo que migrations
-- anteriores (002, 010-beta) tenham sido parcialmente aplicadas.
-- Garante que os stages existem ANTES de mover qualquer lead (FK).
-- ============================================================

-- ── PASSO 1: Upsert dos stages definitivos ──────────────────────────────
-- ON CONFLICT DO UPDATE garante idempotência.

INSERT INTO public.kanban_stages
  (id, label, short, color, description, owner, position, ai_model, ai_enabled, is_active)
VALUES
  ('lead_qualificado', 'Novo Contato',    'Novo',       '#94a3b8', 'Lead aguardando primeiro disparo.',                          'ia',    0,  'claude-haiku-4-5',   false, true),
  ('lead_contatado',   'Lead Contatado',  'Contatado',  '#06b6d4', 'Mensagem enviada — aguardando resposta. Re-disparo permitido.','ia',    1,  'claude-haiku-4-5',   true,  true),
  ('respondeu',        'Respondeu',       'Resp.',      '#8b5cf6', 'Lead respondeu — qualificando dor e tipo de imóvel.',         'ia',    2,  'claude-sonnet-4-6',  true,  true),
  ('aquecendo',        'Aquecendo',       'Aquec.',     '#3b82f6', 'Engajado mas não pronto para agendar — nutrição ativa.',      'ia',    3,  'claude-haiku-4-5',   true,  true),
  ('agendado',         'Agendado',        'Agend.',     '#0ea5e9', 'Visita técnica confirmada — checklist de logística.',         'ia',    4,  'claude-sonnet-4-6',  true,  true),
  ('objecao',          'Objeção',         'Objeção',    '#f59e0b', 'Objeção comercial ativa — tratar sem pressão.',               'ia',    5,  'claude-sonnet-4-6',  true,  true),
  ('pos_visita',       'Pós-visita',      'Pós',        '#d97706', 'Marcelo já visitou — lead avaliando proposta.',               'ia',    6,  'claude-haiku-4-5',   true,  true),
  ('contato_futuro',   'Contato Futuro',  'Futuro',     '#a855f7', 'Lead pediu reativação em data futura — D+30/60/90.',          'ia',    7,  'claude-haiku-4-5',   true,  true),
  ('fechado',          'Fechado',         'Fechado',    '#16a34a', 'Contrato fechado. Terminal.',                                 'human', 8,  'claude-haiku-4-5',   false, true),
  ('perdido',          'Perdido',         'Perdido',    '#dc2626', 'Lead saiu do funil. Terminal.',                               'human', 9,  'claude-haiku-4-5',   false, true),
  ('descartado',       'Descartado',      'Descart.',   '#6b7280', 'Não-fit explícito. Terminal.',                                'ia',    10, 'claude-haiku-4-5',   false, true)
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

-- ── PASSO 2: Migrar leads de todos os IDs antigos → IDs definitivos ──────
-- FK satisfeita porque os destinos foram inseridos no passo anterior.
-- Ordem importa: mover os mais específicos primeiro.

-- IDs da migration 002
UPDATE public.applications SET crm_stage = 'lead_contatado' WHERE crm_stage = 'followup_1';
UPDATE public.applications SET crm_stage = 'respondeu'      WHERE crm_stage = 'diagnostico';
UPDATE public.applications SET crm_stage = 'agendado'       WHERE crm_stage = 'agendamento';
UPDATE public.applications SET crm_stage = 'agendado'       WHERE crm_stage = 'visita_tecnica';
UPDATE public.applications SET crm_stage = 'pos_visita'     WHERE crm_stage = 'proposta_enviada';
UPDATE public.applications SET crm_stage = 'pos_visita'     WHERE crm_stage = 'followup_2';
UPDATE public.applications SET crm_stage = 'pos_visita'     WHERE crm_stage = 'negociacao';
UPDATE public.applications SET crm_stage = 'pos_visita'     WHERE crm_stage = 'followup_3';
UPDATE public.applications SET crm_stage = 'fechado'        WHERE crm_stage = 'fechamento';

-- IDs originais (schema.sql + migration 001)
UPDATE public.applications SET crm_stage = 'lead_qualificado' WHERE crm_stage = 'novo';
UPDATE public.applications SET crm_stage = 'lead_contatado'   WHERE crm_stage = 'contato_respondido_pela_ia';
UPDATE public.applications SET crm_stage = 'aquecendo'        WHERE crm_stage = 'em_contato';
UPDATE public.applications SET crm_stage = 'agendado'         WHERE crm_stage = 'ligacao_agendada';
UPDATE public.applications SET crm_stage = 'agendado'         WHERE crm_stage = 'call_agendada';
UPDATE public.applications SET crm_stage = 'pos_visita'       WHERE crm_stage = 'em_negociacao';
UPDATE public.applications SET crm_stage = 'fechado'          WHERE crm_stage = 'ganho';

-- ── PASSO 3: Desativar IDs antigos (somem do kanban) ─────────────────────

UPDATE public.kanban_stages
SET is_active = false
WHERE id IN (
  'novo', 'contato_respondido_pela_ia', 'em_contato', 'ligacao_agendada',
  'call_agendada', 'em_negociacao', 'ganho',
  'followup_1', 'diagnostico', 'agendamento', 'visita_tecnica',
  'proposta_enviada', 'followup_2', 'negociacao', 'followup_3', 'fechamento'
);

-- ── PASSO 4: Atualizar trigger auto_pause_ai ─────────────────────────────
-- Pausa IA automaticamente ao entrar em estágios humanos.

CREATE OR REPLACE FUNCTION public.auto_pause_ai_on_human_stage()
RETURNS TRIGGER AS $$
DECLARE
  human_stages text[] := array['fechado', 'perdido'];
BEGIN
  IF new.crm_stage = ANY(human_stages)
     AND (old.crm_stage IS NULL OR old.crm_stage <> new.crm_stage)
     AND new.ai_paused IS NOT TRUE THEN
    new.ai_paused := true;
    new.ai_paused_at := now();
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Verificação após rodar:
--
-- SELECT id, label, is_active, ai_enabled, position
-- FROM kanban_stages ORDER BY position;
--
-- SELECT crm_stage, count(*) AS qtd
-- FROM applications WHERE deleted_at IS NULL
-- GROUP BY crm_stage ORDER BY qtd DESC;
-- ============================================================
