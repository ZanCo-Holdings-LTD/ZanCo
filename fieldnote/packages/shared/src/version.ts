/**
 * Engine version.
 *
 * Stamped on every generated value, every recon run and every rendered PDF.
 * Together with the model and prompt versions it makes any historical row
 * attributable to the exact code that produced it — which matters most once
 * that code has long since been deployed over.
 *
 * Bump on any change to the pipeline's behaviour: matching, grounding,
 * coercion, merge semantics. Not on a refactor that cannot move a number.
 */
export const ENGINE_VERSION = '0.1.0';

/**
 * Analytics event taxonomy.
 *
 * A closed set, so an event name is a compile error rather than a typo that
 * quietly splits a funnel into two metrics nobody notices.
 */
export const ANALYTICS_EVENTS = [
  'signup',
  'org_created',
  'template_selected',
  'report_created',
  'capture_uploaded',
  'transcription_completed',
  'structuring_completed',
  'review_opened',
  'field_edited',
  'field_confirmed',
  'export_blocked',
  'report_exported',
  'report_delivered',
  'subscribed',
  'seat_added',
  'churned',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * North star: percentage of trial users delivering a real client report within
 * 48 hours. It leads everything else — a user who has not sent one report in
 * two days is not going to send five a week in month three.
 */
export const ACTIVATION_WINDOW_HOURS = 48;

export const METRIC_TARGETS = {
  activationRate: 0.45,
  reportsPerUserPerWeek: 5,
  trialToPaid: 0.25,
  maxMonthlyChurnSolo: 0.04,
  maxMonthlyChurnTeam: 0.02,
  minNetRevenueRetention: 1.0,
  maxInferenceCostShareOfArpu: 0.12,
} as const;
