-- 021_increment_reply_count_rpc.sql
-- Cria o RPC increment_reply_count, que o webhook (api/uazapi/webhook) já chama,
-- mas que NÃO existia no banco (chamada retornava 404 → caía no fallback que
-- NÃO incrementa reply_count). Sem ele, `autoAdvanceIfStuck` (backstop determinístico
-- em workflows/lead-qualification.ts) nunca atinge o threshold e os leads ficam
-- presos em lead_contatado.
--
-- Incrementa reply_count e atualiza replied_at a cada resposta do lead.
-- Mantém a assinatura exata usada pelo webhook: increment_reply_count(app_id uuid).

create or replace function public.increment_reply_count(app_id uuid)
returns void
language sql
as $$
  update public.applications
  set reply_count = coalesce(reply_count, 0) + 1,
      replied_at = now()
  where id = app_id;
$$;

-- Permite que o service role (usado pelo webhook) execute a função.
grant execute on function public.increment_reply_count(uuid) to service_role;
