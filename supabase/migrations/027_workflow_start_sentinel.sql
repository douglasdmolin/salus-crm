-- 027_workflow_start_sentinel.sql
-- Evita WORKFLOWS duplicados quando o lead manda várias mensagens em rajada.
--
-- Problema: a 1ª mensagem cria o lead e INICIA o workflow (start() é assíncrono e demora
-- ~1-2s até gravar o run_id). A 2ª mensagem, chegando nessa janela, vê run_id nulo, acha
-- que "não há workflow" e REINICIA um segundo → 2 workflows → 2 respostas.
--
-- Fix: a criação atômica já marca workflow_run_id='starting' (sentinela). Enquanto está
-- 'starting', o webhook NUNCA reinicia — só entrega a mensagem (o workflow que está subindo
-- lê o histórico completo). O (re)início real vira um CAS atômico no código (só um vence).

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
    do_not_contact, reply_count, hook_token, qualification_notes, whatsapp_instance_id,
    workflow_run_id
  ) values (
    p_full_name, p_nome_msg, p_phone, p_stage,
    false, 0, p_hook_token, p_qual_notes, p_instance_id,
    'starting'  -- sentinela: workflow está sendo iniciado pelo webhook que criou o lead
  )
  returning applications.id into v_id;

  id := v_id; created := true; hook_token := p_hook_token; return next;
end;
$$;
