-- 023_whatsapp_instance_url.sql
-- Instâncias podem estar em SERVIDORES uazapi diferentes (ex: salus.uazapi.com,
-- free.uazapi.com, servidor próprio). Cada instância guarda sua própria URL.

alter table public.whatsapp_instances
  add column if not exists uazapi_url text;

-- Backfill: a(s) instância(s) já cadastrada(s) recebem a URL cadastrada hoje
-- (crm_config.uazapi_url = https://salus.uazapi.com). coalesce preserva uma URL
-- já preenchida (não sobrescreve instâncias futuras com servidor próprio).
update public.whatsapp_instances
   set uazapi_url = coalesce(uazapi_url, (select value from public.crm_config where key = 'uazapi_url'))
 where exists (select 1 from public.crm_config where key = 'uazapi_url');

-- Garantia explícita para a instância atual (Sofia, 17869874674), caso o crm_config
-- esteja vazio por algum motivo:
update public.whatsapp_instances
   set uazapi_url = 'https://salus.uazapi.com'
 where id = '17869874674'
   and (uazapi_url is null or uazapi_url = '');
