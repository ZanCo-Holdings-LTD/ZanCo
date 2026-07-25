/**
 * Legal pages.
 *
 * Held as content so the DPA, subprocessor list and privacy policy ship with
 * the product rather than existing as a promise. The brief is explicit: these
 * are needed before the first paid customer, not after.
 *
 * They are drafted, not lawyer-reviewed — review before commercial use.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
}

const COMPANY = "Sarayan";

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: "privacy",
    title: "Privacy policy",
    summary:
      "What personal data Sarayan holds, why, for how long, and the rights of the people it belongs to.",
    updated: "2026-07-01",
    sections: [
      {
        heading: "Who we are",
        paragraphs: [
          `${COMPANY} provides document and certification expiry management software. For the account data of our own customers we act as a data controller. For the employee and asset records our customers upload, we act as a data processor on their instructions.`,
        ],
      },
      {
        heading: "What we collect",
        paragraphs: ["Two distinct categories, held for different reasons."],
        bullets: [
          "Account data: name, work email, phone number, organisation, role, and authentication material. Collected to operate the service and to send alerts.",
          "Customer content: the records our customers create — holder names, document numbers, issue and expiry dates, issuing authorities, and any document files uploaded. This can include passport and national identity numbers.",
          "Operational data: audit log entries, alert delivery receipts, and error diagnostics. Retained to prove what happened and when.",
        ],
      },
      {
        heading: "Why we can hold it",
        paragraphs: [
          "Account data is processed to perform our contract with the customer. Customer content is processed on the customer's documented instructions under a data processing agreement. Where a customer relies on legitimate interests or a legal obligation for the underlying records, that assessment is theirs to make and record.",
        ],
      },
      {
        heading: "Document files and extraction",
        paragraphs: [
          "Uploaded files are encrypted with a key unique to the customer's organisation before storage. When automatic extraction is enabled, the file is transmitted to the configured model provider for the single purpose of reading fields from it. The provider does not retain the file for training. Customers who prefer not to transmit documents at all can enable metadata-only mode, in which no file is ever uploaded.",
        ],
      },
      {
        heading: "Retention",
        paragraphs: [
          "Customer content is retained for as long as the customer's account is active and for 30 days after termination, after which it is deleted. Audit log entries are retained for seven years, because their purpose is to answer questions asked years later. A customer may request earlier deletion of files while keeping the metadata register.",
        ],
      },
      {
        heading: "Where it is stored",
        paragraphs: [
          "Files are stored in the region pinned to the customer's account. The default is the Middle East (me-central-1). Database records are held in the region selected at account creation. Where a customer requires in-country hosting, a documented migration path is available.",
        ],
      },
      {
        heading: "Rights",
        paragraphs: [
          "Individuals whose data appears in a customer's register should contact that customer, who controls the record. Where we act as controller — for our own account holders — you may request access, correction, deletion, or a copy of your data by writing to privacy@sarayan.app. We respond within 30 days.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: ["privacy@sarayan.app for data protection questions; security@sarayan.app for security reports."],
      },
    ],
  },
  {
    slug: "dpa",
    title: "Data processing agreement",
    summary:
      "The processor terms that apply when a customer uploads employee records to Sarayan. Available signed on request.",
    updated: "2026-07-01",
    sections: [
      {
        heading: "Roles",
        paragraphs: [
          `The customer is the controller of the personal data contained in its records. ${COMPANY} is the processor, acting only on the customer's documented instructions, which the customer gives by configuring and using the service.`,
        ],
      },
      {
        heading: "Subject matter and duration",
        paragraphs: [
          "The subject matter is the provision of document expiry management software. Processing continues for the term of the subscription plus the 30-day deletion window.",
        ],
      },
      {
        heading: "Categories of data and data subjects",
        paragraphs: ["Processing covers:"],
        bullets: [
          "Data subjects: the customer's employees, contractors, drivers and their dependants, and the customer's own personnel who use the service.",
          "Categories: identity data (name, nationality, date of birth), identification document numbers (passport, national ID, iqama, Emirates ID), employment data (occupation, department, employer), asset data (vehicle plate and chassis numbers), and any document images uploaded.",
        ],
      },
      {
        heading: "Security measures",
        paragraphs: ["We maintain, at minimum:"],
        bullets: [
          "Encryption in transit (TLS 1.2 or higher) and at rest (AES-256-GCM with per-tenant data keys).",
          "Role-based access control enforced server-side, with four roles and least-privilege defaults.",
          "An append-only audit log of every mutation, retained for seven years.",
          "Session tokens stored only as hashes, so a database compromise does not yield live sessions.",
          "Segregation of customer data by organisation identifier on every query path.",
        ],
      },
      {
        heading: "Subprocessors",
        paragraphs: [
          "We engage the subprocessors published on our subprocessor page. We give 30 days' notice before adding a new one, during which the customer may object and, if the objection cannot be resolved, terminate the affected service without penalty.",
        ],
      },
      {
        heading: "Personal data breach",
        paragraphs: [
          "We notify the customer without undue delay and in any event within 48 hours of becoming aware of a personal data breach affecting their data, with the information available at the time and updates as the investigation proceeds.",
        ],
      },
      {
        heading: "Assistance and audit",
        paragraphs: [
          "We assist the customer with data subject requests, impact assessments and regulator enquiries. On reasonable notice and no more than once a year, the customer may audit our compliance with these terms, or accept a third-party report in place of an on-site audit.",
        ],
      },
      {
        heading: "Deletion and return",
        paragraphs: [
          "On termination the customer may export their register in full via CSV or the API. We delete customer content 30 days after termination unless legally required to retain it.",
        ],
      },
      {
        heading: "International transfers",
        paragraphs: [
          "Where personal data leaves its country of origin, transfers rely on the appropriate mechanism for that jurisdiction — standard contractual clauses, or the transfer conditions of the Saudi PDPL and UAE data protection law as applicable. Customers requiring data to remain in-country should contact us before signature.",
        ],
      },
    ],
  },
  {
    slug: "subprocessors",
    title: "Subprocessors",
    summary:
      "The third parties that may process customer data, what each does, and where they are located.",
    updated: "2026-07-01",
    sections: [
      {
        heading: "Current subprocessors",
        paragraphs: [
          "This list reflects the services a deployment may use. A self-hosted or single-tenant deployment may use fewer. Customers are notified 30 days before a new subprocessor is added.",
        ],
        bullets: [
          "Database hosting — managed Postgres provider. Stores the register: records, dates, holders, alerts. Region selected per account.",
          "Object storage — S3-compatible provider. Stores uploaded document files, encrypted with per-tenant keys before upload. Region pinned per account.",
          "Application hosting — serves the application and runs scheduled alert dispatch.",
          "Model provider (Anthropic) — receives an uploaded document only when automatic extraction is enabled, solely to extract fields. Not used for training. Disabled entirely in metadata-only mode.",
          "Email delivery (Resend) — transmits alert and transactional email. Receives recipient address, document type, holder name and expiry date.",
          "WhatsApp business solution provider — transmits WhatsApp alerts where the tier includes them. Receives recipient phone number and the template parameters.",
          "Payment processing (Stripe) — handles card payments. Receives billing contact and payment details; never receives register content.",
          "Error monitoring (Sentry) — receives diagnostic data with personal data scrubbed.",
          "Product analytics (PostHog, self-hosted) — receives usage events, not register content.",
        ],
      },
      {
        heading: "Objecting to a subprocessor",
        paragraphs: [
          "Write to privacy@sarayan.app within the notice period. Where an objection cannot be resolved, the customer may terminate the affected service without penalty.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms of service",
    summary: "The commercial terms on which Sarayan is provided.",
    updated: "2026-07-01",
    sections: [
      {
        heading: "The service",
        paragraphs: [
          `${COMPANY} provides software for recording documents and their expiry dates, and for sending alerts before those dates. It is a record-keeping and reminder tool.`,
        ],
      },
      {
        heading: "What the service is not",
        paragraphs: [
          "Sarayan does not provide legal, immigration or tax advice, does not submit renewals to any government authority, and does not guarantee that a register is complete or that an alert will be acted upon. Penalty figures, validity periods and lead times shown in the product are estimates drawn from published schedules and can change without notice. Responsibility for compliance remains entirely with the customer.",
        ],
      },
      {
        heading: "Accounts and access",
        paragraphs: [
          "The customer is responsible for the accuracy of the data it enters, for the actions of its users, and for keeping credentials secure. We may suspend an account for non-payment after written notice, or immediately where use threatens the security of the service.",
        ],
      },
      {
        heading: "Fees",
        paragraphs: [
          "Subscription fees are as published or as agreed in an order form, payable monthly or annually in advance. Annual plans are billed at ten months' fees for twelve months' service. Invoice payment is available; the plan activates on confirmation of transfer. Fees exclude VAT and similar taxes, which are added where applicable.",
        ],
      },
      {
        heading: "Plan limits",
        paragraphs: [
          "Each plan includes a stated number of records, users, entities and messaging allowance. Exceeding a limit prompts an upgrade rather than silently degrading alerts — alerts are never suppressed for commercial reasons.",
        ],
      },
      {
        heading: "Liability",
        paragraphs: [
          "To the extent permitted by law, our aggregate liability in any twelve-month period is limited to the fees paid in that period. We are not liable for fines, penalties, blocked government services or business losses arising from an expired document, however caused. This limitation is fundamental to the pricing.",
        ],
      },
      {
        heading: "Termination",
        paragraphs: [
          "Either party may terminate at the end of a billing period. On termination the customer may export the full register. Data is deleted 30 days after termination.",
        ],
      },
      {
        heading: "Governing law",
        paragraphs: [
          "These terms are governed by the laws of England and Wales, without prejudice to mandatory consumer or data protection rights in the customer's own jurisdiction.",
        ],
      },
    ],
  },
];

export function legalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
