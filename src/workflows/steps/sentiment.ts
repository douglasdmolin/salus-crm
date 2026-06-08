import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createServiceClient } from "../../lib/supabase";

/**
 * Classifies the sentiment of a lead's latest message using Google Gemini (cheap + fast).
 * Falls back to regex heuristic if GOOGLE_API_KEY not configured.
 * Writes result to applications.ai_sentiment.
 */
export async function classifySentiment(leadId: string, message: string): Promise<"positive" | "neutral" | "negative"> {
  "use step";
  const supabase = createServiceClient();
  const trimmed = message.trim();
  if (!trimmed) {
    return "neutral";
  }

  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  const googleKey = process.env.GOOGLE_API_KEY;

  if (googleKey) {
    try {
      const google = createGoogleGenerativeAI({ apiKey: googleKey });
      const result = await generateText({
        model: google("gemini-2.5-flash-lite"),
        system:
          "Você é um classificador de sentimento em português brasileiro. Responda APENAS uma palavra: 'positive', 'neutral' ou 'negative'. Sem explicações, sem pontuação, sem formatação.",
        prompt: `Classifique o sentimento dessa mensagem de um lead:\n\n"${trimmed}"\n\nResponda apenas positive, neutral ou negative.`,
        maxOutputTokens: 10,
      });
      const raw = result.text.trim().toLowerCase();
      if (raw.includes("positive") || raw.includes("positiv")) sentiment = "positive";
      else if (raw.includes("negative") || raw.includes("negativ")) sentiment = "negative";
      else sentiment = "neutral";
      console.log("classifySentiment(gemini)", { leadId, sentiment, rawLen: raw.length });
    } catch (err) {
      console.warn("classifySentiment: Gemini failed, falling back to regex", String(err));
      sentiment = regexFallback(trimmed);
    }
  } else {
    sentiment = regexFallback(trimmed);
  }

  // Persist
  await supabase
    .from("applications")
    .update({ ai_sentiment: sentiment, ai_sentiment_at: new Date().toISOString() })
    .eq("id", leadId)
    .then(undefined, (err) => console.warn("sentiment persist failed", err));

  return sentiment;
}

function regexFallback(txt: string): "positive" | "neutral" | "negative" {
  const lower = txt.toLowerCase();
  if (/(não|nao|caro|pesado|impossível|sem tempo|cancelar|perdi|depois)/i.test(lower)) return "negative";
  if (/(ótimo|otimo|legal|interessa|vamos|fechar|proposta|bora|adorei|perfeito|agendar|quero|sim)/i.test(lower)) return "positive";
  return "neutral";
}
