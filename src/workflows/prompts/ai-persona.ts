import type { Application } from "../../lib/supabase";
import { PROJECT } from "../../config/project";

export const IA_PERSONA_NAME = PROJECT.iaPersonaName;

/** Tenta parsear qualification_notes como JSON para extrair dados do lead Salus */
function parseQualNotes(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
}

/** Normaliza telefone para E.164 */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

/**
 * Constrói o system prompt final substituindo todas as variáveis de template.
 * turnsInStage: nº de respostas do lead desde a última mudança de etapa.
 */
export function carolSystemPrompt(lead: Application, template: string, turnsInStage = 0): string {
  const primeiroNome = lead.full_name.split(" ")[0];
  const meta = parseQualNotes(lead.qualification_notes);

  // Contexto estruturado do lead
  const tags: string[] = [];
  if (lead.enrichment_tier) tags.push(`tier ${lead.enrichment_tier}`);
  if (lead.enrichment_score !== null) tags.push(`score ${lead.enrichment_score}`);
  const contextoEnrichment = tags.length ? `\nEnriquecimento: ${tags.join(", ")}` : "";

  const knownData = [
    lead.role    ? `\nCargo registrado: ${lead.role}`   : "",
    lead.company ? `\nEmpresa registrada: ${lead.company}` : "",
  ].join("");

  const leadContext = `Nome: ${lead.full_name}
Telefone: ${toE164(lead.phone)}
Etapa atual: ${lead.crm_stage}
Total de respostas do lead: ${turnsInStage}${contextoEnrichment}${knownData}${lead.notes ? `\nNotas: ${lead.notes}` : ""}`;

  return template
    // Variáveis padrão
    .replace(/\{\{IA_NAME\}\}/g,      PROJECT.iaPersonaName)
    .replace(/\{\{BRAND_NAME\}\}/g,   PROJECT.brandName)
    .replace(/\{\{LEAD_CONTEXT\}\}/g, leadContext)
    // Variáveis Salus
    .replace(/\{\{nome_para_mensagem\}\}/gi, primeiroNome)
    .replace(/\{\{nome\}\}/gi,              primeiroNome)
    .replace(/\{\{telefone_e164\}\}/gi,     toE164(lead.phone))
    .replace(/\{\{localizacao_fl\}\}/gi,    meta.localizacao_fl    ?? "Florida")
    .replace(/\{\{dor_confirmada\}\}/gi,    meta.dor_confirmada    ?? "")
    .replace(/\{\{tipo_imovel\}\}/gi,       meta.tipo_imovel       ?? "")
    .replace(/\{\{arquetipo_icp\}\}/gi,     meta.arquetipo_icp     ?? "")
    .replace(/\{\{contexto\}\}/gi,          meta.notas_extras      ?? "")
    .replace(/\{\{origem_principal\}\}/gi,  meta.origem_principal  ?? "planilha")
    .replace(/\{\{abertura_awareness\}\}/gi,meta.abertura_awareness ?? "")
    .replace(/\{\{vendedor_responsavel\}\}/gi, "Marcelo")
    .replace(/\{\{tecnico_nome\}\}/gi,      "Marcelo")
    // Limpar variáveis não substituídas
    .replace(/\{\{[^}]+\}\}/g, "");
}
