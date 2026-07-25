"use client";

import { useActionState, useState } from "react";
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
import { translator, type Locale } from "@/lib/i18n";
import { createHolderAction, type ActionState } from "../actions";

const initial: ActionState = { error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

/** The form adapts to the kind: a vehicle needs a plate, a person a nationality. */
export function HolderForm({
  locale,
  entities,
}: {
  locale: Locale;
  entities: Array<{ id: string; name: string }>;
}) {
  const t = translator(locale);
  const [state, action] = useActionState(createHolderAction, initial);
  const [kind, setKind] = useState("person");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{locale === "ar" ? "إضافة حامل" : "Add a holder"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          <Field label={locale === "ar" ? "النوع" : "Type"} htmlFor="kind" required>
            <Select
              id="kind"
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="person">{locale === "ar" ? "شخص" : "Person"}</option>
              <option value="vehicle">{locale === "ar" ? "مركبة" : "Vehicle"}</option>
              <option value="asset">{locale === "ar" ? "أصل أو مقر" : "Asset or premises"}</option>
              <option value="entity">{locale === "ar" ? "المنشأة نفسها" : "The entity itself"}</option>
            </Select>
          </Field>

          <Field label={locale === "ar" ? "الاسم" : "Name"} htmlFor="name" required>
            <Input id="name" name="name" required />
          </Field>

          <Field label={t("entities.title")} htmlFor="entityId" required>
            <Select id="entityId" name="entityId" required>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>

          {kind === "person" ? (
            <>
              <Field label={locale === "ar" ? "الجنسية" : "Nationality"} htmlFor="nationality">
                <Input id="nationality" name="nationality" />
              </Field>
              <Field label={locale === "ar" ? "القسم" : "Department"} htmlFor="department">
                <Input id="department" name="department" />
              </Field>
              <Field
                label={locale === "ar" ? "البريد الإلكتروني" : "Email"}
                htmlFor="email"
                hint={
                  locale === "ar"
                    ? "لإرسال التنبيهات مباشرة إليه"
                    : "So alerts can reach them directly"
                }
              >
                <Input id="email" name="email" type="email" dir="ltr" />
              </Field>
              <Field label={locale === "ar" ? "الجوال" : "Mobile"} htmlFor="phone">
                <Input id="phone" name="phone" dir="ltr" placeholder="+971…" />
              </Field>
            </>
          ) : (
            <Field
              label={
                kind === "vehicle"
                  ? locale === "ar"
                    ? "رقم اللوحة"
                    : "Plate number"
                  : locale === "ar"
                    ? "المعرّف أو الموقع"
                    : "Identifier or location"
              }
              htmlFor="identifier"
            >
              <Input id="identifier" name="identifier" dir="ltr" />
            </Field>
          )}

          <Field
            label={locale === "ar" ? "المرجع الداخلي" : "Internal reference"}
            htmlFor="reference"
            hint={locale === "ar" ? "رقم الموظف مثلاً" : "Employee number, for example"}
          >
            <Input id="reference" name="reference" dir="ltr" />
          </Field>

          <Submit label={t("common.save")} />
        </form>
      </CardContent>
    </Card>
  );
}
