"use client";

import { addMonths } from "@sarayan/core-watch";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, CardContent, Field, Input, Label, Select, Textarea } from "@/components/ui";
import { DOCUMENT_TYPES, documentType } from "@/content/taxonomy";
import { translator, type Locale } from "@/lib/i18n";
import { createRecordAction, updateRecordAction, type ActionState } from "../actions";

export interface RecordFormOptions {
  entities: Array<{ id: string; name: string; country: string }>;
  holders: Array<{ id: string; name: string; entityId: string; kind: string }>;
  members: Array<{ id: string; name: string }>;
}

export interface RecordFormValues {
  id?: string;
  entityId?: string;
  holderId?: string;
  documentTypeCode?: string | null;
  customTypeName?: string | null;
  documentNumber?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  noExpiry?: boolean;
  issuingAuthority?: string | null;
  ownerUserId?: string | null;
  notes?: string | null;
}

const initial: ActionState = { error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

/**
 * The record form.
 *
 * Two behaviours earn their complexity: picking a document type pre-fills the
 * issuing authority and offers a computed expiry date from the taxonomy's
 * typical validity, and the entity selection filters holders — because
 * assigning a Dubai visa to a Riyadh entity's employee is a data error that is
 * very hard to notice afterwards.
 */
export function RecordForm({
  locale,
  options,
  values = {},
  mode,
}: {
  locale: Locale;
  options: RecordFormOptions;
  values?: RecordFormValues;
  mode: "create" | "edit";
}) {
  const t = translator(locale);
  const [state, action] = useActionState(
    mode === "create" ? createRecordAction : updateRecordAction,
    initial,
  );

  const [entityId, setEntityId] = useState(values.entityId ?? options.entities[0]?.id ?? "");
  const [typeCode, setTypeCode] = useState(values.documentTypeCode ?? "");
  const [issuedOn, setIssuedOn] = useState(values.issuedOn ?? "");
  const [expiresOn, setExpiresOn] = useState(values.expiresOn ?? "");
  const [noExpiry, setNoExpiry] = useState(values.noExpiry ?? false);

  const entityCountry = options.entities.find((entity) => entity.id === entityId)?.country;
  const availableTypes = useMemo(
    () => DOCUMENT_TYPES.filter((type) => !entityCountry || type.country === entityCountry),
    [entityCountry],
  );
  const availableHolders = options.holders.filter((holder) => holder.entityId === entityId);
  const selectedType = typeCode ? documentType(typeCode) : undefined;

  /** Offer, never impose: the user can overwrite the suggestion. */
  function suggestExpiry(nextIssued: string, code: string) {
    const type = code ? documentType(code) : undefined;
    if (!nextIssued || !type?.typicalValidityMonths) return;
    if (expiresOn) return;
    setExpiresOn(addMonths(nextIssued, type.typicalValidityMonths));
  }

  return (
    <form action={action} className="space-y-5">
      {values.id ? <input type="hidden" name="recordId" value={values.id} /> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Card>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label={t("records.entity")} htmlFor="entityId" required>
            <Select
              id="entityId"
              name="entityId"
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
              required
            >
              {options.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t("records.holder")}
            htmlFor="holderId"
            required
            hint={
              availableHolders.length === 0
                ? locale === "ar"
                  ? "لا يوجد حاملون لهذه المنشأة بعد."
                  : "No holders for this entity yet."
                : undefined
            }
          >
            <Select id="holderId" name="holderId" defaultValue={values.holderId ?? ""} required>
              <option value="" disabled>
                {locale === "ar" ? "اختر…" : "Choose…"}
              </option>
              {availableHolders.map((holder) => (
                <option key={holder.id} value={holder.id}>
                  {holder.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("records.documentType")} htmlFor="documentTypeCode" required>
            <Select
              id="documentTypeCode"
              name="documentTypeCode"
              value={typeCode}
              onChange={(event) => {
                setTypeCode(event.target.value);
                suggestExpiry(issuedOn, event.target.value);
              }}
            >
              <option value="">{locale === "ar" ? "نوع مخصص…" : "Custom type…"}</option>
              {availableTypes.map((type) => (
                <option key={type.code} value={type.code}>
                  {locale === "ar" ? type.nameAr : type.nameEn}
                </option>
              ))}
            </Select>
          </Field>

          {!typeCode ? (
            <Field label={locale === "ar" ? "اسم النوع المخصص" : "Custom type name"} htmlFor="customTypeName">
              <Input
                id="customTypeName"
                name="customTypeName"
                defaultValue={values.customTypeName ?? ""}
              />
            </Field>
          ) : (
            <Field label={t("records.authority")} htmlFor="issuingAuthority">
              <Input
                id="issuingAuthority"
                name="issuingAuthority"
                key={typeCode}
                defaultValue={values.issuingAuthority ?? selectedType?.issuingAuthority ?? ""}
              />
            </Field>
          )}

          <Field label={t("records.number")} htmlFor="documentNumber">
            <Input
              id="documentNumber"
              name="documentNumber"
              defaultValue={values.documentNumber ?? ""}
              dir="ltr"
              className="font-mono"
            />
          </Field>

          <Field label={t("records.owner")} htmlFor="ownerUserId">
            <Select id="ownerUserId" name="ownerUserId" defaultValue={values.ownerUserId ?? ""}>
              <option value="">{locale === "ar" ? "غير محدّد" : "Unassigned"}</option>
              {options.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("records.issued")} htmlFor="issuedOn">
            <Input
              id="issuedOn"
              name="issuedOn"
              type="date"
              value={issuedOn}
              onChange={(event) => {
                setIssuedOn(event.target.value);
                suggestExpiry(event.target.value, typeCode);
              }}
            />
          </Field>

          <Field
            label={t("records.expires")}
            htmlFor="expiresOn"
            required={!noExpiry}
            hint={
              selectedType?.typicalValidityMonths
                ? locale === "ar"
                  ? `عادةً ${selectedType.typicalValidityMonths} شهراً`
                  : `Typically ${selectedType.typicalValidityMonths} months`
                : undefined
            }
          >
            <Input
              id="expiresOn"
              name="expiresOn"
              type="date"
              value={expiresOn}
              onChange={(event) => setExpiresOn(event.target.value)}
              disabled={noExpiry}
              required={!noExpiry}
            />
          </Field>

          <div className="sm:col-span-2">
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="noExpiry"
                checked={noExpiry}
                onChange={(event) => setNoExpiry(event.target.checked)}
                className="size-4 rounded border-ink-300 accent-brand-600"
              />
              {t("records.noExpiry")}
            </Label>
          </div>

          <Field label={t("records.notes")} htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" name="notes" defaultValue={values.notes ?? ""} />
          </Field>
        </CardContent>
      </Card>

      {selectedType && selectedType.requires.length > 0 ? (
        <Alert tone="info" title={locale === "ar" ? "اعتماديات" : "Dependencies"}>
          {locale === "ar"
            ? "لا يمكن تجديد هذه الوثيقة ما لم تكن الوثائق التالية سارية: "
            : "This document cannot be renewed unless these are valid: "}
          {selectedType.requires
            .map((code) => {
              const dependency = documentType(code);
              return dependency ? (locale === "ar" ? dependency.nameAr : dependency.nameEn) : code;
            })
            .join(", ")}
        </Alert>
      ) : null}

      <div className="flex items-center gap-3">
        <Submit label={t("common.save")} />
        <Link
          href={`/${locale}/app/records`}
          className="text-sm text-ink-500 hover:text-ink-800 dark:text-ink-400"
        >
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
