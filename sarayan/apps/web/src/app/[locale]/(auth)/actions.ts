"use server";

import { addDays, today } from "@sarayan/core-watch";
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { entities, memberships, organisations, users, type PlanTier } from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  clientIp,
  createSession,
  destroySession,
  hashPassword,
  rateLimit,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n";
import { createWrappedDataKey } from "@/lib/storage";
import { slugify } from "@/lib/utils";

export interface AuthState {
  error: string | null;
  field?: string;
}

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(120),
  email: z.email("Enter a valid work email.").max(255),
  password: z.string().min(1, "Enter a password."),
  organisation: z.string().trim().min(2, "Enter your company name.").max(160),
  country: z.enum(["AE", "SA", "QA", "KW"]).default("AE"),
  locale: z.string().default("en"),
  plan: z.string().optional(),
});

export async function signUpAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    organisation: formData.get("organisation"),
    country: formData.get("country") ?? "AE",
    locale: formData.get("locale") ?? "en",
    plan: formData.get("plan") ?? undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.message ?? "Check the form and try again.", field: String(issue?.path[0] ?? "") };
  }

  const input = parsed.data;
  const locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;

  const ip = clientIp(await headers()) ?? "unknown";
  if (!rateLimit(`signup:${ip}`, 5, 60 * 60_000)) {
    return { error: "Too many attempts. Wait an hour and try again." };
  }

  const strengthError = validatePasswordStrength(input.password);
  if (strengthError) return { error: strengthError, field: "password" };

  const email = input.email.toLowerCase();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existing.length > 0) return { error: "An account already exists for that email.", field: "email" };

  const requestedPlan = input.plan;
  const tier: PlanTier =
    requestedPlan === "starter" || requestedPlan === "business" ? "trial" : "trial";

  // Signup creates four rows that must exist together: without the entity, a
  // new account cannot add a record, which is the whole first-run experience.
  const organisationId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email.trim(),
        passwordHash: await hashPassword(input.password),
        name: input.name,
        locale,
      })
      .returning({ id: users.id });

    const [organisation] = await tx
      .insert(organisations)
      .values({
        name: input.organisation,
        slug: `${slugify(input.organisation)}-${Math.random().toString(36).slice(2, 7)}`,
        country: input.country,
        locale,
        tier,
        billingStatus: "trialing",
        trialEndsAt: new Date(`${addDays(today(), 14)}T00:00:00.000Z`),
        wrappedDataKey: createWrappedDataKey(),
      })
      .returning({ id: organisations.id });

    await tx.insert(memberships).values({
      organisationId: organisation.id,
      userId: user.id,
      role: "owner",
    });

    await tx.insert(entities).values({
      organisationId: organisation.id,
      name: input.organisation,
      country: input.country,
      contactName: input.name,
      contactEmail: input.email.trim(),
    });

    await createSession(user.id);

    await audit({
      organisationId: organisation.id,
      actorUserId: user.id,
      actorLabel: input.name,
      action: "organisation.created",
      subjectType: "organisation",
      subjectId: organisation.id,
      metadata: { country: input.country, plan: requestedPlan ?? null },
    });

    return organisation.id;
  });

  void organisationId;
  redirect(`/${locale}/app/onboarding`);
}

const signInSchema = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
  locale: z.string().default("en"),
});

export async function signInAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale") ?? "en",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { email, password } = parsed.data;
  const locale = isLocale(parsed.data.locale) ? parsed.data.locale : DEFAULT_LOCALE;

  const ip = clientIp(await headers()) ?? "unknown";
  if (!rateLimit(`signin:${ip}`, 10) || !rateLimit(`signin:${email.toLowerCase()}`, 10)) {
    return { error: "Too many attempts. Wait fifteen minutes and try again." };
  }

  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  const user = rows[0];

  // Always run the hash comparison, even with no user, so response timing does
  // not disclose which emails have accounts.
  const valid = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !valid) {
    return { error: "That email and password combination is not right." };
  }

  await createSession(user.id);
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));

  redirect(`/${isLocale(user.locale) ? user.locale : locale}/app`);
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? DEFAULT_LOCALE);
  await destroySession();
  redirect(`/${isLocale(locale) ? locale : DEFAULT_LOCALE}`);
}
