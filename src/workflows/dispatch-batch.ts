import { sleep } from "workflow";
import { startLeadWorkflow } from "./steps/start-lead";

/**
 * Batch dispatch workflow — fires per-lead Carol workflows with throttle.
 * Durable: survives restarts via Vercel Workflow DevKit.
 *
 * Total runtime can be hours — DevKit suspends between sleeps without consuming
 * compute. No timeout limits.
 */
export async function dispatchBatchWorkflow(
  args: { leadIds: string[]; intervalSeconds: number }
) {
  "use workflow";

  const { leadIds, intervalSeconds } = args;
  const startedRunIds: string[] = [];

  for (let i = 0; i < leadIds.length; i++) {
    const leadId = leadIds[i];
    const runId = await startLeadWorkflow(leadId);
    startedRunIds.push(runId);

    if (i < leadIds.length - 1) {
      await sleep(`${intervalSeconds}s`);
    }
  }

  return {
    total: leadIds.length,
    startedRunIds,
    intervalSeconds,
  };
}
