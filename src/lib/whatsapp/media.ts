import { createServiceClient } from "../supabase";

/**
 * Upload de áudio recebido para o Supabase Storage (bucket público 'lead-media'),
 * retornando a URL pública que o player do chat usa. Falha é não-fatal (retorna null).
 * O bucket é criado pela migration 025.
 */
const BUCKET = "lead-media";

function extFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("m4a") || m.includes("mp4") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  return "ogg";
}

export async function uploadAudio(bytes: Buffer, mimeType: string, keyBase: string): Promise<string | null> {
  const supabase = createServiceClient();
  const safeKey = keyBase.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || String(Date.now());
  const path = `audios/${safeKey}.${extFromMime(mimeType)}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: mimeType || "audio/ogg", upsert: true });

  if (error) {
    console.error("uploadAudio failed", error.message);
    return null;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}
