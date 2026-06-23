-- 022_whatsapp_instances.sql
-- Suporte a MÚLTIPLOS números de WhatsApp no mesmo webhook (multi-instância uazapi).
-- Cada número = uma instância uazapi com seu próprio token. O id da instância é o
-- próprio número (apenas dígitos) — que o webhook lê do payload (número que RECEBEU
-- a mensagem) e o disparo distribui em round-robin entre os ativos.

create table if not exists public.whatsapp_instances (
  id            text primary key,            -- dígitos do número, ex: '17869874674'
  name          text not null,               -- rótulo amigável, ex: 'Sofia 1 - Miami'
  uazapi_token  text not null,               -- token da instância no uazapi
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Número (instância) "dono" da conversa do lead — as respostas saem por ele.
-- Nulo = modo 1-número (usa o token global de crm_config.uazapi_token).
alter table public.applications
  add column if not exists whatsapp_instance_id text;

create index if not exists idx_applications_whatsapp_instance
  on public.applications (whatsapp_instance_id);

-- ──────────────────────────────────────────────────────────────────────────
-- SEED da instância ATUAL (Sofia Salus Water, número 17869874674).
-- O token é puxado do próprio crm_config.uazapi_token (mesma fonte usada hoje),
-- então não precisa colar o segredo aqui e fica sempre em sincronia.
insert into public.whatsapp_instances (id, name, uazapi_token, active)
select '17869874674',
       'Sofia Salus Water',
       (select value from public.crm_config where key = 'uazapi_token'),
       true
where exists (select 1 from public.crm_config where key = 'uazapi_token')
on conflict (id) do nothing;

-- Marca os leads já existentes como deste número, para que as respostas
-- continuem saindo pelo mesmo WhatsApp.
update public.applications
   set whatsapp_instance_id = '17869874674'
 where whatsapp_instance_id is null
   and deleted_at is null;

-- ──────────────────────────────────────────────────────────────────────────
-- PARA ADICIONAR OUTRO NÚMERO no futuro (id = dígitos do número, token da nova instância):
--   insert into public.whatsapp_instances (id, name, uazapi_token, active)
--   values ('1305XXXXXXX', 'Sofia 2 - Miami', 'TOKEN_DA_NOVA_INSTANCIA', true);
-- E aponte o webhook dessa instância no uazapi para a MESMA URL:
--   https://salus-crm-b.vercel.app/api/uazapi/webhook  (sem parâmetro)
-- ──────────────────────────────────────────────────────────────────────────
