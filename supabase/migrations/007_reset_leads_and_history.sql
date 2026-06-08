-- ============================================================
-- Migration 007: Reset leads → novo + limpar histórico de conversa
-- ⚠️  OPERAÇÃO DESTRUTIVA — não tem rollback automático.
-- Rodar no Supabase SQL Editor: https://supabase.com/dashboard
-- ============================================================

-- 1. Verificação antes de rodar (execute este SELECT primeiro para revisar):
-- SELECT id_unico, full_name, crm_stage, reply_count, ai_paused
-- FROM applications WHERE deleted_at IS NULL ORDER BY created_at;

-- ============================================================
-- PASSO 1 — Resetar leads para "novo"
-- ============================================================
UPDATE public.applications
SET
  crm_stage           = 'novo',
  ai_paused           = false,
  ai_paused_at        = NULL,
  workflow_run_id     = NULL,
  replied_at          = NULL,
  last_reply_text     = NULL,
  reply_count         = 0,
  qualification_notes = NULL,
  ai_sentiment        = NULL,
  ai_sentiment_at     = NULL,
  call_scheduled_at   = NULL,
  descarte_motivo     = NULL,
  notes               = NULL
WHERE deleted_at IS NULL;

-- ============================================================
-- PASSO 2 — Limpar histórico de conversa
-- ============================================================

-- Mensagens enviadas pela IA / humano (outbound)
DELETE FROM public.message_log;

-- Respostas dos leads (inbound)
DELETE FROM public.messages_received;

-- Controle de idempotência do webhook
DELETE FROM public.processed_uazapi_crm_messages;

-- Log de eventos da IA
DELETE FROM public.ai_events;

-- ============================================================
-- Verificação após rodar:
-- SELECT id_unico, full_name, crm_stage, reply_count, ai_paused
-- FROM applications ORDER BY created_at;
-- ============================================================
