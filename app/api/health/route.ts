import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Railway's healthcheck and zero-downtime deploy readiness probe.
export function GET() {
  return NextResponse.json({ ok: true });
}
