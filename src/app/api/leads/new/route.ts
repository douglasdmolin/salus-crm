import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { leadQualificationWorkflow } from "../../../../workflows/lead-qualification";
import { getEnv } from "../../../../lib/env";
import { createServiceClient } from "../../../../lib/supabase";
import { isPhoneAllowedRuntime } from "../../../../lib/phone-whitelist";
import { redactWhatsapp } from "../../../../lib/redact";

export async function POST(req: NextRequest) {
  const env = getEnv();
  const auth = req.headers.get("authorization");

  if (auth !== `Bearer ${env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { leadId?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const leadId = payload.leadId;
  if (!leadId) {
    return NextResponse.json({ error: "missing leadId" }, { status: 400 });
  }

  // Whitelist check — fetch lead first, validate phone is allowed
  const supabase = createServiceClient();
  const { data: lead } = await supabase
    .from("applications")
    .select("id, phone, crm_stage, do_not_contact")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ error: "lead not found" }, { status: 404 });
  }
  if (lead.do_not_contact) {
    return NextResponse.json({ ok: true, skipped: "do_not_contact" });
  }
  if (!(await isPhoneAllowedRuntime(lead.phone))) {
    console.log("leads/new: dispatch blocked by runtime config", {
      leadId,
      phone: redactWhatsapp(lead.phone),
    });
    return NextResponse.json({ ok: true, skipped: "dispatch_disabled_or_not_whitelisted" });
  }

  try {
    const run = await start(leadQualificationWorkflow, [leadId]);

    const { error: updateErr } = await supabase
      .from("applications")
      .update({ workflow_run_id: run.runId })
      .eq("id", leadId);
    if (updateErr) console.error("failed to save workflow_run_id", updateErr.message);

    return NextResponse.json({ ok: true, runId: run.runId }, { status: 202 });
  } catch (err) {
    console.error("workflow start failed", { leadId, err: String(err) });
    return NextResponse.json({ error: "workflow start failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "leads/new", method: "POST" });
}
