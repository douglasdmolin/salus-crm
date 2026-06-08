/**
 * Import leads from XLSX or CSV into the applications table.
 * Usage: node scripts/import-leads.mjs <path-to-file.xlsx|.csv>
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, extname } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/import-leads.mjs <path-to-file.xlsx|.csv>");
  process.exit(1);
}

const resolvedPath = resolve(filePath);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseFile(path) {
  const ext = extname(path).toLowerCase();

  if (ext === ".xlsx" || ext === ".xls") {
    const wb = XLSX.readFile(path, { raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: null });
  }

  // CSV — usar xlsx para parsear corretamente (lida com campos entre aspas)
  const content = readFileSync(path, "utf-8");
  const wb = XLSX.read(content, { type: "string", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function mapRow(row) {
  const firstName = (row.primeiro_nome ?? row.first_name ?? "").toString().trim();
  const lastName  = (row.sobrenome ?? row.last_name ?? "").toString().trim();
  const fullName  = [firstName, lastName].filter(Boolean).join(" ")
    || (row.nome_para_mensagem ?? row.name ?? row.full_name ?? "").toString().trim()
    || "Sem nome";

  return {
    full_name:    fullName,
    phone:        row.telefone_e164 ?? row.phone ?? null,
    email:        row.email ?? null,
    notes:        row.contexto ?? row.notes ?? null,
    approach_copy: row.mensagem_sugerida ?? row.approach_copy ?? null,
    assigned_to:  row.responsavel_atribuido ?? row.assigned_to ?? null,
    // Campos extras do schema Salus
    id_unico:            row.id_unico ?? null,
    nome_para_mensagem:  row.nome_para_mensagem ?? firstName || null,
    mensagem_sugerida:   row.mensagem_sugerida ?? null,
    contexto:            row.contexto ?? null,
    abertura_awareness:  row.abertura_awareness ?? null,
    score_prioridade:    row.score_prioridade != null ? Number(row.score_prioridade) : null,
    tier:                row.tier != null ? Number(row.tier) : null,
    crm_stage:           "novo",
  };
}

async function main() {
  let rows;
  try {
    rows = parseFile(resolvedPath);
  } catch (err) {
    console.error(`\n❌  Erro ao ler arquivo: ${err.message}\n`);
    process.exit(1);
  }

  console.log(`\n📂  Arquivo: ${resolvedPath}`);
  console.log(`👥  Leads encontrados: ${rows.length}\n`);

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const lead = mapRow(row);

    if (!lead.phone) {
      console.warn(`  ⚠️  "${lead.full_name}" — sem telefone, pulando`);
      skipped++;
      continue;
    }

    const phone = String(lead.phone).trim();

    // Verifica duplicata por telefone
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (existing) {
      console.log(`  ⏭️  "${lead.full_name}" (${phone}) — já existe, pulando`);
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from("applications")
      .insert({ ...lead, phone });

    if (error) {
      console.error(`  ❌  "${lead.full_name}" — ${error.message}`);
      skipped++;
    } else {
      console.log(`  ✅  "${lead.full_name}" (${phone})`);
      imported++;
    }
  }

  console.log(`\nResultado: ${imported} importado(s), ${skipped} pulado(s)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
