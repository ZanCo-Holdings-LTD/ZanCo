import { withCommonFields, type DocumentTypeDefinition } from "./types";

/**
 * UAE document types.
 *
 * Costs and penalty bands are the published schedules at time of writing and
 * are shown as estimates throughout the product. They are content, not
 * compliance advice, and the SEO pages say so.
 */
export const UAE_DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  {
    code: "AE_TRADE_LICENCE",
    country: "AE",
    jurisdiction: "Dubai",
    category: "corporate",
    holderKind: "entity",
    nameEn: "Trade licence",
    nameAr: "الرخصة التجارية",
    aliases: ["commercial licence", "DED licence", "business licence", "rukhsa"],
    issuingAuthority: "Dubai Department of Economy and Tourism",
    issuingAuthorityAr: "دائرة الاقتصاد والسياحة بدبي",
    typicalValidityMonths: 12,
    renewalLeadDays: 45,
    typicalRenewalCost: { amount: 12000, currency: "AED" },
    penalties: [
      { fromDay: 1, toDay: null, amount: 250, currency: "AED", perDay: false, note: "Per month late, accruing" },
    ],
    blocks: ["AE_ESTABLISHMENT_CARD", "AE_LABOUR_CARD", "AE_RESIDENCE_VISA", "AE_VAT_REGISTRATION"],
    requires: ["AE_EJARI"],
    consequences: [
      { effect: "New visa and labour card applications are blocked", severity: "blocking" },
      { effect: "Monthly late fines accrue until renewed", severity: "financial" },
      { effect: "Bank accounts may be frozen pending a valid licence", severity: "operational" },
    ],
    fields: withCommonFields(
      { key: "legalForm", label: "Legal form", kind: "text", hint: "e.g. LLC, Sole Establishment, Branch" },
      { key: "activities", label: "Licensed activities", kind: "text" },
      { key: "issuingAuthority", label: "Issuing authority", kind: "authority" },
    ),
    seo: {
      slug: "dubai-trade-licence-renewal",
      title: "Dubai trade licence renewal: cost, timeline and penalties (2026)",
      metaDescription:
        "What a Dubai trade licence renewal costs, how long it takes, what happens if you miss it, and the documents you need before you start.",
      intro: [
        "A Dubai trade licence runs for twelve months and expires on a fixed date, not on a rolling anniversary of when you last paid. Missing that date does not simply cost a fine — it freezes the things that depend on it, and those dependencies are what turn a small administrative slip into a month of disruption.",
        "The renewal itself is routine. The failure mode is almost never the renewal process; it is that nobody was watching the date, or that the tenancy contract underneath it had already lapsed and nobody connected the two.",
      ],
      steps: [
        {
          heading: "Confirm the Ejari is valid first",
          body: "A trade licence cannot be renewed against an expired tenancy registration. If your Ejari expires within the renewal window, renew it first — this is the single most common reason a licence renewal stalls.",
        },
        {
          heading: "Settle outstanding fines and obtain the payment voucher",
          body: "The Department of Economy and Tourism issues a renewal voucher once any outstanding penalties are cleared. Immigration and labour file fines from other departments can also block the voucher.",
        },
        {
          heading: "Pay and collect the renewed licence",
          body: "Payment is normally same-day and the licence is issued electronically. Budget 3-5 working days end to end, longer if approvals from another authority are attached to your activity.",
        },
        {
          heading: "Cascade the new expiry date",
          body: "The establishment card, and through it every labour card and residence visa, references the licence. Update those records the same day so the next expiry chain is measured from the correct base.",
        },
      ],
      faqs: [
        {
          question: "What is the penalty for a late Dubai trade licence renewal?",
          answer:
            "Penalties accrue monthly from the expiry date, typically around AED 250 per month, and they compound with any blocked-service consequences. The direct fine is rarely the expensive part — the blocked visa issuance usually is.",
        },
        {
          question: "How early can I renew?",
          answer:
            "Renewal is generally accepted from around 30 days before expiry. Starting at 45 days gives you room to fix an Ejari or fine problem before it becomes urgent.",
        },
        {
          question: "What stops working when the licence expires?",
          answer:
            "New residence visa and labour card applications, establishment card renewal, and in some cases banking services. Existing visas do not cancel immediately, but they cannot be renewed against an expired licence.",
        },
      ],
      related: ["dubai-ejari-renewal", "uae-establishment-card-renewal", "uae-residence-visa-renewal"],
    },
  },
  {
    code: "AE_ESTABLISHMENT_CARD",
    country: "AE",
    jurisdiction: "national",
    category: "corporate",
    holderKind: "entity",
    nameEn: "Establishment card (immigration card)",
    nameAr: "بطاقة المنشأة",
    aliases: ["immigration card", "company immigration card", "bitaqat al munsha'a"],
    issuingAuthority: "Federal Authority for Identity, Citizenship, Customs and Port Security",
    issuingAuthorityAr: "الهيئة الاتحادية للهوية والجنسية",
    typicalValidityMonths: 12,
    renewalLeadDays: 30,
    typicalRenewalCost: { amount: 2000, currency: "AED" },
    penalties: [{ fromDay: 1, toDay: null, amount: 100, currency: "AED", perDay: false, note: "Per month late" }],
    blocks: ["AE_RESIDENCE_VISA", "AE_LABOUR_CARD"],
    requires: ["AE_TRADE_LICENCE"],
    consequences: [
      { effect: "No new or renewed residence visas can be filed", severity: "blocking" },
      { effect: "Existing staff cannot travel-in on a new entry permit", severity: "operational" },
    ],
    fields: withCommonFields(
      { key: "establishmentNumber", label: "Establishment number", kind: "number" },
      { key: "companyNameAr", label: "Company name (Arabic)", kind: "name" },
    ),
    seo: {
      slug: "uae-establishment-card-renewal",
      title: "UAE establishment card renewal: what it blocks and how to fix it",
      metaDescription:
        "The UAE establishment card sits between your trade licence and every staff visa. Here is the renewal process, cost, and what breaks when it lapses.",
      intro: [
        "The establishment card is the least visible document in a UAE company's file and the one that causes the most surprise. It does nothing on its own — it exists so the immigration system knows your company can sponsor people.",
        "Which means it is invisible right up until the moment somebody tries to file a visa and cannot. If you track only one dependency in your register, track this one: licence to establishment card to visa.",
      ],
      steps: [
        {
          heading: "Renew the trade licence first",
          body: "The establishment card is issued against a valid licence. An expired licence makes the card renewal impossible, not merely slow.",
        },
        {
          heading: "File the renewal through the immigration portal or a typing centre",
          body: "Most companies file through their PRO or a registered typing centre. Turnaround is usually 1-3 working days once the licence is clean.",
        },
        {
          heading: "Check the new expiry against pending visa applications",
          body: "Any visa application in flight when the card expires will stall. Sequence the card renewal ahead of the visa batch, not alongside it.",
        },
      ],
      faqs: [
        {
          question: "Does an expired establishment card cancel our staff visas?",
          answer:
            "No. Existing residence visas remain valid until their own expiry. What stops is new issuance and renewal — which is worse in practice, because it hits at the moment you need it.",
        },
        {
          question: "How long is a UAE establishment card valid?",
          answer: "Typically one year, aligned to the trade licence. Some free zones issue longer terms.",
        },
      ],
      related: ["dubai-trade-licence-renewal", "uae-residence-visa-renewal", "uae-labour-card-renewal"],
    },
  },
  {
    code: "AE_EJARI",
    country: "AE",
    jurisdiction: "Dubai",
    category: "premises",
    holderKind: "entity",
    nameEn: "Ejari tenancy registration",
    nameAr: "تسجيل إيجاري",
    aliases: ["tenancy contract", "ejari certificate", "lease registration"],
    issuingAuthority: "Dubai Land Department",
    issuingAuthorityAr: "دائرة الأراضي والأملاك بدبي",
    typicalValidityMonths: 12,
    renewalLeadDays: 60,
    typicalRenewalCost: { amount: 220, currency: "AED" },
    penalties: [],
    blocks: ["AE_TRADE_LICENCE"],
    requires: [],
    consequences: [
      { effect: "Trade licence renewal is refused without a valid registered tenancy", severity: "blocking" },
      { effect: "Utility account transfers and DEWA clearance are blocked", severity: "operational" },
    ],
    fields: withCommonFields(
      { key: "propertyAddress", label: "Property address", kind: "text" },
      { key: "contractValue", label: "Annual rent", kind: "number" },
      { key: "landlordName", label: "Landlord", kind: "name" },
    ),
    seo: {
      slug: "dubai-ejari-renewal",
      title: "Dubai Ejari renewal: cost, timeline and the trade licence trap",
      metaDescription:
        "Ejari registration underpins your Dubai trade licence renewal. What it costs, how long it takes, and why it should expire 60 days before your licence.",
      intro: [
        "Ejari is the Dubai Land Department's tenancy registration. On its own it is a low-cost, low-drama piece of paper. Its importance is entirely structural: your trade licence renewal will be refused without it.",
        "The practical rule is to keep the Ejari expiry at least sixty days ahead of the trade licence expiry. If they land in the same week, a landlord who is slow to countersign becomes a licence problem.",
      ],
      steps: [
        {
          heading: "Get the renewed tenancy contract signed",
          body: "The registration follows the contract. Chase the landlord early — this is the step that slips, not the registration itself.",
        },
        {
          heading: "Register through the Dubai REST app or a typing centre",
          body: "Registration is usually same-day once the signed contract, title deed copy and trade licence are in hand.",
        },
        {
          heading: "Attach the certificate to the licence renewal file",
          body: "Keep the PDF where the licence renewal will need it. In practice this is the document that goes missing.",
        },
      ],
      faqs: [
        {
          question: "Can I renew a trade licence with an expired Ejari?",
          answer: "No. A valid registered tenancy is a precondition of the licence renewal.",
        },
        {
          question: "How much does Ejari renewal cost?",
          answer: "Around AED 220 including fees, plus any typing centre charge. It is the cheapest dependency in the chain and the most disruptive when missed.",
        },
      ],
      related: ["dubai-trade-licence-renewal", "uae-establishment-card-renewal"],
    },
  },
  {
    code: "AE_RESIDENCE_VISA",
    country: "AE",
    jurisdiction: "national",
    category: "immigration",
    holderKind: "person",
    nameEn: "Residence visa",
    nameAr: "تأشيرة الإقامة",
    aliases: ["residency", "iqama uae", "employment visa", "residence permit"],
    issuingAuthority: "Federal Authority for Identity and Citizenship (ICP) / GDRFA",
    issuingAuthorityAr: "الهيئة الاتحادية للهوية والجنسية",
    typicalValidityMonths: 24,
    renewalLeadDays: 60,
    typicalRenewalCost: { amount: 5000, currency: "AED" },
    penalties: [
      { fromDay: 1, toDay: null, amount: 50, currency: "AED", perDay: true, note: "Per day overstay, per person" },
    ],
    blocks: ["AE_EMIRATES_ID", "AE_LABOUR_CARD"],
    requires: ["AE_ESTABLISHMENT_CARD", "AE_PASSPORT"],
    consequences: [
      { effect: "Daily overstay fines accrue per employee", severity: "financial" },
      { effect: "The employee cannot legally work or re-enter the country", severity: "blocking" },
      { effect: "Bank accounts and tenancy renewals in the employee's name are blocked", severity: "operational" },
    ],
    fields: withCommonFields(
      { key: "passportNumber", label: "Passport number", kind: "text" },
      { key: "nationality", label: "Nationality", kind: "text" },
      { key: "sponsorName", label: "Sponsor", kind: "name" },
      { key: "visaFileNumber", label: "File number", kind: "text" },
    ),
    seo: {
      slug: "uae-residence-visa-renewal",
      title: "UAE residence visa renewal: timeline, cost and overstay fines",
      metaDescription:
        "How to renew a UAE employment residence visa, the 60-day window, medical and Emirates ID steps, and what overstay actually costs per day.",
      intro: [
        "A UAE residence visa renewal is a sequence, not a transaction: medical fitness test, Emirates ID application, then the visa stamp itself. Each step has its own queue, and the queues do not compress when you are late.",
        "Overstay fines are charged per person per day. For a company with twenty staff on the same renewal cycle, a two-week slip is not a rounding error.",
      ],
      steps: [
        {
          heading: "Start at 60 days out",
          body: "The renewal window opens 30 days before expiry, but the preparation — passport validity checks, photographs, insurance — is what takes the time. Sixty days is the working lead time.",
        },
        {
          heading: "Confirm passport validity",
          body: "Most renewals require at least six months of passport validity. A passport expiring inside that window turns a visa renewal into a consulate appointment.",
        },
        {
          heading: "Medical fitness and biometrics",
          body: "Book the medical and Emirates ID biometrics together where the centre allows it. Results typically take 2-4 working days.",
        },
        {
          heading: "Visa stamping and Emirates ID issue",
          body: "The residence stamp is issued electronically; the Emirates ID card follows by courier. Record both expiry dates — they are not always identical.",
        },
      ],
      faqs: [
        {
          question: "What is the UAE overstay fine?",
          answer:
            "Broadly AED 50 per day from the day after expiry, per person, with a grace period that varies by visa type. Confirm the current rate with ICP before budgeting.",
        },
        {
          question: "Can an employee work while the renewal is being processed?",
          answer:
            "Once the renewal has been filed and is in process, the position is generally protected. Once the visa has simply expired with nothing filed, it is not.",
        },
        {
          question: "Does the Emirates ID expire on the same day as the visa?",
          answer:
            "Usually, but not always — replacement cards and mid-cycle amendments shift the date. Track them as two records, because they are two records.",
        },
      ],
      related: ["uae-emirates-id-renewal", "uae-labour-card-renewal", "uae-establishment-card-renewal"],
    },
  },
  {
    code: "AE_EMIRATES_ID",
    country: "AE",
    jurisdiction: "national",
    category: "immigration",
    holderKind: "person",
    nameEn: "Emirates ID",
    nameAr: "الهوية الإماراتية",
    aliases: ["EID", "national identity card", "hawiya"],
    issuingAuthority: "Federal Authority for Identity and Citizenship (ICP)",
    issuingAuthorityAr: "الهيئة الاتحادية للهوية والجنسية",
    typicalValidityMonths: 24,
    renewalLeadDays: 30,
    typicalRenewalCost: { amount: 370, currency: "AED" },
    penalties: [
      { fromDay: 31, toDay: null, amount: 20, currency: "AED", perDay: true, note: "Per day after a 30-day grace period, capped" },
    ],
    blocks: [],
    requires: ["AE_RESIDENCE_VISA"],
    consequences: [
      { effect: "Banking, telecom and government services are refused", severity: "operational" },
      { effect: "Daily fines after the grace period", severity: "financial" },
    ],
    fields: withCommonFields(
      { key: "idNumber", label: "ID number", kind: "text", hint: "784-XXXX-XXXXXXX-X", pattern: "^784[-\\s]?\\d{4}[-\\s]?\\d{7}[-\\s]?\\d$" },
      { key: "nationality", label: "Nationality", kind: "text" },
      { key: "dateOfBirth", label: "Date of birth", kind: "date" },
    ),
    seo: {
      slug: "uae-emirates-id-renewal",
      title: "Emirates ID renewal: grace period, fines and the 30-day rule",
      metaDescription:
        "When to renew an Emirates ID, the grace period after expiry, daily fines, and why it should be tracked separately from the residence visa.",
      intro: [
        "The Emirates ID normally tracks the residence visa, which is exactly why it gets missed: teams assume renewing one renews the other. It does not, and the two dates drift apart the moment a card is replaced mid-cycle.",
        "There is a grace period after expiry, which is generous enough to be dangerous — it removes the urgency without removing the consequence.",
      ],
      steps: [
        {
          heading: "Apply within 30 days of expiry",
          body: "The application can be filed through ICP's portal or an authorised typing centre. Biometrics are only re-taken when the system asks for them.",
        },
        {
          heading: "Track the card, not just the application",
          body: "The application being approved is not the same as the card being in the employee's hand. Record the new expiry from the issued card.",
        },
      ],
      faqs: [
        {
          question: "What is the Emirates ID renewal grace period?",
          answer: "Around 30 days from expiry, after which daily fines apply up to a cap. Treat the grace period as buffer, not as schedule.",
        },
        {
          question: "Should I track Emirates ID separately from the visa?",
          answer:
            "Yes. They usually share a date and periodically do not, and the exception is the one that costs money.",
        },
      ],
      related: ["uae-residence-visa-renewal", "employee-document-tracker-template"],
    },
  },
  {
    code: "AE_LABOUR_CARD",
    country: "AE",
    jurisdiction: "national",
    category: "labour",
    holderKind: "person",
    nameEn: "Labour card / MOHRE work permit",
    nameAr: "بطاقة العمل",
    aliases: ["work permit", "MOHRE card", "labour contract"],
    issuingAuthority: "Ministry of Human Resources and Emiratisation",
    issuingAuthorityAr: "وزارة الموارد البشرية والتوطين",
    typicalValidityMonths: 24,
    renewalLeadDays: 45,
    typicalRenewalCost: { amount: 1200, currency: "AED" },
    penalties: [
      { fromDay: 1, toDay: null, amount: 500, currency: "AED", note: "Per worker, escalating with duration" },
    ],
    blocks: [],
    requires: ["AE_ESTABLISHMENT_CARD", "AE_RESIDENCE_VISA"],
    consequences: [
      { effect: "The company's MOHRE file can be suspended, blocking all new permits", severity: "blocking" },
      { effect: "Fines per worker", severity: "financial" },
    ],
    fields: withCommonFields(
      { key: "permitNumber", label: "Permit number", kind: "text" },
      { key: "occupation", label: "Occupation", kind: "text" },
      { key: "employerName", label: "Employer", kind: "name" },
    ),
    seo: {
      slug: "uae-labour-card-renewal",
      title: "UAE labour card renewal: MOHRE work permit cost and penalties",
      metaDescription:
        "Renewing a MOHRE work permit: the cost per worker, the renewal window, and how a single lapsed permit can suspend the whole company file.",
      intro: [
        "The labour card is the MOHRE side of an employee's file, running in parallel with the immigration side. The two are renewed through different systems and, in a badly run register, on different dates.",
        "The asymmetry worth knowing: an individual expired permit is a per-worker fine, but a pattern of them can suspend the company's MOHRE file, which stops every new permit — including for the roles you are hiring right now.",
      ],
      steps: [
        {
          heading: "Renew alongside the residence visa",
          body: "Where the dates allow, batch them. The document requirements overlap almost entirely.",
        },
        {
          heading: "Check the establishment's MOHRE standing",
          body: "Outstanding fines or an expired establishment card will block the permit renewal before you reach the payment step.",
        },
        {
          heading: "Confirm the contract is lodged",
          body: "The renewed permit follows a lodged and signed employment contract. An unsigned contract stalls the file silently.",
        },
      ],
      faqs: [
        {
          question: "What happens if a labour card expires?",
          answer:
            "Fines accrue per worker, and the employee is not legally permitted to work. Repeated lapses put the company's MOHRE classification and its ability to file new permits at risk.",
        },
      ],
      related: ["uae-residence-visa-renewal", "uae-establishment-card-renewal"],
    },
  },
  {
    code: "AE_PASSPORT",
    country: "AE",
    jurisdiction: "national",
    category: "immigration",
    holderKind: "person",
    nameEn: "Passport",
    nameAr: "جواز السفر",
    aliases: ["travel document"],
    issuingAuthority: "Issuing country's authority",
    issuingAuthorityAr: "سلطة بلد الإصدار",
    typicalValidityMonths: 120,
    renewalLeadDays: 180,
    typicalRenewalCost: null,
    penalties: [],
    blocks: ["AE_RESIDENCE_VISA", "AE_EMIRATES_ID"],
    requires: [],
    consequences: [
      { effect: "Visa renewal is refused when under six months of validity remain", severity: "blocking" },
      { effect: "The employee cannot travel", severity: "operational" },
    ],
    fields: withCommonFields(
      { key: "passportNumber", label: "Passport number", kind: "text", required: true },
      { key: "nationality", label: "Nationality", kind: "text" },
      { key: "dateOfBirth", label: "Date of birth", kind: "date" },
      { key: "placeOfIssue", label: "Place of issue", kind: "text" },
    ),
    seo: null,
  },
  {
    code: "AE_VEHICLE_REGISTRATION",
    country: "AE",
    jurisdiction: "Dubai",
    category: "vehicle",
    holderKind: "vehicle",
    nameEn: "Vehicle registration (Mulkiya)",
    nameAr: "ملكية المركبة",
    aliases: ["mulkiya", "vehicle licence", "registration card"],
    issuingAuthority: "Roads and Transport Authority",
    issuingAuthorityAr: "هيئة الطرق والمواصلات",
    typicalValidityMonths: 12,
    renewalLeadDays: 30,
    typicalRenewalCost: { amount: 420, currency: "AED" },
    penalties: [
      { fromDay: 1, toDay: null, amount: 10, currency: "AED", perDay: false, note: "Per month late, plus AED 500 fine for driving unregistered" },
    ],
    blocks: [],
    requires: ["AE_VEHICLE_INSURANCE"],
    consequences: [
      { effect: "The vehicle is impounded if stopped", severity: "blocking" },
      { effect: "Insurance claims can be refused on an unregistered vehicle", severity: "financial" },
      { effect: "Monthly late fees", severity: "financial" },
    ],
    fields: withCommonFields(
      { key: "plateNumber", label: "Plate number", kind: "text", required: true },
      { key: "chassisNumber", label: "Chassis number", kind: "text" },
      { key: "make", label: "Make", kind: "text" },
      { key: "model", label: "Model", kind: "text" },
      { key: "insuranceExpiry", label: "Insurance expiry", kind: "date" },
    ),
    seo: {
      slug: "dubai-vehicle-registration-renewal",
      title: "Dubai vehicle registration renewal: test, insurance and fines",
      metaDescription:
        "Renewing a Mulkiya in Dubai: the vehicle test, insurance requirement, cost, and what an expired registration costs when the vehicle is stopped.",
      intro: [
        "Vehicle registration renewal is the most predictable item in a fleet's compliance calendar and the most frequently missed, because it belongs to nobody in particular. The driver assumes the office handles it; the office assumes the driver noticed.",
        "The cost of missing it is not the late fee. It is a vehicle impounded mid-job, and an insurer with grounds to question a claim.",
      ],
      steps: [
        {
          heading: "Renew the insurance first",
          body: "Registration cannot be renewed without a valid insurance policy covering the full registration period. Sequence it accordingly.",
        },
        {
          heading: "Pass the vehicle test",
          body: "Vehicles over three years old require a technical test. Book it 3-4 weeks out; a failed test needs repair time before a retest.",
        },
        {
          heading: "Clear outstanding fines",
          body: "Traffic fines block renewal. Check them before you book the test, not after.",
        },
      ],
      faqs: [
        {
          question: "What is the fine for an expired vehicle registration in the UAE?",
          answer:
            "Driving with expired registration attracts a fine of around AED 500 plus black points and possible impounding, on top of monthly late renewal charges.",
        },
        {
          question: "Can I renew before the vehicle test?",
          answer: "No — a valid test certificate is required for vehicles over three years old.",
        },
      ],
      related: ["uae-vehicle-insurance-renewal", "fleet-compliance-tracker"],
    },
  },
  {
    code: "AE_VEHICLE_INSURANCE",
    country: "AE",
    jurisdiction: "national",
    category: "insurance",
    holderKind: "vehicle",
    nameEn: "Vehicle insurance policy",
    nameAr: "بوليصة تأمين المركبة",
    aliases: ["motor insurance", "car insurance"],
    issuingAuthority: "Licensed insurer",
    issuingAuthorityAr: "شركة تأمين مرخصة",
    typicalValidityMonths: 13,
    renewalLeadDays: 30,
    typicalRenewalCost: { amount: 2500, currency: "AED" },
    penalties: [{ fromDay: 1, toDay: null, amount: 500, currency: "AED", note: "Driving uninsured" }],
    blocks: ["AE_VEHICLE_REGISTRATION"],
    requires: [],
    consequences: [
      { effect: "Registration renewal is blocked", severity: "blocking" },
      { effect: "The company carries uninsured liability on every journey", severity: "financial" },
    ],
    fields: withCommonFields(
      { key: "policyNumber", label: "Policy number", kind: "text", required: true },
      { key: "insurer", label: "Insurer", kind: "name" },
      { key: "plateNumber", label: "Plate number", kind: "text" },
      { key: "coverageType", label: "Coverage", kind: "text", hint: "Comprehensive or third-party" },
    ),
    seo: {
      slug: "uae-vehicle-insurance-renewal",
      title: "UAE vehicle insurance renewal: the 13-month rule and registration",
      metaDescription:
        "Why UAE motor policies run 13 months, how insurance gates vehicle registration renewal, and what uninsured exposure costs a company fleet.",
      intro: [
        "UAE motor policies conventionally run thirteen months rather than twelve, precisely so the insurance outlasts the registration it supports. That extra month is a deliberate buffer, and it disappears the moment somebody buys a twelve-month policy to save money.",
        "For a fleet, the insurance date matters more than the registration date, because it is the one that gates the other.",
      ],
      steps: [
        {
          heading: "Renew at least 30 days out",
          body: "Insurers re-rate at renewal and a claims history can change the premium materially. Thirty days gives you room to quote alternatives.",
        },
        {
          heading: "Check the policy covers the full registration year",
          body: "A policy that expires one day before the registration does creates a gap the RTA will not accept.",
        },
      ],
      faqs: [
        {
          question: "Why is UAE car insurance 13 months?",
          answer:
            "The extra month covers the grace period around registration renewal, so the vehicle is never insured for less than the registration period.",
        },
      ],
      related: ["dubai-vehicle-registration-renewal", "fleet-compliance-tracker"],
    },
  },
  {
    code: "AE_VAT_REGISTRATION",
    country: "AE",
    jurisdiction: "national",
    category: "tax",
    holderKind: "entity",
    nameEn: "VAT registration certificate",
    nameAr: "شهادة التسجيل الضريبي",
    aliases: ["TRN certificate", "tax registration number"],
    issuingAuthority: "Federal Tax Authority",
    issuingAuthorityAr: "الهيئة الاتحادية للضرائب",
    typicalValidityMonths: null,
    renewalLeadDays: 30,
    typicalRenewalCost: null,
    penalties: [],
    blocks: [],
    requires: ["AE_TRADE_LICENCE"],
    consequences: [
      { effect: "Invoices without a valid TRN may be rejected by customers", severity: "operational" },
    ],
    fields: withCommonFields({ key: "trn", label: "TRN", kind: "text", hint: "15-digit tax registration number" }),
    seo: null,
  },
  {
    code: "AE_CIVIL_DEFENCE_CERT",
    country: "AE",
    jurisdiction: "Dubai",
    category: "premises",
    holderKind: "asset",
    nameEn: "Civil Defence fire safety certificate",
    nameAr: "شهادة الدفاع المدني",
    aliases: ["fire safety certificate", "civil defence approval"],
    issuingAuthority: "Dubai Civil Defence",
    issuingAuthorityAr: "الدفاع المدني بدبي",
    typicalValidityMonths: 12,
    renewalLeadDays: 45,
    typicalRenewalCost: { amount: 1500, currency: "AED" },
    penalties: [{ fromDay: 1, toDay: null, amount: 2000, currency: "AED", note: "Escalating, plus closure risk" }],
    blocks: [],
    requires: [],
    consequences: [
      { effect: "Premises can be closed following an inspection", severity: "blocking" },
      { effect: "Insurance cover for the premises may be void", severity: "financial" },
    ],
    fields: withCommonFields(
      { key: "certificateNumber", label: "Certificate number", kind: "text" },
      { key: "premisesAddress", label: "Premises", kind: "text" },
    ),
    seo: null,
  },
  {
    code: "AE_HSE_TRAINING",
    country: "AE",
    jurisdiction: "national",
    category: "certification",
    holderKind: "person",
    nameEn: "HSE training certificate",
    nameAr: "شهادة تدريب الصحة والسلامة",
    aliases: ["safety training", "NEBOSH", "IOSH", "first aid certificate"],
    issuingAuthority: "Accredited training provider",
    issuingAuthorityAr: "جهة تدريب معتمدة",
    typicalValidityMonths: 36,
    renewalLeadDays: 60,
    typicalRenewalCost: { amount: 900, currency: "AED" },
    penalties: [],
    blocks: [],
    requires: [],
    consequences: [
      { effect: "The employee cannot be deployed on sites requiring the certification", severity: "operational" },
      { effect: "Client audits and pre-qualification submissions fail", severity: "financial" },
    ],
    fields: withCommonFields(
      { key: "certificateNumber", label: "Certificate number", kind: "text" },
      { key: "courseName", label: "Course", kind: "text" },
      { key: "provider", label: "Training provider", kind: "name" },
    ),
    seo: null,
  },
];
