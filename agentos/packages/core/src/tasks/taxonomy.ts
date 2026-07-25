/**
 * PRO task taxonomy.
 *
 * Like the seed rules, this is a first draft to be replaced by what comes out
 * of the M0 interviews. It exists now so the task board has something to filter
 * on and so fee categories line up with the work that generates them.
 *
 * Firms add their own types; these are the ones that appeared in every
 * spreadsheet template published by the free zones, which is the best proxy
 * available before the interviews.
 */
import type { RenewableDocType } from '../types.js';

export const TASK_CATEGORIES = [
  'licensing',
  'immigration',
  'labour',
  'banking',
  'compliance',
  'documents',
  'internal',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export interface TaskTypeDefinition {
  readonly key: string;
  readonly category: TaskCategory;
  readonly label: string;
  readonly labelAr: string;
  /** Typical government fee is charged for this task, so the board prompts for it. */
  readonly expectsGovernmentFee: boolean;
  /** The renewal document type this task usually discharges, if any. */
  readonly renews: RenewableDocType | null;
}

export const TASK_TYPES: readonly TaskTypeDefinition[] = [
  {
    key: 'licence_renewal',
    category: 'licensing',
    label: 'Trade licence renewal',
    labelAr: 'تجديد الرخصة التجارية',
    expectsGovernmentFee: true,
    renews: 'trade_licence',
  },
  {
    key: 'licence_amendment',
    category: 'licensing',
    label: 'Licence amendment',
    labelAr: 'تعديل الرخصة',
    expectsGovernmentFee: true,
    renews: null,
  },
  {
    key: 'company_incorporation',
    category: 'licensing',
    label: 'New company incorporation',
    labelAr: 'تأسيس شركة جديدة',
    expectsGovernmentFee: true,
    renews: null,
  },
  {
    key: 'licence_cancellation',
    category: 'licensing',
    label: 'Licence cancellation',
    labelAr: 'إلغاء الرخصة',
    expectsGovernmentFee: true,
    renews: null,
  },
  {
    key: 'establishment_card_renewal',
    category: 'immigration',
    label: 'Establishment card renewal',
    labelAr: 'تجديد بطاقة المنشأة',
    expectsGovernmentFee: true,
    renews: 'establishment_card',
  },
  {
    key: 'immigration_card_renewal',
    category: 'immigration',
    label: 'Immigration card renewal',
    labelAr: 'تجديد بطاقة الهجرة',
    expectsGovernmentFee: true,
    renews: 'immigration_card',
  },
  {
    key: 'visa_quota_application',
    category: 'immigration',
    label: 'Visa quota application',
    labelAr: 'طلب حصة التأشيرات',
    expectsGovernmentFee: true,
    renews: 'visa_quota',
  },
  {
    key: 'residence_visa_new',
    category: 'immigration',
    label: 'New residence visa',
    labelAr: 'تأشيرة إقامة جديدة',
    expectsGovernmentFee: true,
    renews: 'residence_visa',
  },
  {
    key: 'residence_visa_renewal',
    category: 'immigration',
    label: 'Residence visa renewal',
    labelAr: 'تجديد تأشيرة الإقامة',
    expectsGovernmentFee: true,
    renews: 'residence_visa',
  },
  {
    key: 'visa_cancellation',
    category: 'immigration',
    label: 'Visa cancellation',
    labelAr: 'إلغاء التأشيرة',
    expectsGovernmentFee: true,
    renews: null,
  },
  {
    key: 'iqama_renewal',
    category: 'immigration',
    label: 'Iqama renewal',
    labelAr: 'تجديد الإقامة',
    expectsGovernmentFee: true,
    renews: 'iqama',
  },
  {
    key: 'emirates_id_renewal',
    category: 'immigration',
    label: 'Emirates ID renewal',
    labelAr: 'تجديد الهوية الإماراتية',
    expectsGovernmentFee: true,
    renews: 'emirates_id',
  },
  {
    key: 'medical_fitness_test',
    category: 'immigration',
    label: 'Medical fitness test',
    labelAr: 'الفحص الطبي',
    expectsGovernmentFee: true,
    renews: null,
  },
  {
    key: 'labour_contract',
    category: 'labour',
    label: 'Labour contract filing',
    labelAr: 'تسجيل عقد العمل',
    expectsGovernmentFee: true,
    renews: null,
  },
  {
    key: 'work_permit',
    category: 'labour',
    label: 'Work permit',
    labelAr: 'تصريح العمل',
    expectsGovernmentFee: true,
    renews: 'work_permit',
  },
  {
    key: 'medical_insurance_renewal',
    category: 'labour',
    label: 'Medical insurance renewal',
    labelAr: 'تجديد التأمين الصحي',
    expectsGovernmentFee: false,
    renews: 'medical_insurance',
  },
  {
    key: 'bank_account_opening',
    category: 'banking',
    label: 'Bank account opening',
    labelAr: 'فتح حساب بنكي',
    expectsGovernmentFee: false,
    renews: null,
  },
  {
    key: 'vat_registration',
    category: 'compliance',
    label: 'VAT registration or filing',
    labelAr: 'التسجيل أو الإقرار الضريبي',
    expectsGovernmentFee: false,
    renews: null,
  },
  {
    key: 'corporate_tax_registration',
    category: 'compliance',
    label: 'Corporate tax registration',
    labelAr: 'تسجيل ضريبة الشركات',
    expectsGovernmentFee: false,
    renews: null,
  },
  {
    key: 'ubo_esr_filing',
    category: 'compliance',
    label: 'UBO / ESR filing',
    labelAr: 'إقرار المالك المستفيد',
    expectsGovernmentFee: false,
    renews: null,
  },
  {
    key: 'lease_renewal',
    category: 'compliance',
    label: 'Lease or Ejari renewal',
    labelAr: 'تجديد الإيجار',
    expectsGovernmentFee: true,
    renews: 'ejari_lease',
  },
  {
    key: 'document_attestation',
    category: 'documents',
    label: 'Document attestation',
    labelAr: 'تصديق المستندات',
    expectsGovernmentFee: true,
    renews: null,
  },
  {
    key: 'document_translation',
    category: 'documents',
    label: 'Legal translation',
    labelAr: 'الترجمة القانونية',
    expectsGovernmentFee: false,
    renews: null,
  },
  {
    key: 'power_of_attorney',
    category: 'documents',
    label: 'Power of attorney',
    labelAr: 'وكالة قانونية',
    expectsGovernmentFee: true,
    renews: null,
  },
  {
    key: 'client_onboarding',
    category: 'internal',
    label: 'Client onboarding',
    labelAr: 'إعداد العميل',
    expectsGovernmentFee: false,
    renews: null,
  },
  {
    key: 'document_collection',
    category: 'internal',
    label: 'Document collection',
    labelAr: 'تجميع المستندات',
    expectsGovernmentFee: false,
    renews: null,
  },
  {
    key: 'other',
    category: 'internal',
    label: 'Other',
    labelAr: 'أخرى',
    expectsGovernmentFee: false,
    renews: null,
  },
];

export const TASK_TYPE_KEYS = TASK_TYPES.map((type) => type.key);

const BY_KEY = new Map(TASK_TYPES.map((type) => [type.key, type]));

export function taskType(key: string): TaskTypeDefinition | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * The task type that discharges a renewal of this document type, used to
 * pre-fill the task the renewals dashboard creates. Returns `null` when there
 * is no obvious mapping rather than guessing.
 */
export function taskTypeForDocType(docType: RenewableDocType): TaskTypeDefinition | null {
  return TASK_TYPES.find((type) => type.renews === docType) ?? null;
}
