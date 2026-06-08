import { NextResponse } from "next/server";
import { getUazapiConfig } from "../../../../lib/crm-config";

export const dynamic = "force-dynamic";

/**
 * Reports Uazapi instance health for the CRM config page.
 * Returns: status (connected/connecting/disconnected), profile name, picture, business flag, etc.
 */
export async function GET() {
  const uazapi = await getUazapiConfig();
  if (!uazapi) {
    return NextResponse.json({ ok: false, error: "Uazapi não configurado — defina URL e Token nas Configurações" }, { status: 200 });
  }
  try {
    const res = await fetch(`${uazapi.url}/status`, {
      method: "GET",
      headers: { token: uazapi.token, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: "unknown", httpStatus: res.status }, { status: 200 });
    }
    const j = await res.json();
    const inst = j?.status?.checked_instance ?? {};
    const serverStatus = j?.status?.server_status ?? "unknown";
    return NextResponse.json({
      ok: true,
      status: inst.connection_status ?? serverStatus,
      isHealthy: Boolean(inst.is_healthy),
      name: inst.name ?? null,
      serverStatus,
      node: j?.status?.node ?? null,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 });
  }
}
