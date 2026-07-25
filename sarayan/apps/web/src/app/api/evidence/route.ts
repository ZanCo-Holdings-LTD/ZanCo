import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { generatePack, storePack } from "@/lib/evidence";
import { assertCan } from "@/lib/rbac";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Generate, store and return a compliance evidence pack as a PDF. */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
    assertCan(session.role, "evidence.generate");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Not permitted." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entity");
  const status = url.searchParams.get("status");

  // Second-resolution: two packs generated in the same second over the same
  // data hash identically, which is exactly the reproducibility we want.
  const generatedAt = new Date(Math.floor(Date.now() / 1000) * 1000);

  const scope = {
    organisationId: session.organisation.id,
    entityId: entityId && entityId !== "all" ? entityId : null,
    status,
    generatedBy: { id: session.user.id, name: session.user.name },
    organisationName: session.organisation.name,
    generatedAt,
  };

  const generated = await generatePack(scope);
  await storePack(scope, generated, generatedAt);

  await audit({
    organisationId: session.organisation.id,
    actorUserId: session.user.id,
    actorLabel: session.user.name,
    action: "evidence.generated",
    subjectType: "evidence_pack",
    subjectId: generated.pack.hash,
    metadata: { records: generated.pack.summary.total, scope: generated.scopeLabel },
  });

  const filename = `sarayan-evidence-${generated.pack.hash.slice(0, 12)}.pdf`;
  return new NextResponse(new Uint8Array(generated.pack.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-evidence-hash": generated.pack.hash,
    },
  });
}
