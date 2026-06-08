-- Migration 013: Fix ai_model for conversational stages + clear dead workflows

-- 1. Fix model: aquecendo/pos_visita/em_contato had haiku set in DB
UPDATE kanban_stages
SET    ai_model = 'claude-sonnet-4-6'
WHERE  id IN ('aquecendo', 'pos_visita', 'em_contato');

-- 2. Clear workflow state for leads whose workflow died (resumeHook returns 500).
--    Allows the dispatch to re-pick them up.
UPDATE applications
SET    workflow_run_id = NULL,
       hook_token      = NULL
WHERE  crm_stage NOT IN ('fechado','perdido','descartado','fechamento','ganho')
  AND  workflow_run_id IS NOT NULL
  AND  id = 'a1e22f9b-6976-40f2-87cb-247611978746';
