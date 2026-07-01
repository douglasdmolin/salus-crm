-- 024_whatsapp_provider.sql
-- Suporte a MÚLTIPLAS plataformas de WhatsApp no mesmo CRM.
-- Até aqui todas as instâncias eram uazapi. Agora cada número declara seu `provider`
-- (uazapi | evolution) e o envio/status/recebimento passam por um adapter agnóstico.
--
-- As colunas uazapi_url / uazapi_token continuam sendo o armazenamento genérico de
-- URL + credencial (para Evolution, uazapi_token guarda a apikey e uazapi_url a base URL
-- do servidor Evolution). instance_name é o instanceName da Evolution (segmento de path
-- nas chamadas e identificador que vem no payload do webhook). Para uazapi fica nulo.

alter table public.whatsapp_instances
  add column if not exists provider      text not null default 'uazapi',
  add column if not exists instance_name text;

-- Garante que só provedores conhecidos entrem (uazapi legado + evolution novo).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_instances_provider_check'
  ) then
    alter table public.whatsapp_instances
      add constraint whatsapp_instances_provider_check
      check (provider in ('uazapi', 'evolution'));
  end if;
end $$;

-- Instâncias já cadastradas permanecem uazapi (default cobre, mas explicitamos p/ rows
-- que porventura tenham provider nulo por migração parcial).
update public.whatsapp_instances
   set provider = 'uazapi'
 where provider is null;
