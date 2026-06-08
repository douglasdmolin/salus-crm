-- ============================================================
-- Migration 003: Adiciona colunas de IA nas etapas existentes
-- NÃO altera stage IDs, NÃO migra leads.
-- Baseado nos stages confirmados em 28/05/2026:
--   novo                      → Agente 1 Orquestrador  (Haiku)
--   contato_respondido_pela_ia → Agente 2 Qualificador  (Sonnet)
--   em_contato (Aquecendo)    → Agente 3 Nutrição       (Haiku)
--   ligacao_agendada (Agendado)→ Agente 4 Agendador     (Sonnet)
--   call_agendada (Objeção)   → Agente 5 Negociador     (Sonnet)
--   em_negociacao (Pós-visita)→ Agente 6 Pós-visita     (Haiku)
--   ganho (Contato Futuro)    → Agente 7 Reativação     (Haiku)
--   contato_futuro            → Agente 7 Reativação     (Haiku)
--   descartado / perdido      → sem IA
-- ============================================================

-- 1. Adicionar colunas (idempotente)
ALTER TABLE public.kanban_stages
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ai_model      TEXT DEFAULT 'claude-haiku-4-5',
  ADD COLUMN IF NOT EXISTS ai_enabled    BOOLEAN DEFAULT true;

-- 2. Configurar modelo e ai_enabled por stage
UPDATE public.kanban_stages SET ai_model = 'claude-haiku-4-5',  ai_enabled = true  WHERE id = 'novo';
UPDATE public.kanban_stages SET ai_model = 'claude-sonnet-4-6', ai_enabled = true  WHERE id = 'contato_respondido_pela_ia';
UPDATE public.kanban_stages SET ai_model = 'claude-haiku-4-5',  ai_enabled = true  WHERE id = 'em_contato';
UPDATE public.kanban_stages SET ai_model = 'claude-sonnet-4-6', ai_enabled = true  WHERE id = 'ligacao_agendada';
UPDATE public.kanban_stages SET ai_model = 'claude-sonnet-4-6', ai_enabled = true  WHERE id = 'call_agendada';
UPDATE public.kanban_stages SET ai_model = 'claude-haiku-4-5',  ai_enabled = true  WHERE id = 'em_negociacao';
UPDATE public.kanban_stages SET ai_model = 'claude-haiku-4-5',  ai_enabled = true  WHERE id = 'ganho';
UPDATE public.kanban_stages SET ai_model = 'claude-haiku-4-5',  ai_enabled = true  WHERE id = 'contato_futuro';
UPDATE public.kanban_stages SET ai_model = 'claude-haiku-4-5',  ai_enabled = false WHERE id = 'descartado';
UPDATE public.kanban_stages SET ai_model = 'claude-haiku-4-5',  ai_enabled = false WHERE id = 'perdido';

-- ============================================================
-- Verificação:
-- SELECT id, label, ai_model, ai_enabled FROM kanban_stages ORDER BY position;
-- ============================================================
