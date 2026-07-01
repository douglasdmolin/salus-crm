-- 026_inbound_lead_race.sql
-- Corrige a criação DUPLICADA de lead quando o contato manda várias mensagens em
-- rajada (race no webhook: 3 mensagens simultâneas → 3 "não existe" → 3 leads + 3 workflows).
--
-- Solução: find-or-create ATÔMICO por telefone, serializado com advisory lock (sem
-- unique constraint global — que quebraria os disparos em lote com telefones repetidos).

create or replace function public.create_inbound_lead(
  p_phone       text,
  p_full_name   text,
  p_nome_msg    text,
  p_stage       text,
  p_hook_token  text,
  p_qual_notes  text,
  p_instance_id text
) returns table(id uuid, created boolean, hook_token text)
language plpgsql
as $$
declare
  v_id    uuid;
  v_token text;
begin
  -- Serializa concorrência POR TELEFONE: o 2º/3º webhook do mesmo número espera o 1º.
  perform pg_advisory_xact_lock(hashtext('inbound_lead:' || coalesce(p_phone, '')));

  select a.id, a.hook_token into v_id, v_token
    from public.applications a
   where a.phone = p_phone and a.deleted_at is null
   order by a.created_at asc
   limit 1;

  if v_id is not null then
    id := v_id; created := false; hook_token := v_token; return next; return;
  end if;

  insert into public.applications (
    full_name, nome_para_mensagem, phone, crm_stage,
    do_not_contact, reply_count, hook_token, qualification_notes, whatsapp_instance_id
  ) values (
    p_full_name, p_nome_msg, p_phone, p_stage,
    false, 0, p_hook_token, p_qual_notes, p_instance_id
  )
  returning applications.id into v_id;

  id := v_id; created := true; hook_token := p_hook_token; return next;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Limpeza dos duplicados JÁ existentes: mantém o lead mais antigo por telefone,
-- reatribui mensagens/logs para ele e marca os demais como deletados (soft-delete).

with ranked as (
  select id, phone, row_number() over (partition by phone order by created_at asc) rn
  from public.applications where deleted_at is null and phone is not null
)
update public.messages_received mr set application_id = keep.id
from ranked dup
join ranked keep on keep.phone = dup.phone and keep.rn = 1
where dup.rn > 1 and mr.application_id = dup.id;

with ranked as (
  select id, phone, row_number() over (partition by phone order by created_at asc) rn
  from public.applications where deleted_at is null and phone is not null
)
update public.message_log ml set application_id = keep.id
from ranked dup
join ranked keep on keep.phone = dup.phone and keep.rn = 1
where dup.rn > 1 and ml.application_id = dup.id;

with ranked as (
  select id, phone, row_number() over (partition by phone order by created_at asc) rn
  from public.applications where deleted_at is null and phone is not null
)
update public.applications set deleted_at = now()
where id in (select id from ranked where rn > 1);
