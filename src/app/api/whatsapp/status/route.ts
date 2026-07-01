import { NextRequest, NextResponse } from "next/server";
import { getWhatsappConfig } from "../../../../lib/crm-config";
import { getAdapter } from "../../../../lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Reports WhatsApp instance health for the CRM config page.
 * - sem `?instanceId=`: config global (uazapi, modo 1-número / badge global).
 * - com `?instanceId=<num>`: health da instância específica, no seu provider.
 * Returns: status (connected/connecting/disconnected), profile name, etc.
 */
export async function GET(req: NextRequest) {
  const instanceId = req.nextUrl.searchParams.get("instanceId");
  const cfg = await getWhatsappConfig(instanceId);
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "WhatsApp não configurado — defina URL e Token nas Configurações" }, { status: 200 });
  }

  const result = await getAdapter(cfg.provider).getStatus(cfg);
  return NextResponse.json({
    ok: result.ok,
    provider: cfg.provider,
    status: result.status,
    name: result.name ?? null,
    error: result.error,
  });
}
