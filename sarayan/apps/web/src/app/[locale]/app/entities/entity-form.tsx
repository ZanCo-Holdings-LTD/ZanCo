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
  Select,
} from "@/components/ui";
import { COUNTRIES } from "@/content/taxonomy";
import { translator, type Locale } from "@/lib/i18n";
import { createEntityAction, type ActionState } from "../actions";

const initial: ActionState = { error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

export function EntityForm({
  locale,
  defaultCountry,
  isAgency,
}: {
  locale: Locale;
  defaultCountry: string;
  isAgency: boolean;
}) {
  const t = translator(locale);
  const [state, action] = useActionState(createEntityAction, initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("entities.add")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          <Field label={locale === "ar" ? "الاسم" : "Name"} htmlFor="name" required>
            <Input id="name" name="name" required />
          </Field>

          <Field label={locale === "ar" ? "الاسم القانوني" : "Legal name"} htmlFor="legalName">
            <Input id="legalName" name="legalName" />
          </Field>

          <Field label={t("auth.country")} htmlFor="country" required>
            <Select id="country" name="country" defaultValue={defaultCountry}>
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {locale === "ar" ? country.nameAr : country.nameEn}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={locale === "ar" ? "رقم السجل" : "Registration number"}
            htmlFor="registrationNumber"
          >
            <Input id="registrationNumber" name="registrationNumber" dir="ltr" />
          </Field>

          {isAgency ? (
            <Field
              label={t("entities.clientReference")}
              htmlFor="clientReference"
              hint={locale === "ar" ? "مرجعك الداخلي للعميل" : "Your internal client reference"}
            >
              <Input id="clientReference" name="clientReference" dir="ltr" />
            </Field>
          ) : null}

          <Field
            label={locale === "ar" ? "جهة الاتصال" : "Contact name"}
            htmlFor="contactName"
            hint={
              locale === "ar"
                ? "تصل إليه التنبيهات المصعّدة"
                : "Escalated alerts reach this person"
            }
          >
            <Input id="contactName" name="contactName" />
          </Field>

          <Field label={locale === "ar" ? "بريد جهة الاتصال" : "Contact email"} htmlFor="contactEmail">
            <Input id="contactEmail" name="contactEmail" type="email" dir="ltr" />
          </Field>

          <Field label={locale === "ar" ? "جوال جهة الاتصال" : "Contact phone"} htmlFor="contactPhone">
            <Input id="contactPhone" name="contactPhone" dir="ltr" placeholder="+971…" />
          </Field>

          <Submit label={t("common.save")} />
        </form>
      </CardContent>
    </Card>
  );
}
