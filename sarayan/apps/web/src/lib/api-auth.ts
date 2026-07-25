import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, organisations, type Organisation } from "@/db/schema";
import { planFor } from "./plans";

/**
 * API key authentication for the public v1 API.
 *
 * Keys are stored only as SHA-256 hashes and shown once at creation. The prefix
 * is kept in plaintext so a user can identify a key in a list without it being
 * a credential.
 */

export interface ApiContext {
  organisation: Organisation;
  keyId: string;
}

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `sk_live_${secret}`;
  return {
    plaintext,
    hash: createHash("sha256").update(plaintext).digest("hex"),
    prefix: plaintext.slice(0, 16),
  };
}

export type ApiAuthResult =
  | { ok: true; context: ApiContext }
  | { ok: false; status: 401 | 403; error: string };

export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Supply an API key as a Bearer token." };

  const hash = createHash("sha256").update(token).digest("hex");
  const rows = await db
    .select({ key: apiKeys, organisation: organisations })
    .from(apiKeys)
    .innerJoin(organisations, eq(organisations.id, apiKeys.organisationId))
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, status: 401, error: "That API key is not valid." };

  if (!planFor(row.organisation.tier).api) {
    return {
      ok: false,
      status: 403,
      error: "API access requires the Enterprise or Agency plan.",
    };
  }

  // Fire-and-forget: last-used is diagnostic, and must not slow the request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.key.id))
    .catch(() => undefined);

  return { ok: true, context: { organisation: row.organisation, keyId: row.key.id } };
}
