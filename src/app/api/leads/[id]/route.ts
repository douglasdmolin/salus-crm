import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, type Application } from "../../../../lib/supabase";
import { applicationToUiLead } from "../../../../components/crm/ui-lead";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { crm_stage?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const { crm_stage } = body;
  if (!crm_stage) return NextResponse.json({ error: "crm_stage required" }, { status: 400 });

  const supabase = createServiceClient();
  // Mover de volta para o estágio inicial limpa workflow_run_id e hook_token — pronto para novo disparo
  const patch: Record<string, unknown> = { crm_stage };
  if (crm_stage === "lead_qualificado" || crm_stage === "novo") {
    patch.workflow_run_id = null;
    patch.hook_token = null;
  }
  const { error } = await supabase.from("applications").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceClient();

  const [{ data: app }, { data: lastIn }, { data: lastOut }] = await Promise.all([
    supabase.from("applications").select("*").eq("id", id).maybeSingle(),
    supabase.from("messages_received").select("texto, received_at").eq("application_id", id).order("received_at", { ascending: false }).limit(1),
    supabase.from("message_log").select("texto, attempted_at").eq("application_id", id).eq("status", "sent").order("attempted_at", { ascending: false }).limit(1),
  ]);

  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Build message index with most recent message for this lead
  const inn = lastIn?.[0];
  const out = lastOut?.[0];
  let msgIdx: { texto: string; direction: "in" | "out"; ts: string } | undefined;
  if (inn?.texto && out?.texto) {
    msgIdx = inn.received_at > out.attempted_at
      ? { texto: inn.texto, direction: "in", ts: inn.received_at }
      : { texto: out.texto, direction: "out", ts: out.attempted_at };
  } else if (inn?.texto) {
    msgIdx = { texto: inn.texto, direction: "in", ts: inn.received_at };
  } else if (out?.texto) {
    msgIdx = { texto: out.texto, direction: "out", ts: out.attempted_at };
  }

  const uiLead = applicationToUiLead(app as Application, msgIdx ? { [id]: msgIdx } : undefined);
  return NextResponse.json({ lead: uiLead });
}
