import { start } from "workflow/api";
import { leadQualificationWorkflow } from "../lead-qualification";
import { createServiceClient } from "../../lib/supabase";
import { randomUUID } from "crypto";

/**
 * Start a child workflow for a single lead and persist its run id.
 * Generates a unique hook token per run — prevents HookConflictError when
 * a lead is re-dispatched while an old workflow is still alive.
 *
 * Guard: if lead already has an active workflow_run_id at execution time,
 * skip and return the existing run id. This handles the race condition where
 * the dispatch batch pre-filtered the lead but a new workflow started between
 * batch creation and execution.
 */
export async function startLeadWorkflow(leadId: string): Promise<string> {
  "use step";
  const supabase = createServiceClient();

  const { data: current } = await supabase
    .from("applications")
    .select("workflow_run_id")
    .eq("id", leadId)
    .maybeSingle();

  if (current?.workflow_run_id) {
    console.log("dispatch-batch: lead already has active workflow, skipping", {
      leadId,
      runId: current.workflow_run_id,
    });
    return current.workflow_run_id;
  }

  const hookToken = `lead:${leadId}:inbound:${randomUUID()}`;

  // Salva o token ANTES de iniciar o workflow para que o webhook já o encontre
  await supabase
    .from("applications")
    .update({ hook_token: hookToken })
    .eq("id", leadId);

  const run = await start(leadQualificationWorkflow, [leadId, hookToken]);

  await supabase
    .from("applications")
    .update({ workflow_run_id: run.runId })
    .eq("id", leadId);

  console.log("dispatch-batch: started child workflow", { leadId, runId: run.runId, hookToken });
  return run.runId;
}
