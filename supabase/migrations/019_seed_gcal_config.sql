-- Insere as chaves de configuração do Google Calendar no crm_config.
-- Valores em branco por padrão — preenchidos via /crm/config quando necessário.

INSERT INTO crm_config (key, value, updated_at)
VALUES
  ('gcal_calendar_id',  '', now()),
  ('gcal_client_email', '', now()),
  ('gcal_private_key',  '', now())
ON CONFLICT (key) DO NOTHING;
