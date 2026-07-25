import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordFiles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Serve a stored document.
 *
 * Files are streamed through the application rather than via a public object
 * URL: the tenant's key has to decrypt them, and every access is auditable.
 * A pre-signed URL would be faster and would also mean an unlogged read of a
 * passport scan.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(recordFiles)
    .where(and(eq(recordFiles.id, id), eq(recordFiles.organisationId, session.organisation.id)))
    .limit(1);

  const file = rows[0];
  if (!file) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!session.organisation.wrappedDataKey) {
    return NextResponse.json({ error: "Encryption key missing." }, { status: 500 });
  }

  let plaintext: Buffer;
  try {
    plaintext = await getObject(file.storageKey, session.organisation.wrappedDataKey);
  } catch {
    return NextResponse.json({ error: "The stored file could not be read." }, { status: 500 });
  }

  await audit({
    organisationId: session.organisation.id,
    actorUserId: session.user.id,
    actorLabel: session.user.name,
    action: "file.downloaded",
    subjectType: "record_file",
    subjectId: file.id,
    metadata: { filename: file.filename },
  });

  return new NextResponse(new Uint8Array(plaintext), {
    headers: {
      "content-type": file.mimeType,
      // `inline` for images and PDFs the browser can render safely; the CSP
      // still forbids scripts, and the filename is quoted against header
      // injection.
      "content-disposition": `inline; filename="${file.filename.replace(/["\\\r\n]/g, "")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
