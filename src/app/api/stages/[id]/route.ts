import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: {
    label?: string;
    short?: string;
    color?: string;
    description?: string;
    owner?: string;
    position?: number;
    is_active?: boolean;
    system_prompt?: string | null;
    ai_model?: string;
    ai_enabled?: boolean;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.label === "string" && body.label.trim()) patch.label = body.label.trim();
  if (typeof body.short === "string" && body.short.trim()) patch.short = body.short.trim();
  if (typeof body.color === "string") patch.color = body.color;
  if (typeof body.description === "string") patch.description = body.description;
  if (body.owner === "ia" || body.owner === "human") patch.owner = body.owner;
  if (typeof body.position === "number") patch.position = body.position;
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if ("system_prompt" in body) patch.system_prompt = body.system_prompt ?? null;
  if (typeof body.ai_model === "string") patch.ai_model = body.ai_model;
  if (typeof body.ai_enabled === "boolean") patch.ai_enabled = body.ai_enabled;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no valid fields" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("kanban_stages")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const permanent = req.nextUrl.searchParams.get("permanent") === "true";
  const supabase = createServiceClient();

  // Bloquear se houver leads nessa etapa
  const { count } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("crm_stage", id)
    .is("deleted_at", null);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `Não é possível excluir: ${count} lead(s) nessa etapa. Mova-os primeiro.` },
      { status: 409 }
    );
  }

  if (permanent) {
    const { error } = await supabase
      .from("kanban_stages")
      .delete()
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: id });
  }

  // Soft-delete (desativar)
  const { data, error } = await supabase
    .from("kanban_stages")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
