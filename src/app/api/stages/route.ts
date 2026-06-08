import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("kanban_stages")
    .select("*")
    .order("position", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  let body: {
    id?: string;
    label?: string;
    short?: string;
    color?: string;
    description?: string;
    owner?: string;
    position?: number;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { id, label, short, color, description, owner, position } = body;
  if (!id || !label || !short) {
    return NextResponse.json({ error: "id, label e short são obrigatórios" }, { status: 400 });
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    return NextResponse.json({ error: "id deve conter apenas letras minúsculas, números e underscores" }, { status: 400 });
  }
  if (owner && !["ia", "human"].includes(owner)) {
    return NextResponse.json({ error: "owner deve ser 'ia' ou 'human'" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Calcular position máxima se não fornecida
  let nextPos = position;
  if (nextPos === undefined) {
    const { data: last } = await supabase
      .from("kanban_stages")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextPos = (last?.position ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("kanban_stages")
    .insert({
      id,
      label,
      short,
      color: color ?? "#94a3b8",
      description: description ?? "",
      owner: owner ?? "human",
      position: nextPos,
      is_active: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
