-- ============================================================
-- Migration 008: Diagnóstico + Fix de dispatch
-- Rodar no Supabase SQL Editor
-- ============================================================

-- ============================================================
-- PASSO 1 — Verificar estado atual da crm_config
-- ============================================================
SELECT key, value, updated_at
FROM crm_config
WHERE key IN ('dispatch_enabled', 'dispatch_mode', 'dispatch_whitelist_phones',
              'uazapi_url', 'uazapi_token', 'uazapi_instance')
ORDER BY key;

-- ============================================================
-- PASSO 2 — Contar leads por stage (validar reset)
-- ============================================================
SELECT crm_stage, count(*) AS qtd, sum(CASE WHEN ai_paused THEN 1 ELSE 0 END) AS paused
FROM applications
WHERE deleted_at IS NULL
GROUP BY crm_stage
ORDER BY qtd DESC;

-- ============================================================
-- PASSO 3 — Habilitar dispatch (se dispatch_enabled não for 'true')
-- ============================================================
INSERT INTO crm_config (key, value, updated_at)
VALUES ('dispatch_enabled', 'true', now())
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()
WHERE crm_config.value <> 'true';

-- ============================================================
-- PASSO 4 — Garantir modo whitelist ativo (mantém telefone de teste)
-- Se já existe dispatch_mode → mantém. Se não → insere.
-- ============================================================
INSERT INTO crm_config (key, value, updated_at)
VALUES ('dispatch_mode', 'whitelist', now())
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- PASSO 5 — Confirmar estado após fix
-- ============================================================
SELECT key, value FROM crm_config
WHERE key LIKE 'dispatch%'
ORDER BY key;
