"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  Select,
} from "@/components/ui";
import { COUNTRIES } from "@/content/taxonomy";
import { translator, type Locale } from "@/lib/i18n";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/rbac";
import {
  inviteMemberAction,
  updateProfileAction,
  updateSettingsAction,
  type ActionState,
} from "../actions";

const initial: ActionState = { error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

export function OrganisationForm({
  locale,
  organisation,
}: {
  locale: Locale;
  organisation: {
    name: string;
    country: string;
    locale: string;
    metadataOnlyMode: boolean;
    storageRegion: string;
    isAgency: boolean;
  };
}) {
  const t = translator(locale);
  const [state, action] = useActionState(updateSettingsAction, initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.general")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          <Field label={t("auth.organisation")} htmlFor="org-name" required>
            <Input id="org-name" name="name" defaultValue={organisation.name} required />
          </Field>

          <Field label={t("auth.country")} htmlFor="org-country">
            <Select id="org-country" name="country" defaultValue={organisation.country}>
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {locale === "ar" ? country.nameAr : country.nameEn}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={locale === "ar" ? "لغة المؤسسة" : "Organisation language"} htmlFor="org-locale">
            <Select id="org-locale" name="locale" defaultValue={organisation.locale}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </Field>

          <Field
            label={t("settings.dataResidency")}
            htmlFor="storageRegion"
            hint={
              locale === "ar"
                ? "المنطقة التي تُخزَّن فيها ملفاتك."
                : "The region your document files are stored in."
            }
          >
            <Select
              id="storageRegion"
              name="storageRegion"
              defaultValue={organisation.storageRegion}
            >
              <option value="me-central-1">Middle East (me-central-1)</option>
              <option value="me-south-1">Middle East (me-south-1)</option>
              <option value="eu-west-2">Europe (eu-west-2)</option>
            </Select>
          </Field>

          <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <Label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                name="metadataOnlyMode"
                defaultChecked={organisation.metadataOnlyMode}
                className="mt-0.5 size-4 rounded border-ink-300 accent-brand-600"
              />
              <span>
                {t("settings.metadataOnly")}
                <span className="mt-1 block text-xs font-normal text-ink-500 dark:text-ink-400">
                  {t("settings.metadataOnlyBody")}
                </span>
              </span>
            </Label>
          </div>

          <Label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="isAgency"
              defaultChecked={organisation.isAgency}
              className="size-4 rounded border-ink-300 accent-brand-600"
            />
            {locale === "ar"
              ? "هذه المؤسسة مكتب خدمات يدير عملاء"
              : "This organisation is an agency managing client entities"}
          </Label>

          <Submit label={t("common.save")} />
        </form>
      </CardContent>
    </Card>
  );
}

export function ProfileForm({
  locale,
  user,
}: {
  locale: Locale;
  user: { name: string; phone: string | null; locale: string; email: string };
}) {
  const t = translator(locale);
  const [state, action] = useActionState(updateProfileAction, initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{locale === "ar" ? "حسابك" : "Your account"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          <Field label={t("auth.name")} htmlFor="profile-name" required>
            <Input id="profile-name" name="name" defaultValue={user.name} required />
          </Field>

          <Field label={t("auth.email")} htmlFor="profile-email">
            <Input id="profile-email" defaultValue={user.email} disabled dir="ltr" />
          </Field>

          <Field
            label={locale === "ar" ? "الجوال" : "Mobile"}
            htmlFor="profile-phone"
            hint={
              locale === "ar"
                ? "لتنبيهات واتساب. بصيغة دولية."
                : "For WhatsApp alerts. International format."
            }
          >
            <Input
              id="profile-phone"
              name="phone"
              defaultValue={user.phone ?? ""}
              dir="ltr"
              placeholder="+971…"
            />
          </Field>

          <Field label={locale === "ar" ? "لغتك" : "Your language"} htmlFor="profile-locale">
            <Select id="profile-locale" name="locale" defaultValue={user.locale}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </Field>

          <Field
            label={locale === "ar" ? "كلمة مرور جديدة" : "New password"}
            htmlFor="profile-password"
            hint={t("auth.passwordHint")}
          >
            <Input
              id="profile-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              dir="ltr"
            />
          </Field>

          <Submit label={t("common.save")} />
        </form>
      </CardContent>
    </Card>
  );
}

export function InviteForm({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, action] = useActionState(inviteMemberAction, initial);

  return (
    <form action={action} className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("auth.email")} htmlFor="invite-email" className="min-w-64 flex-1">
          <Input id="invite-email" name="email" type="email" required dir="ltr" />
        </Field>
        <Field label={t("settings.role")} htmlFor="invite-role" className="min-w-40">
          <Select id="invite-role" name="role" defaultValue="viewer">
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {locale === "ar" ? ROLE_LABELS[role].ar : ROLE_LABELS[role].en}
              </option>
            ))}
          </Select>
        </Field>
        <Submit label={t("settings.invite")} />
      </div>
    </form>
  );
}
