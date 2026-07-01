-- 025_message_audio.sql
-- Suporte a mensagens de ÁUDIO recebidas (Evolution / WhatsApp).
-- Guarda a URL pública do áudio (Supabase Storage) para o humano ouvir no chat e a
-- transcrição (gravada em messages_received.texto) para a Sofia entender e responder.

alter table public.messages_received
  add column if not exists media_url  text,
  add column if not exists media_type text;

-- Bucket PÚBLICO para os áudios dos leads. O player no CRM usa a URL pública.
-- Upload é feito com a service_role key (bypassa RLS); leitura é pública.
insert into storage.buckets (id, name, public)
values ('lead-media', 'lead-media', true)
on conflict (id) do nothing;
