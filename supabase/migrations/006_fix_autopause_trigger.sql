-- ============================================================
-- Migration 006: Corrige trigger de auto-pause da IA
--
-- Problema: o trigger auto_pause_ai_on_human_stage pausava a IA
-- ao mover o lead para ligacao_agendada, call_agendada e em_negociacao.
-- Mas a migration 003 configurou ai_enabled = true nesses stages,
-- pois agora existem agentes de IA para cada um deles:
--   ligacao_agendada  → Agente 4 Agendador  (AGENDAMENTO_PROMPT)
--   call_agendada     → Agente 5 Negociador  (NEGOCIADOR_PROMPT)
--   em_negociacao     → Agente 6 Pós-visita  (POSVISITA_PROMPT)
--
-- Correção: só auto-pausa para stages terminais onde IA nunca deve agir.
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_pause_ai_on_human_stage()
RETURNS trigger AS $$
DECLARE
  -- Apenas stages terminais sem IA — para todo o resto, depende de
  -- ai_enabled na kanban_stages + ai_paused explícito por ferramenta.
  terminal_stages text[] := array['ganho', 'perdido'];
BEGIN
  IF new.crm_stage::text = ANY(terminal_stages)
     AND (old.crm_stage::text IS NULL OR old.crm_stage::text <> new.crm_stage::text)
     AND new.ai_paused IS NOT TRUE
  THEN
    new.ai_paused    := true;
    new.ai_paused_at := now();
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Verificação: trigger já existente é substituído pela função acima.
-- O trigger trg_auto_pause_ai já aponta para esta função.
--
-- SELECT id, label, ai_enabled FROM kanban_stages ORDER BY position;
-- Esperado: ligacao_agendada, call_agendada, em_negociacao com ai_enabled = true
-- ============================================================
