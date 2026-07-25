"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Badge, Button, Input, Label } from "@/components/ui";
import { documentTypeName } from "@/content/taxonomy";
import type { Locale } from "@/lib/i18n";

/**
 * Upload and confirmation.
 *
 * The rule the brief sets — "always show the source image beside the extracted
 * value" — is the entire layout here: the document preview sits next to the
 * fields, and nothing the model produced is written to the record until a human
 * has looked at both and pressed confirm. Low-confidence fields are flagged;
 * the expiry date is flagged regardless of score, because a wrong expiry date is
 * the one error the product exists to prevent.
 */

interface ReviewField {
  key: string;
  label: string;
  value: string | null;
  confidence: number;
  verdict: "confirmed" | "review" | "rejected";
  reason: string | null;
  sourceText: string | null;
  kind: string;
  critical: boolean;
}

interface ReviewResponse {
  fileId: string;
  extractionId: string | null;
  documentTypeCode: string | null;
  classificationConfidence: number;
  alternatives: Array<{ documentTypeCode: string; confidence: number }>;
  fields: ReviewField[];
  blockingReasons: string[];
  warnings: string[];
  extractionAvailable: boolean;
}

export function UploadPanel({ locale, recordId }: { locale: Locale; recordId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setReview(null);

    // Local preview only — the file itself goes to the server encrypted.
    if (file.type.startsWith("image/")) setPreview(URL.createObjectURL(file));
    else setPreview(null);

    try {
      const body = new FormData();
      body.set("file", file);
      body.set("recordId", recordId);

      const response = await fetch("/api/extract", { method: "POST", body });
      const payload = (await response.json()) as ReviewResponse & { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Upload failed.");
        return;
      }

      setReview(payload);
      setValues(
        Object.fromEntries(payload.fields.map((field) => [field.key, field.value ?? ""])),
      );
    } catch {
      setError(locale === "ar" ? "تعذّر رفع الملف." : "The upload could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/extract/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordId,
          fileId: review.fileId,
          extractionId: review.extractionId,
          documentTypeCode: review.documentTypeCode,
          values,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Could not save.");
        return;
      }
      setReview(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="document-file">
          {locale === "ar" ? "ارفع الوثيقة" : "Upload the document"}
        </Label>
        <Input
          id="document-file"
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
          disabled={busy}
          className="mt-1.5 file:me-3 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-ink-800"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
          {locale === "ar"
            ? "PDF أو صورة، حتى ٢٠ ميجابايت. يُشفَّر قبل التخزين."
            : "PDF or image, up to 20 MB. Encrypted before storage."}
        </p>
      </div>

      {busy ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          {locale === "ar" ? "جارٍ القراءة…" : "Reading the document…"}
        </p>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {review ? (
        <div className="rounded-card border border-ink-200 dark:border-ink-800">
          {!review.extractionAvailable ? (
            <div className="border-b border-ink-100 p-4 dark:border-ink-800">
              <Alert tone="info">
                {locale === "ar"
                  ? "الاستخراج التلقائي غير مُفعّل. الملف مُخزَّن — أدخل الحقول يدوياً."
                  : "Automatic extraction is not configured. The file is stored — enter the fields yourself."}
              </Alert>
            </div>
          ) : null}

          {review.blockingReasons.length > 0 ? (
            <div className="border-b border-ink-100 p-4 dark:border-ink-800">
              <Alert tone="warning" title={locale === "ar" ? "تحقّق قبل الحفظ" : "Check before saving"}>
                <ul className="mt-1 space-y-0.5">
                  {review.blockingReasons.map((reason) => (
                    <li key={reason}>· {reason}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          ) : null}

          <div className="grid gap-0 md:grid-cols-2">
            {/* Source, always visible next to the values */}
            <div className="border-b border-ink-100 p-4 md:border-b-0 md:border-e dark:border-ink-800">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                {locale === "ar" ? "المصدر" : "Source document"}
              </p>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt={locale === "ar" ? "معاينة الوثيقة" : "Document preview"}
                  className="max-h-[420px] w-full rounded-lg border border-ink-200 object-contain dark:border-ink-700"
                />
              ) : (
                <p className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500 dark:border-ink-700">
                  {locale === "ar"
                    ? "معاينة PDF غير متاحة هنا — افتح الملف من قائمة المرفقات."
                    : "PDF preview is not shown here — open the file from the attachments list."}
                </p>
              )}
            </div>

            <div className="p-4">
              {review.documentTypeCode ? (
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                    {locale === "ar" ? "نوع الوثيقة" : "Document type"}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-sm font-medium text-ink-900 dark:text-ink-100">
                    {documentTypeName(review.documentTypeCode, locale)}
                    <ConfidenceBadge value={review.classificationConfidence} locale={locale} />
                  </p>
                  {review.alternatives.length > 0 ? (
                    <p className="mt-1 text-xs text-ink-500">
                      {locale === "ar" ? "بدائل:" : "Alternatives:"}{" "}
                      {review.alternatives
                        .map((alternative) => documentTypeName(alternative.documentTypeCode, locale))
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-3">
                {review.fields.map((field) => (
                  <div key={field.key}>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
                      <ConfidenceBadge
                        value={field.confidence}
                        locale={locale}
                        critical={field.critical}
                      />
                    </div>
                    <Input
                      id={`field-${field.key}`}
                      type={field.kind === "date" ? "date" : "text"}
                      value={values[field.key] ?? ""}
                      dir={field.kind === "text" || field.kind === "date" ? "ltr" : undefined}
                      onChange={(event) =>
                        setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
                      }
                      className={
                        field.verdict === "rejected"
                          ? "mt-1 border-danger-mid"
                          : field.verdict === "review"
                            ? "mt-1 border-amber-mid"
                            : "mt-1"
                      }
                    />
                    {field.sourceText ? (
                      <p className="mt-1 text-xs text-ink-400">
                        {locale === "ar" ? "قُرئ كـ" : "Read as"}: “{field.sourceText}”
                      </p>
                    ) : null}
                    {field.reason ? (
                      <p className="mt-1 text-xs text-danger-deep dark:text-danger-mid">{field.reason}</p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button type="button" onClick={() => void confirm()} disabled={busy}>
                  {locale === "ar" ? "تأكيد وحفظ" : "Confirm and save"}
                </Button>
                <button
                  type="button"
                  className="text-sm text-ink-500 hover:text-ink-800 dark:text-ink-400"
                  onClick={() => {
                    setReview(null);
                    setPreview(null);
                  }}
                >
                  {locale === "ar" ? "إلغاء" : "Discard"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConfidenceBadge({
  value,
  locale,
  critical,
}: {
  value: number;
  locale: Locale;
  critical?: boolean;
}) {
  if (value === 0) return null;
  const percent = Math.round(value * 100);
  const tone = critical ? "due_soon" : percent >= 85 ? "valid" : percent >= 55 ? "due_soon" : "expired";
  return (
    <Badge tone={tone} className="tabular-nums">
      {percent}%{critical ? (locale === "ar" ? " · تحقّق" : " · check") : ""}
    </Badge>
  );
}
