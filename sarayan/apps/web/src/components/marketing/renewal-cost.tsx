"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, CardContent, Field, Input, Select, Table, Td, Th } from "@/components/ui";
import { COUNTRIES, DOCUMENT_TYPES } from "@/content/taxonomy";
import type { Locale } from "@/lib/i18n";

/** Annual renewal budget across staff, fleet and premises. */
export function RenewalCostCalculator({ locale }: { locale: Locale }) {
  const [country, setCountry] = useState<"AE" | "SA">("AE");
  const [staff, setStaff] = useState(40);
  const [vehicles, setVehicles] = useState(6);
  const [premises, setPremises] = useState(1);

  const lines = useMemo(() => {
    const types = DOCUMENT_TYPES.filter(
      (type) => type.country === country && type.typicalRenewalCost !== null,
    );

    return types
      .map((type) => {
        const count =
          type.holderKind === "person"
            ? staff
            : type.holderKind === "vehicle"
              ? vehicles
              : type.holderKind === "asset"
                ? premises
                : 1;

        // A five-year driving licence costs a fifth of its fee each year.
        const perYear = type.typicalValidityMonths ? 12 / type.typicalValidityMonths : 1;
        const annual = (type.typicalRenewalCost?.amount ?? 0) * count * perYear;

        return {
          code: type.code,
          name: locale === "ar" ? type.nameAr : type.nameEn,
          currency: type.typicalRenewalCost!.currency,
          count,
          unit: type.typicalRenewalCost!.amount,
          annual: Math.round(annual),
        };
      })
      .filter((line) => line.count > 0 && line.annual > 0)
      .sort((a, b) => b.annual - a.annual);
  }, [country, staff, vehicles, premises, locale]);

  const total = lines.reduce((sum, line) => sum + line.annual, 0);
  const currency = lines[0]?.currency ?? (country === "AE" ? "AED" : "SAR");

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-4">
          <Field label={locale === "ar" ? "الدولة" : "Country"} htmlFor="country">
            <Select
              id="country"
              value={country}
              onChange={(event) => setCountry(event.target.value as "AE" | "SA")}
            >
              {COUNTRIES.filter((entry) => entry.code === "AE" || entry.code === "SA").map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {locale === "ar" ? entry.nameAr : entry.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={locale === "ar" ? "عدد الموظفين" : "Staff"} htmlFor="staff">
            <Input
              id="staff"
              type="number"
              min={0}
              max={2000}
              value={staff}
              onChange={(event) => setStaff(Number(event.target.value) || 0)}
            />
          </Field>
          <Field label={locale === "ar" ? "عدد المركبات" : "Vehicles"} htmlFor="vehicles">
            <Input
              id="vehicles"
              type="number"
              min={0}
              max={1000}
              value={vehicles}
              onChange={(event) => setVehicles(Number(event.target.value) || 0)}
            />
          </Field>
          <Field label={locale === "ar" ? "عدد المقار" : "Premises"} htmlFor="premises">
            <Input
              id="premises"
              type="number"
              min={0}
              max={100}
              value={premises}
              onChange={(event) => setPremises(Number(event.target.value) || 0)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 p-6 dark:border-ink-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {locale === "ar" ? "التكلفة السنوية التقديرية" : "Estimated annual renewal cost"}
            </p>
            <p className="text-3xl font-semibold tabular-nums text-ink-950 dark:text-ink-50">
              {currency} {total.toLocaleString()}
            </p>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>{locale === "ar" ? "الوثيقة" : "Document"}</Th>
                <Th className="text-end">{locale === "ar" ? "العدد" : "Count"}</Th>
                <Th className="text-end">{locale === "ar" ? "لكل تجديد" : "Per renewal"}</Th>
                <Th className="text-end">{locale === "ar" ? "سنوياً" : "Annual"}</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.code}>
                  <Td className="font-medium text-ink-800 dark:text-ink-200">{line.name}</Td>
                  <Td className="text-end tabular-nums">{line.count}</Td>
                  <Td className="text-end tabular-nums text-ink-500">
                    {line.currency} {line.unit.toLocaleString()}
                  </Td>
                  <Td className="text-end font-semibold tabular-nums">
                    {line.currency} {line.annual.toLocaleString()}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <div className="rounded-card bg-ink-950 p-6 dark:bg-ink-900">
        <p className="text-sm text-ink-300">
          {locale === "ar"
            ? "هذه التكلفة تدفعها على أي حال. الغرامات هي ما يمكن تجنّبه."
            : "You are paying that either way. The fines are the part that is avoidable."}
        </p>
        <Link href={`/${locale}/sign-up`} className="mt-4 inline-block">
          <Button>{locale === "ar" ? "ابدأ سجلك" : "Build your register"}</Button>
        </Link>
      </div>
    </div>
  );
}
