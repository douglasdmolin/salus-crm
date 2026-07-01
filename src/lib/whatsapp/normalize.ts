/**
 * Normaliza um telefone para a forma só-dígitos esperada pelas APIs de WhatsApp
 * (uazapi e Evolution aceitam o mesmo formato: dígitos com DDI, sem "+").
 *
 * Números em E.164 (com "+") já trazem o código do país (US "+1...", BR "+55...")
 * e são usados como estão — NUNCA prefixar 55. Só aplica heurística brasileira
 * para entradas legadas sem "+".
 * Aceita: "+17863281653", "+5511999887766", "(11) 99988-7766", "11999887766".
 */
export function normalizePhone(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  // E.164 (com +): já tem código de país — confia no número.
  if (trimmed.startsWith("+")) return digits;
  // Sem "+": assume número brasileiro (comportamento legado).
  if (digits.length === 11) return "55" + digits;
  if (digits.length === 13 && digits.startsWith("55")) return digits;
  if (digits.length >= 10) return digits.startsWith("55") ? digits : "55" + digits;
  return digits;
}
