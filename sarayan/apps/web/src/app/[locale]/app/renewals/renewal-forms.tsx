"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { translator, type Locale } from "@/lib/i18n";
import { completeRenewalAction, startRenewalAction, type ActionState } from "../actions";

const initial: ActionState = { error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

export function StartRenewalForm({
  locale,
  recordId,
  defaultTarget,
  members,
  autoOpen,
}: {
  locale: Locale;
  recordId: string;
  defaultTarget: string | null;
  members: Array<{ id: string; name: string }>;
  autoOpen?: boolean;
}) {
  const t = translator(locale);
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [state, action] = useActionState(startRenewalAction, initial);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("renewals.start")}
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2 text-start">
      <input type="hidden" name="recordId" value={recordId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Select name="assigneeUserId" className="h-8 text-xs" defaultValue="">
        <option value="">{t("renewals.assignee")}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
      <Input
        name="targetOn"
        type="date"
        defaultValue={defaultTarget ?? ""}
        className="h-8 text-xs"
        aria-label={t("renewals.target")}
      />
      <div className="flex gap-2">
        <Submit label={t("renewals.start")} />
        <button
          type="button"
          className="text-xs text-ink-500"
          onClick={() => setOpen(false)}
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * Completing a renewal.
 *
 * The new expiry date is required, not optional — a renewal recorded without
 * one leaves the register saying the document is still expiring on the old
 * date, which is worse than no record at all.
 */
export function CompleteRenewalForm({
  locale,
  taskId,
  currency,
}: {
  locale: Locale;
  taskId: string;
  currency: string;
}) {
  const t = translator(locale);
  const [state, action] = useActionState(completeRenewalAction, initial);

  return (
    <form action={action} className="space-y-3 border-t border-ink-100 pt-3 dark:border-ink-800">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="currency" value={currency} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("renewals.newExpiry")} htmlFor={`expiry-${taskId}`} required>
          <Input id={`expiry-${taskId}`} name="newExpiryDate" type="date" required className="h-9" />
        </Field>
        <Field
          label={`${t("renewals.cost")} (${currency})`}
          htmlFor={`cost-${taskId}`}
          hint={
            locale === "ar"
              ? "يُحسّن التقديرات المستقبلية"
              : "Improves future estimates"
          }
        >
          <Input
            id={`cost-${taskId}`}
            name="cost"
            type="number"
            step="0.01"
            min="0"
            className="h-9"
            dir="ltr"
          />
        </Field>
        <Field label={locale === "ar" ? "رقم الوثيقة الجديد" : "New document number"} htmlFor={`number-${taskId}`}>
          <Input id={`number-${taskId}`} name="newDocumentNumber" className="h-9" dir="ltr" />
        </Field>
        <Field label={locale === "ar" ? "تاريخ الإصدار الجديد" : "New issue date"} htmlFor={`issued-${taskId}`}>
          <Input id={`issued-${taskId}`} name="newIssueDate" type="date" className="h-9" />
        </Field>
      </div>

      <Submit label={t("renewals.complete")} />
    </form>
  );
}
