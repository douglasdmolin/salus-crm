import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "sociedade-nexialistas-lead-engine",
    version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    timestamp: new Date().toISOString(),
  });
}
