/**
 * Backfill WhatsApp history into CRM tables.
 *
 * For each contacted lead (has at least one message_log entry):
 *   1. Resolve canonical chatid via /chat/details
 *   2. Paginate /message/find { chatid } until hasMore=false
 *   3. For each message (chronological):
 *        - text / conversation → insert as-is
 *        - audio / PTT         → download + Groq Whisper transcription → insert transcript
 *        - image / video / doc → skip (logged as skipped_media)
 *        - reaction / contact / other → skip
 *      - fromMe=false               → messages_received
 *      - fromMe=true wasSentByApi=1 → message_log (error_reason=null, IA)
 *      - fromMe=true wasSentByApi=0 → message_log (error_reason='human_sent_phone')
 *      - dedupe via processed_uazapi_crm_messages.uazapi_id
 *
 * Flags:
 *   --dry-run            Count + preview, no writes
 *   --lead <uuid>        Process only one lead
 *   --no-transcribe      Skip audio transcription (placeholder "[áudio Ns]")
 *   --throttle <ms>      Delay between leads (default 1000)
 *
 * Required env:
 *   DB_PASSWORD           Supabase pooler password
 *   UAZAPI_URL            https://<instance>.uazapi.com
 *   UAZAPI_TOKEN          Instance token
 *   GROQ_API_KEY          Only required if transcribing audio
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const NO_TRANSCRIBE = args.includes("--no-transcribe");
const leadArgIdx = args.indexOf("--lead");
const ONLY_LEAD = leadArgIdx >= 0 ? args[leadArgIdx + 1] : null;
const throttleIdx = args.indexOf("--throttle");
const THROTTLE_MS = throttleIdx >= 0 ? Number(args[throttleIdx + 1]) : 1000;
const sinceIdx = args.indexOf("--since");
const SINCE = sinceIdx >= 0 ? args[sinceIdx + 1] : null; // YYYY-MM-DD
const EXCLUDE_TEST = args.includes("--exclude-test");
const ALL_APPS = args.includes("--all-applications");
const TEST_PHONES = ["5592981951096", "559281951096", "92981951096", "9281951096"];

const UAZAPI_URL = process.env.UAZAPI_URL;
const UAZAPI_TOKEN = process.env.UAZAPI_TOKEN;
const GROQ_KEY = process.env.GROQ_API_KEY;
const DB_PASSWORD = process.env.DB_PASSWORD;

if (!UAZAPI_URL || !UAZAPI_TOKEN) throw new Error("UAZAPI_URL/UAZAPI_TOKEN missing");
if (!DB_PASSWORD) throw new Error("DB_PASSWORD missing (export DB_PASSWORD=... or put in .env.local)");
if (!NO_TRANSCRIBE && !GROQ_KEY) throw new Error("GROQ_API_KEY missing (use --no-transcribe to skip audio)");

const cs = "postgresql://postgres.pnssabbcotigyzkwtsiy:" + encodeURIComponent(DB_PASSWORD) + "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres";
const sql = postgres(cs, { ssl: "require", prepare: false, max: 1 });

// ---------- helpers ----------
function normalizeBrPhone(raw) {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 13 && d.startsWith("55") && d[4] === "9") return d;
  if (d.length === 12 && d.startsWith("55")) return d.slice(0, 4) + "9" + d.slice(4);
  if (d.length === 11 && d[2] === "9") return "55" + d;
  if (d.length === 10) return "55" + d.slice(0, 2) + "9" + d.slice(2);
  return d;
}

async function uazapi(path, body) {
  const res = await fetch(UAZAPI_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: UAZAPI_TOKEN },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`uazapi ${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getChatid(phoneCanonical) {
  try {
    const j = await uazapi("/chat/details", { number: phoneCanonical });
    return j.wa_chatid ?? null;
  } catch {
    return null;
  }
}

async function fetchAllMessages(chatid) {
  const all = [];
  let offset = 0;
  while (true) {
    const page = await uazapi("/message/find", { chatid, limit: 200, offset });
    all.push(...(page.messages ?? []));
    if (!page.hasMore) break;
    offset = page.nextOffset ?? offset + 200;
    if (all.length > 10000) throw new Error("safety cap 10k msgs");
  }
  return all.sort((a, b) => a.messageTimestamp - b.messageTimestamp);
}

async function transcribeAudio(fileURL, seconds) {
  const audioRes = await fetch(fileURL);
  if (!audioRes.ok) throw new Error(`download audio ${audioRes.status}`);
  const audioBlob = await audioRes.blob();

  const form = new FormData();
  form.append("file", audioBlob, "audio.mp3");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");
  form.append("response_format", "text");

  const g = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: form,
  });
  if (!g.ok) throw new Error(`groq ${g.status}: ${await g.text()}`);
  const text = (await g.text()).trim();
  return `🎙️ [áudio ${seconds}s] ${text}`;
}

// ---------- main ----------
async function processLead(lead) {
  const canonical = normalizeBrPhone(lead.phone);
  if (!canonical || canonical.length < 12) {
    return { lead_id: lead.id, name: lead.full_name, skipped: "invalid_phone" };
  }

  const chatid = await getChatid(canonical);
  if (!chatid) return { lead_id: lead.id, name: lead.full_name, skipped: "no_chatid" };

  const msgs = await fetchAllMessages(chatid);

  // Filter out dedupes first (bulk check)
  const ids = msgs.map((m) => m.messageid).filter(Boolean);
  const existing = ids.length
    ? new Set(
        (await sql`select uazapi_id from processed_uazapi_crm_messages where uazapi_id = ANY(${ids})`).map(
          (r) => r.uazapi_id,
        ),
      )
    : new Set();

  let inbound_added = 0, outbound_ai = 0, outbound_human = 0;
  let skipped_dup = 0, skipped_media = 0, skipped_reaction = 0, skipped_group = 0;
  let audio_transcribed = 0, audio_failed = 0;

  for (const m of msgs) {
    if (m.isGroup) { skipped_group++; continue; }
    if (!m.messageid) { continue; }
    if (existing.has(m.messageid)) { skipped_dup++; continue; }

    const type = m.messageType;
    let texto = null;

    if (type === "Conversation" || type === "ExtendedTextMessage") {
      texto = m.text || m.content?.text || "";
    } else if (type === "AudioMessage") {
      if (NO_TRANSCRIBE) {
        texto = `🎙️ [áudio ${m.content?.seconds ?? "?"}s — transcrição desabilitada]`;
      } else if (m.fileURL) {
        if (DRY_RUN) {
          texto = `🎙️ [áudio ${m.content?.seconds ?? "?"}s — SERIA transcrito]`;
        } else {
          try {
            texto = await transcribeAudio(m.fileURL, m.content?.seconds ?? "?");
            audio_transcribed++;
          } catch (err) {
            console.warn(`  ⚠️  transcribe failed for ${m.messageid}: ${err.message}`);
            audio_failed++;
            texto = `🎙️ [áudio ${m.content?.seconds ?? "?"}s — transcrição falhou]`;
          }
        }
      } else {
        texto = `🎙️ [áudio — fileURL ausente]`;
      }
    } else if (type === "ImageMessage" || type === "VideoMessage" || type === "DocumentMessage" || type === "StickerMessage") {
      skipped_media++; continue;
    } else if (type === "ReactionMessage") {
      skipped_reaction++; continue;
    } else {
      // Contact, location, poll, etc — skip
      skipped_media++; continue;
    }

    if (!texto) continue;

    const receivedAt = new Date(m.messageTimestamp).toISOString();

    if (DRY_RUN) {
      if (m.fromMe) m.wasSentByApi ? outbound_ai++ : outbound_human++;
      else inbound_added++;
      continue;
    }

    // write
    try {
      if (!m.fromMe) {
        await sql`
          insert into messages_received (application_id, uazapi_message_id, chatid, numero, texto, message_type, received_at, raw_payload)
          values (${lead.id}, ${m.messageid}, ${chatid}, ${canonical}, ${texto}, ${type}, ${receivedAt}, ${sql.json(m)})
        `;
        inbound_added++;
      } else {
        const errorReason = m.wasSentByApi ? null : "human_sent_phone";
        await sql`
          insert into message_log (application_id, numero_normalizado, texto, http_status, uazapi_response, status, error_reason, attempted_at)
          values (${lead.id}, ${canonical}, ${texto}, ${200}, ${sql.json({ backfill: true, uazapi_id: m.messageid, source: m.source ?? null })}, 'sent', ${errorReason}, ${receivedAt})
        `;
        if (m.wasSentByApi) outbound_ai++; else outbound_human++;
      }

      await sql`
        insert into processed_uazapi_crm_messages (uazapi_id, application_id, processed_at)
        values (${m.messageid}, ${lead.id}, now())
        on conflict (uazapi_id) do nothing
      `;
    } catch (err) {
      console.warn(`  ⚠️  insert failed for ${m.messageid}: ${err.message}`);
    }
  }

  return {
    lead_id: lead.id,
    name: lead.full_name,
    phone_canonical: canonical,
    chatid,
    total_fetched: msgs.length,
    inbound_added,
    outbound_ai,
    outbound_human,
    skipped_dup,
    skipped_media,
    skipped_reaction,
    skipped_group,
    audio_transcribed,
    audio_failed,
  };
}

// ---------- driver ----------
console.log(`=== WhatsApp History Backfill ===`);
console.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "WRITE"} | Transcribe: ${NO_TRANSCRIBE ? "off" : "groq whisper-large-v3-turbo"} | Throttle: ${THROTTLE_MS}ms`);

let leads;
if (ONLY_LEAD) {
  leads = await sql`select id, phone, full_name from applications where id = ${ONLY_LEAD}`;
} else if (ALL_APPS) {
  // Process EVERY application — useful when we want to discover Carol-humana history
  // for leads never dispatched via the API.
  leads = await sql`
    select a.id, a.phone, a.full_name
      from applications a
     where a.phone is not null
     order by a.created_at asc, a.id
  `;
} else if (SINCE) {
  leads = await sql`
    select a.id, a.phone, a.full_name
      from applications a
     where a.phone is not null
       and exists (
         select 1 from message_log ml
          where ml.application_id = a.id
            and ml.status = 'sent'
            and ml.attempted_at >= ${SINCE}
       )
     order by a.created_at asc, a.id
  `;
} else {
  leads = await sql`
    select a.id, a.phone, a.full_name
      from applications a
     where a.phone is not null
       and exists (select 1 from message_log ml where ml.application_id = a.id)
     order by a.created_at asc, a.id
  `;
}

// Post-filter in JS: exclude test phones (normalizeBrPhone ensures canonical match)
if (EXCLUDE_TEST && !ONLY_LEAD) {
  const before = leads.length;
  const testSet = new Set(TEST_PHONES);
  leads = leads.filter((l) => {
    const digits = (l.phone || "").replace(/\D/g, "");
    const canonical = normalizeBrPhone(l.phone);
    return !testSet.has(digits) && !testSet.has(canonical);
  });
  console.log(`[filter] removed ${before - leads.length} test-phone leads`);
}
console.log(`Leads to process: ${leads.length}\n`);

const results = [];
for (let i = 0; i < leads.length; i++) {
  const lead = leads[i];
  const prefix = `[${i + 1}/${leads.length}]`;
  try {
    const r = await processLead(lead);
    results.push(r);
    if (r.skipped) {
      console.log(`${prefix} ${lead.full_name} → ⏭️ ${r.skipped}`);
    } else {
      console.log(`${prefix} ${lead.full_name} → fetched=${r.total_fetched} in=${r.inbound_added} ai_out=${r.outbound_ai} human_out=${r.outbound_human} audio=${r.audio_transcribed}/${r.audio_failed} skip(dup=${r.skipped_dup} media=${r.skipped_media} react=${r.skipped_reaction} grp=${r.skipped_group})`);
    }
  } catch (err) {
    console.error(`${prefix} ${lead.full_name} → ❌ ${err.message}`);
    results.push({ lead_id: lead.id, name: lead.full_name, error: err.message });
  }
  if (i < leads.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS));
}

// CSV report
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const csvPath = `scripts/backfill-report-${DRY_RUN ? "dryrun-" : ""}${ts}.csv`;
const csvHeader = "lead_id,name,phone_canonical,chatid,total_fetched,inbound_added,outbound_ai,outbound_human,skipped_dup,skipped_media,skipped_reaction,skipped_group,audio_transcribed,audio_failed,error,skipped";
const csvRows = results.map((r) => [
  r.lead_id ?? "",
  (r.name ?? "").replace(/,/g, ";"),
  r.phone_canonical ?? "",
  r.chatid ?? "",
  r.total_fetched ?? "",
  r.inbound_added ?? 0,
  r.outbound_ai ?? 0,
  r.outbound_human ?? 0,
  r.skipped_dup ?? 0,
  r.skipped_media ?? 0,
  r.skipped_reaction ?? 0,
  r.skipped_group ?? 0,
  r.audio_transcribed ?? 0,
  r.audio_failed ?? 0,
  r.error ?? "",
  r.skipped ?? "",
].join(","));
writeFileSync(csvPath, [csvHeader, ...csvRows].join("\n"));

// Totals
const totals = results.reduce((acc, r) => {
  if (r.error || r.skipped) return acc;
  acc.leads_ok++;
  acc.fetched += r.total_fetched || 0;
  acc.inbound += r.inbound_added || 0;
  acc.ai_out += r.outbound_ai || 0;
  acc.human_out += r.outbound_human || 0;
  acc.dup += r.skipped_dup || 0;
  acc.media += r.skipped_media || 0;
  acc.audio_ok += r.audio_transcribed || 0;
  acc.audio_fail += r.audio_failed || 0;
  return acc;
}, { leads_ok: 0, fetched: 0, inbound: 0, ai_out: 0, human_out: 0, dup: 0, media: 0, audio_ok: 0, audio_fail: 0 });

console.log(`\n=== TOTAIS ===`);
console.log(`Leads OK: ${totals.leads_ok}/${leads.length}`);
console.log(`Msgs fetched: ${totals.fetched}`);
console.log(`Would insert (dry-run) / Inserted: inbound=${totals.inbound} ai_out=${totals.ai_out} human_out=${totals.human_out}`);
console.log(`Skipped: dup=${totals.dup} media=${totals.media}`);
console.log(`Audio: transcribed=${totals.audio_ok} failed=${totals.audio_fail}`);
console.log(`\nReport: ${csvPath}`);

await sql.end();
