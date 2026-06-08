-- ============================================================
-- Migration 009: Diagnóstico completo pós-reset
-- Apenas SELECTs — sem alterações no banco.
-- ============================================================

-- 1. Quantos leads disponíveis para dispatch?
SELECT
  count(*) FILTER (WHERE crm_stage = 'novo')          AS leads_novo,
  count(*) FILTER (WHERE do_not_contact = true)        AS do_not_contact,
  count(*) FILTER (WHERE deleted_at IS NOT NULL)       AS deletados,
  count(*) FILTER (WHERE crm_stage = 'novo' AND do_not_contact = false AND deleted_at IS NULL) AS elegíveis
FROM applications;

-- 2. Mensagens enviadas desde o reset (deve estar vazio após 007)
SELECT attempted_at, numero_normalizado, status, error_reason, http_status
FROM message_log
ORDER BY attempted_at DESC
LIMIT 20;

-- 3. Uazapi configurado? (se empty → vem de env var)
SELECT key, LEFT(value, 40) AS value_preview
FROM crm_config
WHERE key IN ('uazapi_url', 'uazapi_token', 'uazapi_instance');

-- 4. Workflow run IDs (todos NULL = reset OK, não NULL = workflow ativo do run anterior)
SELECT crm_stage, workflow_run_id IS NOT NULL AS tem_workflow_ativo, count(*) AS qtd
FROM applications
WHERE deleted_at IS NULL
GROUP BY crm_stage, (workflow_run_id IS NOT NULL)
ORDER BY qtd DESC;
