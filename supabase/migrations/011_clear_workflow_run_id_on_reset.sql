-- Limpa workflow_run_id para leads que estão no estágio inicial
-- (foram movidos manualmente de volta para Novo Contato e precisam de novo disparo)
UPDATE public.applications
SET workflow_run_id = NULL
WHERE crm_stage IN ('lead_qualificado', 'novo')
  AND workflow_run_id IS NOT NULL;
