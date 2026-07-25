"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { COUNTRIES } from "@/content/taxonomy";
import { translator, type Locale } from "@/lib/i18n";
import { signInAction, signUpAction, type AuthState } from "./actions";

const initial: AuthState = { error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

export function SignInForm({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, action] = useActionState(signInAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Field label={t("auth.email")} htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </Field>

      <Field label={t("auth.password")} htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
        />
      </Field>

      <Submit label={t("auth.submitSignIn")} />

      <p className="text-center text-sm text-ink-500 dark:text-ink-400">
        {t("auth.noAccount")}{" "}
        <Link href={`/${locale}/sign-up`} className="text-brand-700 hover:underline dark:text-brand-400">
          {t("nav.signUp")}
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm({ locale, plan }: { locale: Locale; plan?: string }) {
  const t = translator(locale);
  const [state, action] = useActionState(signUpAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {plan ? <input type="hidden" name="plan" value={plan} /> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Field label={t("auth.name")} htmlFor="name" required>
        <Input id="name" name="name" autoComplete="name" required />
      </Field>

      <Field label={t("auth.email")} htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required dir="ltr" />
      </Field>

      <Field label={t("auth.organisation")} htmlFor="organisation" required>
        <Input id="organisation" name="organisation" autoComplete="organization" required />
      </Field>

      <Field label={t("auth.country")} htmlFor="country" required>
        <Select id="country" name="country" defaultValue="AE" required>
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {locale === "ar" ? country.nameAr : country.nameEn}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("auth.password")} htmlFor="password" hint={t("auth.passwordHint")} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          dir="ltr"
        />
      </Field>

      <Submit label={t("auth.submitSignUp")} />

      <p className="text-center text-sm text-ink-500 dark:text-ink-400">
        {t("auth.hasAccount")}{" "}
        <Link href={`/${locale}/sign-in`} className="text-brand-700 hover:underline dark:text-brand-400">
          {t("nav.signIn")}
        </Link>
      </p>
    </form>
  );
}
