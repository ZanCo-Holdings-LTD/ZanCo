import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { features } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness and readiness.
 *
 * Reports which integrations are configured, because "the app is up" and "the
 * app can send an alert" are different questions and only the second one
 * matters to a customer.
 */
export async function GET() {
  let database = false;
  try {
    await db.execute(sql`select 1`);
    database = true;
  } catch {
    database = false;
  }

  return NextResponse.json(
    {
      status: database ? "ok" : "degraded",
      database,
      features,
      timestamp: new Date().toISOString(),
    },
    { status: database ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
