"use client";

import { useTransition } from "react";
import { Select } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { switchOrganisationAction } from "./actions";

/** Agencies live in more than one organisation; everyone else sees one option. */
export function OrgSwitcher({
  locale,
  current,
  organisations,
}: {
  locale: Locale;
  current: string;
  organisations: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();

  if (organisations.length <= 1) {
    return (
      <p className="truncate px-1 text-sm font-medium text-ink-900 dark:text-ink-100">
        {organisations[0]?.name ?? ""}
      </p>
    );
  }

  return (
    <Select
      aria-label={locale === "ar" ? "تبديل المؤسسة" : "Switch organisation"}
      value={current}
      disabled={pending}
      onChange={(event) => {
        const organisationId = event.target.value;
        startTransition(() => {
          void switchOrganisationAction(organisationId);
        });
      }}
      className="h-9 text-sm"
    >
      {organisations.map((organisation) => (
        <option key={organisation.id} value={organisation.id}>
          {organisation.name}
        </option>
      ))}
    </Select>
  );
}
