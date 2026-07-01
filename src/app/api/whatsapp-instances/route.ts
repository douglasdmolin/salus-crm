import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

const PROVIDERS = ["uazapi", "evolution"] as const;

/** Lista as instâncias de WhatsApp (números) cadastradas. */
export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("id, name, provider, instance_name, uazapi_url, uazapi_token, active, created_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Não devolve o token inteiro — só um indicador de que existe. A URL não é segredo.
  const safe = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    provider: r.provider ?? "uazapi",
    instance_name: r.instance_name ?? "",
    uazapi_url: r.uazapi_url ?? "",
    active: r.active,
    created_at: r.created_at,
    token_set: Boolean(r.uazapi_token),
  }));
  return NextResponse.json(safe);
}

/** Cadastra uma nova instância (número de WhatsApp) — uazapi ou evolution. */
export async function POST(req: NextRequest) {
  let body: { id?: string; name?: string; provider?: string; instance_name?: string; uazapi_url?: string; uazapi_token?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const idDigits = (body.id ?? "").replace(/\D/g, "");
  const name = (body.name ?? "").trim();
  const provider = (body.provider ?? "uazapi").trim();
  const instanceName = (body.instance_name ?? "").trim();
  const serverUrl = (body.uazapi_url ?? "").trim();
  const token = (body.uazapi_token ?? "").trim();

  if (!PROVIDERS.includes(provider as never)) {
    return NextResponse.json({ error: `provider inválido — use ${PROVIDERS.join(" ou ")}` }, { status: 400 });
  }
  if (idDigits.length < 10) {
    return NextResponse.json({ error: "número inválido — informe o número com DDI (apenas dígitos), ex: 17869874674" }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 });
  if (!serverUrl.startsWith("http")) return NextResponse.json({ error: "Server URL inválida — deve começar com http(s)://" }, { status: 400 });
  if (!token) return NextResponse.json({ error: "token/apikey da instância é obrigatório" }, { status: 400 });
  if (provider === "evolution" && !instanceName) {
    return NextResponse.json({ error: "instance_name (nome da instância no Evolution) é obrigatório" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .insert({
      id: idDigits,
      name,
      provider,
      instance_name: provider === "evolution" ? instanceName : null,
      uazapi_url: serverUrl,
      uazapi_token: token,
      active: true,
    })
    .select("id, name, provider, instance_name, uazapi_url, active, created_at")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500; // 23505 = unique_violation (número já existe)
    const msg = status === 409 ? "esse número já está cadastrado" : error.message;
    return NextResponse.json({ error: msg }, { status });
  }
  return NextResponse.json({ ...data, token_set: true }, { status: 201 });
}
