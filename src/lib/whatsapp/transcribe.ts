/**
 * Transcrição de áudio via OpenAI Whisper.
 *
 * A Sofia (Claude) não recebe áudio — precisamos converter o áudio do lead em texto
 * para o workflow processar como uma mensagem normal. Usa OPENAI_API_KEY (já no .env).
 * Falha é não-fatal: retorna "" e o chamador usa um placeholder.
 */

function extFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("m4a") || m.includes("mp4") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  return "ogg";
}

export async function transcribeAudio(bytes: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("transcribeAudio: OPENAI_API_KEY ausente — pulando transcrição");
    return "";
  }
  try {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType || "audio/ogg" });
    form.append("file", blob, `audio.${extFromMime(mimeType)}`);
    form.append("model", "whisper-1");
    form.append("language", "pt");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error("transcribeAudio: OpenAI erro", res.status, await res.text().catch(() => ""));
      return "";
    }
    const j = (await res.json()) as { text?: string };
    return (j?.text ?? "").trim();
  } catch (err) {
    console.error("transcribeAudio failed", String(err));
    return "";
  }
}
