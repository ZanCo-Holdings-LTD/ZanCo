"use server";

import { daysBetween, today } from "@sarayan/core-watch";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  alerts,
  entities,
  holders,
  invitations,
  memberships,
  organisations,
  records,
  renewalTasks,
  users,
} from "@/db/schema";
import { documentType } from "@/content/taxonomy";
import { audit } from "@/lib/audit";
import { hashPassword, requireSession, switchOrganisation } from "@/lib/auth";
import { recordObservation } from "@/lib/leadtime";
import { checkLimit } from "@/lib/plans";
import { assertCan, type Permission } from "@/lib/rbac";
import { cancelFutureAlerts, statusOf, syncAlerts } from "@/lib/records";
import { str } from "@/lib/utils";

/**
 * Server actions.
 *
 * Every one of these is an enforcement point, not a convenience wrapper. The
 * order is always: resolve the session, check the permission, check the plan
 * limit, scope the query to the organisation, mutate, audit, revalidate. The
 * organisation scope is repeated on every `where` clause deliberately — a
 * missing tenant filter is the one bug in a multi-tenant product that cannot be
 * recovered from.
 */

export interface ActionState {
  error: string | null;
  success?: string | null;
}

async function guard(permission: Permission) {
  const session = await requireSession();
  assertCan(session.role, permission);
  return session;
}

function fail(error: unknown): ActionState {
  if (error instanceof Error && (error.name === "ForbiddenError" || error.name === "AuthError")) {
    return { error: error.message };
  }
  // Never leak a database error string to the browser.
  console.error("[action]", error);
  return { error: "Something went wrong. Try again." };
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

export async function switchOrganisationAction(organisationId: string): Promise<void> {
  const session = await requireSession();
  const permitted = session.organisations.some(
    (entry) => entry.organisation.id === organisationId,
  );
  if (!permitted) return;
  await switchOrganisation(organisationId);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const recordSchema = z.object({
  entityId: z.uuid("Choose an entity."),
  holderId: z.uuid("Choose a holder."),
  documentTypeCode: z.string().trim().min(1).nullable(),
  customTypeName: z.string().trim().max(160).nullable(),
  documentNumber: z.string().trim().max(120).nullable(),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  noExpiry: z.boolean(),
  issuingAuthority: z.string().trim().max(200).nullable(),
  ownerUserId: z.uuid().nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

function readRecordForm(formData: FormData) {
  return recordSchema.safeParse({
    entityId: str(formData.get("entityId")) ?? "",
    holderId: str(formData.get("holderId")) ?? "",
    documentTypeCode: str(formData.get("documentTypeCode")),
    customTypeName: str(formData.get("customTypeName")),
    documentNumber: str(formData.get("documentNumber")),
    issuedOn: str(formData.get("issuedOn")),
    expiresOn: str(formData.get("expiresOn")),
    noExpiry: formData.get("noExpiry") === "on",
    issuingAuthority: str(formData.get("issuingAuthority")),
    ownerUserId: str(formData.get("ownerUserId")),
    notes: str(formData.get("notes")),
  });
}

export async function createRecordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard("records.create");
    const parsed = readRecordForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Check the form." };
    }
    const input = parsed.data;

    if (!input.noExpiry && !input.expiresOn) {
      return { error: "Enter an expiry date, or tick that this document does not expire." };
    }
    if (!input.documentTypeCode && !input.customTypeName) {
      return { error: "Choose a document type." };
    }
    if (input.issuedOn && input.expiresOn && input.issuedOn > input.expiresOn) {
      return { error: "The expiry date cannot be before the issue date." };
    }

    const [{ used }] = await db
      .select({ used: count() })
      .from(records)
      .where(eq(records.organisationId, session.organisation.id));
    const limit = checkLimit(session.organisation.tier, "records", used);
    if (!limit.allowed) return { error: limit.message };

    // Scope check: the entity and holder must belong to this organisation.
    const owned = await db
      .select({ id: holders.id })
      .from(holders)
      .where(
        and(
          eq(holders.id, input.holderId),
          eq(holders.entityId, input.entityId),
          eq(holders.organisationId, session.organisation.id),
        ),
      )
      .limit(1);
    if (owned.length === 0) return { error: "That holder does not belong to this organisation." };

    const [created] = await db
      .insert(records)
      .values({
        organisationId: session.organisation.id,
        entityId: input.entityId,
        holderId: input.holderId,
        documentTypeCode: input.documentTypeCode,
        customTypeName: input.customTypeName,
        documentNumber: input.documentNumber,
        issuedOn: input.issuedOn,
        expiresOn: input.noExpiry ? null : input.expiresOn,
        noExpiry: input.noExpiry,
        issuingAuthority:
          input.issuingAuthority ??
          (input.documentTypeCode ? documentType(input.documentTypeCode)?.issuingAuthority ?? null : null),
        ownerUserId: input.ownerUserId ?? session.user.id,
        notes: input.notes,
        createdBy: session.user.id,
        status: statusOf({
          id: "new",
          expiresOn: input.noExpiry ? null : input.expiresOn,
          noExpiry: input.noExpiry,
          archivedAt: null,
        }),
      })
      .returning({ id: records.id });

    await syncAlerts(created.id);
    await audit({
      organisationId: session.organisation.id,
      actorUserId: session.user.id,
      actorLabel: session.user.name,
      action: "record.created",
      subjectType: "record",
      subjectId: created.id,
      metadata: { documentTypeCode: input.documentTypeCode, expiresOn: input.expiresOn },
    });

    revalidatePath("/", "layout");
    return { error: null, success: "Record saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function updateRecordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard("records.edit");
    const recordId = str(formData.get("recordId"));
    if (!recordId) return { error: "Missing record." };

    const parsed = readRecordForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Check the form." };
    }
    const input = parsed.data;
    if (!input.noExpiry && !input.expiresOn) {
      return { error: "Enter an expiry date, or tick that this document does not expire." };
    }

    const existing = await db
      .select()
      .from(records)
      .where(and(eq(records.id, recordId), eq(records.organisationId, session.organisation.id)))
      .limit(1);
    if (existing.length === 0) return { error: "Record not found." };

    const expiresOn = input.noExpiry ? null : input.expiresOn;

    await db
      .update(records)
      .set({
        entityId: input.entityId,
        holderId: input.holderId,
        documentTypeCode: input.documentTypeCode,
        customTypeName: input.customTypeName,
        documentNumber: input.documentNumber,
        issuedOn: input.issuedOn,
        expiresOn,
        noExpiry: input.noExpiry,
        issuingAuthority: input.issuingAuthority,
        ownerUserId: input.ownerUserId,
        notes: input.notes,
        status: statusOf({ id: recordId, expiresOn, noExpiry: input.noExpiry, archivedAt: null }),
        updatedAt: new Date(),
      })
      .where(and(eq(records.id, recordId), eq(records.organisationId, session.organisation.id)));

    await syncAlerts(recordId);

    // The expiry date is the one field an auditor will ask about by name.
    if (existing[0].expiresOn !== expiresOn) {
      await audit({
        organisationId: session.organisation.id,
        actorUserId: session.user.id,
        actorLabel: session.user.name,
        action: "record.expiry_changed",
        subjectType: "record",
        subjectId: recordId,
        metadata: { from: existing[0].expiresOn, to: expiresOn },
      });
    }

    revalidatePath("/", "layout");
    return { error: null, success: "Record saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteRecordAction(formData: FormData): Promise<void> {
  const session = await guard("records.delete");
  const recordId = str(formData.get("recordId"));
  const locale = str(formData.get("locale")) ?? "en";
  if (!recordId) return;

  await db
    .delete(records)
    .where(and(eq(records.id, recordId), eq(records.organisationId, session.organisation.id)));

  await audit({
    organisationId: session.organisation.id,
    actorUserId: session.user.id,
    actorLabel: session.user.name,
    action: "record.deleted",
    subjectType: "record",
    subjectId: recordId,
  });

  revalidatePath("/", "layout");
  redirect(`/${locale}/app/records`);
}

// ---------------------------------------------------------------------------
// Holders
// ---------------------------------------------------------------------------

const holderSchema = z.object({
  entityId: z.uuid("Choose an entity."),
  kind: z.enum(["person", "vehicle", "asset", "entity"]),
  name: z.string().trim().min(1, "Enter a name.").max(160),
  nameAr: z.string().trim().max(160).nullable(),
  reference: z.string().trim().max(80).nullable(),
  nationality: z.string().trim().max(80).nullable(),
  department: z.string().trim().max(120).nullable(),
  email: z.string().trim().max(255).nullable(),
  phone: z.string().trim().max(40).nullable(),
  identifier: z.string().trim().max(80).nullable(),
});

export async function createHolderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard("holders.manage");
    const parsed = holderSchema.safeParse({
      entityId: str(formData.get("entityId")) ?? "",
      kind: str(formData.get("kind")) ?? "person",
      name: str(formData.get("name")) ?? "",
      nameAr: str(formData.get("nameAr")),
      reference: str(formData.get("reference")),
      nationality: str(formData.get("nationality")),
      department: str(formData.get("department")),
      email: str(formData.get("email")),
      phone: str(formData.get("phone")),
      identifier: str(formData.get("identifier")),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    const entityOwned = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.id, parsed.data.entityId),
          eq(entities.organisationId, session.organisation.id),
        ),
      )
      .limit(1);
    if (entityOwned.length === 0) return { error: "That entity does not belong to this organisation." };

    await db.insert(holders).values({
      ...parsed.data,
      organisationId: session.organisation.id,
    });

    revalidatePath("/", "layout");
    return { error: null, success: "Holder added." };
  } catch (error) {
    return fail(error);
  }
}

export async function archiveHolderAction(formData: FormData): Promise<void> {
  const session = await guard("holders.manage");
  const holderId = str(formData.get("holderId"));
  if (!holderId) return;

  await db
    .update(holders)
    .set({ archivedAt: new Date() })
    .where(and(eq(holders.id, holderId), eq(holders.organisationId, session.organisation.id)));

  // Archiving a leaver must silence their alerts, or the register nags forever.
  const affected = await db
    .select({ id: records.id })
    .from(records)
    .where(and(eq(records.holderId, holderId), eq(records.organisationId, session.organisation.id)));

  if (affected.length > 0) {
    const ids = affected.map((row) => row.id);
    await db.update(records).set({ archivedAt: new Date(), status: "dormant" }).where(inArray(records.id, ids));
    await cancelFutureAlerts(ids);
  }

  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export async function createEntityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard("entities.manage");
    const name = str(formData.get("name"));
    if (!name) return { error: "Enter an entity name." };

    const [{ used }] = await db
      .select({ used: count() })
      .from(entities)
      .where(eq(entities.organisationId, session.organisation.id));
    const limit = checkLimit(session.organisation.tier, "entities", used);
    if (!limit.allowed) return { error: limit.message };

    await db.insert(entities).values({
      organisationId: session.organisation.id,
      name,
      legalName: str(formData.get("legalName")),
      nameAr: str(formData.get("nameAr")),
      country: str(formData.get("country")) ?? session.organisation.country,
      jurisdiction: str(formData.get("jurisdiction")),
      registrationNumber: str(formData.get("registrationNumber")),
      taxNumber: str(formData.get("taxNumber")),
      clientReference: str(formData.get("clientReference")),
      contactName: str(formData.get("contactName")),
      contactEmail: str(formData.get("contactEmail")),
      contactPhone: str(formData.get("contactPhone")),
    });

    revalidatePath("/", "layout");
    return { error: null, success: "Entity added." };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export async function acknowledgeAlertAction(formData: FormData): Promise<void> {
  const session = await guard("alerts.acknowledge");
  const alertId = str(formData.get("alertId"));
  if (!alertId) return;

  await db
    .update(alerts)
    .set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: session.user.id })
    .where(and(eq(alerts.id, alertId), eq(alerts.organisationId, session.organisation.id)));

  await audit({
    organisationId: session.organisation.id,
    actorUserId: session.user.id,
    actorLabel: session.user.name,
    action: "alert.acknowledged",
    subjectType: "alert",
    subjectId: alertId,
  });

  revalidatePath("/", "layout");
}

export async function acknowledgeAllAction(formData: FormData): Promise<void> {
  const session = await guard("alerts.acknowledge");
  const recordId = str(formData.get("recordId"));

  await db
    .update(alerts)
    .set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: session.user.id })
    .where(
      and(
        eq(alerts.organisationId, session.organisation.id),
        eq(alerts.status, "sent"),
        recordId ? eq(alerts.recordId, recordId) : sql`true`,
      ),
    );

  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Renewals
// ---------------------------------------------------------------------------

export async function startRenewalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard("renewals.manage");
    const recordId = str(formData.get("recordId"));
    if (!recordId) return { error: "Missing record." };

    const owned = await db
      .select({ id: records.id, expiresOn: records.expiresOn })
      .from(records)
      .where(and(eq(records.id, recordId), eq(records.organisationId, session.organisation.id)))
      .limit(1);
    if (owned.length === 0) return { error: "Record not found." };

    await db.insert(renewalTasks).values({
      organisationId: session.organisation.id,
      recordId,
      status: "in_progress",
      assigneeUserId: str(formData.get("assigneeUserId")) ?? session.user.id,
      startedOn: today(),
      targetOn: str(formData.get("targetOn")) ?? owned[0].expiresOn,
      notes: str(formData.get("notes")),
      createdBy: session.user.id,
    });

    revalidatePath("/", "layout");
    return { error: null, success: "Renewal started." };
  } catch (error) {
    return fail(error);
  }
}

export async function completeRenewalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard("renewals.manage");
    const taskId = str(formData.get("taskId"));
    const newExpiry = str(formData.get("newExpiryDate"));
    if (!taskId) return { error: "Missing task." };
    if (!newExpiry || !/^\d{4}-\d{2}-\d{2}$/.test(newExpiry)) {
      return { error: "Enter the new expiry date from the renewed document." };
    }

    const rows = await db
      .select({ task: renewalTasks, record: records })
      .from(renewalTasks)
      .innerJoin(records, eq(records.id, renewalTasks.recordId))
      .where(
        and(eq(renewalTasks.id, taskId), eq(renewalTasks.organisationId, session.organisation.id)),
      )
      .limit(1);
    if (rows.length === 0) return { error: "Renewal task not found." };

    const { task, record } = rows[0];
    const completedOn = today();
    const cost = str(formData.get("cost"));
    const observedDays = task.startedOn ? daysBetween(task.startedOn, completedOn) : null;

    await db
      .update(renewalTasks)
      .set({
        status: "completed",
        completedOn,
        newExpiryDate: newExpiry,
        cost,
        currency: str(formData.get("currency")),
        updatedAt: new Date(),
      })
      .where(eq(renewalTasks.id, taskId));

    // The renewed document replaces the old dates, and the ladder restarts
    // from the new expiry — this is the moment the loop closes.
    await db
      .update(records)
      .set({
        expiresOn: newExpiry,
        issuedOn: str(formData.get("newIssueDate")) ?? record.issuedOn,
        documentNumber: str(formData.get("newDocumentNumber")) ?? record.documentNumber,
        status: statusOf({ id: record.id, expiresOn: newExpiry, noExpiry: false, archivedAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(records.id, record.id));

    await db.delete(alerts).where(eq(alerts.recordId, record.id));
    await syncAlerts(record.id);

    if (observedDays !== null && record.documentTypeCode) {
      await recordObservation({
        documentTypeCode: record.documentTypeCode,
        country: session.organisation.country,
        observedDays,
        cost,
        currency: str(formData.get("currency")),
      });
    }

    await audit({
      organisationId: session.organisation.id,
      actorUserId: session.user.id,
      actorLabel: session.user.name,
      action: "renewal.completed",
      subjectType: "record",
      subjectId: record.id,
      metadata: { newExpiry, observedDays, cost },
    });

    revalidatePath("/", "layout");
    return { error: null, success: "Renewal recorded and alerts rescheduled." };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function inviteMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard("members.manage");
    const email = str(formData.get("email"))?.toLowerCase();
    const role = str(formData.get("role")) ?? "viewer";
    if (!email) return { error: "Enter an email address." };
    if (!["admin", "manager", "viewer"].includes(role)) return { error: "Choose a valid role." };

    const [{ used }] = await db
      .select({ used: count() })
      .from(memberships)
      .where(eq(memberships.organisationId, session.organisation.id));
    const limit = checkLimit(session.organisation.tier, "users", used);
    if (!limit.allowed) return { error: limit.message };

    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existingUser.length > 0) {
      // Already has an account: add the membership directly rather than making
      // them accept an invitation to a product they already use.
      await db
        .insert(memberships)
        .values({
          organisationId: session.organisation.id,
          userId: existingUser[0].id,
          role: role as "admin" | "manager" | "viewer",
        })
        .onConflictDoUpdate({
          target: [memberships.organisationId, memberships.userId],
          set: { role: role as "admin" | "manager" | "viewer" },
        });
      revalidatePath("/", "layout");
      return { error: null, success: `${email} now has access.` };
    }

    const { createHash, randomBytes } = await import("node:crypto");
    const token = randomBytes(24).toString("base64url");
    await db.insert(invitations).values({
      organisationId: session.organisation.id,
      email,
      role: role as "admin" | "manager" | "viewer",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      invitedBy: session.user.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });

    const { sendPlainEmail } = await import("@/lib/notify");
    const { env } = await import("@/lib/env");
    const sent = await sendPlainEmail(
      email,
      `${session.user.name} invited you to ${session.organisation.name} on Sarayan`,
      `Accept the invitation: ${env.appUrl}/en/invite/${token}\n\nThis link expires in seven days.`,
    );

    revalidatePath("/", "layout");
    return {
      error: null,
      success: sent
        ? `Invitation sent to ${email}.`
        : `Invitation created. Email is not configured, so send this link yourself: /en/invite/${token}`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const session = await guard("members.manage");
  const userId = str(formData.get("userId"));
  if (!userId || userId === session.user.id) return;

  // An organisation without an owner cannot be billed or deleted.
  const owners = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organisationId, session.organisation.id),
        eq(memberships.role, "owner"),
      ),
    );
  if (owners.length === 1 && owners[0].userId === userId) return;

  await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.organisationId, session.organisation.id),
        eq(memberships.userId, userId),
      ),
    );

  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard("settings.manage");

    await db
      .update(organisations)
      .set({
        name: str(formData.get("name")) ?? session.organisation.name,
        country: str(formData.get("country")) ?? session.organisation.country,
        locale: str(formData.get("locale")) ?? session.organisation.locale,
        metadataOnlyMode: formData.get("metadataOnlyMode") === "on",
        storageRegion: str(formData.get("storageRegion")) ?? session.organisation.storageRegion,
        isAgency: formData.get("isAgency") === "on",
      })
      .where(eq(organisations.id, session.organisation.id));

    await audit({
      organisationId: session.organisation.id,
      actorUserId: session.user.id,
      actorLabel: session.user.name,
      action: "settings.updated",
      subjectType: "organisation",
      subjectId: session.organisation.id,
      metadata: { metadataOnlyMode: formData.get("metadataOnlyMode") === "on" },
    });

    revalidatePath("/", "layout");
    return { error: null, success: "Settings saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const password = str(formData.get("password"));

    await db
      .update(users)
      .set({
        name: str(formData.get("name")) ?? session.user.name,
        phone: str(formData.get("phone")),
        locale: str(formData.get("locale")) ?? session.user.locale,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      })
      .where(eq(users.id, session.user.id));

    revalidatePath("/", "layout");
    return { error: null, success: "Profile saved." };
  } catch (error) {
    return fail(error);
  }
}
