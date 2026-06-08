-- ============================================================
-- Migration 004: Tabela ai_events — log do processo da IA por lead
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_events (
  id          BIGSERIAL PRIMARY KEY,
  lead_id     UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type  TEXT NOT NULL,  -- turn_start | turn_complete | tool_called | stage_changed | message_sent | error
  stage       TEXT,
  details     JSONB
);

CREATE INDEX IF NOT EXISTS idx_ai_events_lead_created
  ON public.ai_events(lead_id, created_at DESC);

ALTER TABLE public.ai_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.ai_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_select" ON public.ai_events
  FOR SELECT TO anon USING (true);

-- ============================================================
-- Verificação:
-- SELECT event_type, stage, details, created_at FROM ai_events ORDER BY created_at DESC LIMIT 20;
-- ============================================================
