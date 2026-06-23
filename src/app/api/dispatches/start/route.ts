import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { dispatchBatchWorkflow } from "../../../../workflows/dispatch-batch";
import { createServiceClient } from "../../../../lib/supabase";
import { isPhoneAllowedRuntime } from "../../../../lib/phone-whitelist";
import { listActiveInstanceIds } from "../../../../lib/crm-config";

const ALLOWED_BATCH_SIZES = [10, 20, 30] as const;
const ALLOWED_INTERVALS = [30, 60, 90] as const;
// Stages que podem receber disparo. O disparo é específico da etapa: cada botão
// do board envia apenas as stages da sua coluna.
//   lead_qualificado — lead novo aguardando primeiro contato (canônico)
//   novo             — legado (leads não migrados) — pertence à coluna "Novo Contato"
//   lead_contatado   — re-disparo: mensagem foi enviada mas workflow não está ativo
const ALLOWED_STAGES = ["lead_qualificado", "novo", "lead_contatado"] as const;

export async function POST(req: NextRequest) {
  let payload: { batchSize?: number; intervalSeconds?: number; stages?: string[] };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const batchSize = payload.batchSize ?? 0;
  const intervalSeconds = payload.intervalSeconds ?? 0;

  if (!ALLOWED_BATCH_SIZES.includes(batchSize as never)) {
    return NextResponse.json({ error: `batchSize must be one of ${ALLOWED_BATCH_SIZES.join(", ")}` }, { status: 400 });
  }
  if (!ALLOWED_INTERVALS.includes(intervalSeconds as never)) {
    return NextResponse.json({ error: `intervalSeconds must be one of ${ALLOWED_INTERVALS.join(", ")}` }, { status: 400 });
  }

  // Stages-alvo: precisam vir do cliente (disparo específico da etapa). Sem stages
  // válidas não há fallback para "todas" — isso evita disparar para etapas erradas.
  const requestedStages = Array.isArray(payload.stages)
    ? payload.stages.filter((s) => ALLOWED_STAGES.includes(s as never))
    : [];
  if (requestedStages.length === 0) {
    return NextResponse.json({ error: `stages must be a non-empty subset of ${ALLOWED_STAGES.join(", ")}` }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: candidates, error } = await supabase
    .from("applications")
    .select("id, full_name, phone, crm_stage, workflow_run_id")
    .in("crm_stage", requestedStages)
    .eq("do_not_contact", false)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(batchSize * 2);

  if (error) {
    console.error("dispatches/start: select failed", error.message);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  const eligibilityChecks = await Promise.all((candidates ?? []).map(async (l) => ({ lead: l, allowed: await isPhoneAllowedRuntime(l.phone) })));
  const eligible = eligibilityChecks
    .filter((x) => {
      if (!x.allowed) return false;
      // Nunca re-disparar lead que já tem workflow ativo (evita HookConflictError em qualquer stage)
      if (x.lead.workflow_run_id) return false;
      return true;
    })
    .map((x) => x.lead)
    .slice(0, batchSize);

  if (eligible.length === 0) {
    return NextResponse.json({ error: `no eligible leads in ${requestedStages.join(", ")}` }, { status: 422 });
  }

  const leadIds = eligible.map((l) => l.id);

  // Distribuição round-robin entre os números de WhatsApp ativos (multi-número).
  // Cada lead "fica" no número que o disparou — respostas saem pelo mesmo.
  // Sem instâncias configuradas → não atribui (usa o token global, modo 1-número).
  const instanceIds = await listActiveInstanceIds();
  if (instanceIds.length > 0) {
    await Promise.all(
      eligible.map((l, i) =>
        supabase
          .from("applications")
          .update({ whatsapp_instance_id: instanceIds[i % instanceIds.length] })
          .eq("id", l.id),
      ),
    );
  }

  try {
    const run = await start(dispatchBatchWorkflow, [{ leadIds, intervalSeconds }]);
    const totalSeconds = (leadIds.length - 1) * intervalSeconds;
    const totalMinutes = Math.round(totalSeconds / 60);

    return NextResponse.json(
      {
        ok: true,
        runId: run.runId,
        leadCount: leadIds.length,
        intervalSeconds,
        estimatedDurationMinutes: totalMinutes,
        leads: eligible.map((l) => ({ id: l.id, name: l.full_name })),
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("dispatches/start: workflow start failed", String(err));
    return NextResponse.json({ error: "workflow start failed" }, { status: 500 });
  }
}
