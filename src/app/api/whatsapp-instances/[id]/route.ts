import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

/** Atualiza uma instância: nome, token e/ou ativo. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { name?: string; uazapi_url?: string; uazapi_token?: string; active?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.uazapi_url === "string" && body.uazapi_url.trim()) patch.uazapi_url = body.uazapi_url.trim();
  if (typeof body.uazapi_token === "string" && body.uazapi_token.trim()) patch.uazapi_token = body.uazapi_token.trim();
  if (typeof body.active === "boolean") patch.active = body.active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .update(patch)
    .eq("id", id)
    .select("id, name, uazapi_url, active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, token_set: true });
}

/** Remove uma instância. Leads que apontavam para ela voltam ao token global. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceClient();
  const { error } = await supabase.from("whatsapp_instances").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
