import "server-only";

import { headers } from "next/headers";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { clientIp } from "./auth";

/**
 * The audit trail.
 *
 * Auditors ask "who changed this expiry date and when". Without an answer, the
 * evidence pack is a claim rather than a record — so every mutation writes here.
 */
export async function audit(entry: {
  organisationId: string | null;
  actorUserId: string | null;
  actorLabel: string;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  let ip: string | null = null;
  try {
    ip = clientIp(await headers());
  } catch {
    // Outside a request scope (cron, scripts) — the entry is still worth writing.
  }

  await db.insert(auditLog).values({
    organisationId: entry.organisationId,
    actorUserId: entry.actorUserId,
    actorLabel: entry.actorLabel,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId ?? null,
    metadata: entry.metadata ?? {},
    ipAddress: ip,
  });
}
