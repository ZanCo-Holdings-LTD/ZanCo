/**
 * Parser configurations for the three highest-volume aggregators in Saudi
 * Arabia: HungerStation, Jahez and Talabat.
 *
 * IMPORTANT — the column names and vocabularies below are reconstructed from
 * published statement templates and partner documentation, not from the real
 * M0 corpus. They are a working starting point, and the first thing M3 does with
 * real files is replace these with fingerprints taken from actual exports.
 *
 * Treat a mismatch between these and a real statement as expected: that is what
 * the drift detector is for, and the failure mode it produces (route to
 * extraction, alert a human) is the safe one.
 *
 * The parser library is an asset with a permanent maintenance cost. Eighteen
 * formats across six aggregators and three countries will change without notice,
 * and the answer is fingerprinting, alerting and replay rather than hoping.
 */
import type { Parser } from '../types.js';
import { createOrderParser, createPayoutParser } from '../tabular.js';

// ---------------------------------------------------------------------------
// Talabat
// ---------------------------------------------------------------------------

export const talabatOrders: Parser = createOrderParser({
  key: 'talabat_orders_v1',
  version: '1.0.0',
  aggregatorCode: 'talabat',
  headers: [
    'Order ID', 'Order Date', 'Status', 'Subtotal', 'Delivery Fee', 'VAT',
    'Discount', 'Total', 'Promotion', 'Funded By',
  ],
  columns: {
    orderId: 'Order ID',
    orderedAt: 'Order Date',
    status: 'Status',
    itemTotal: 'Subtotal',
    deliveryFee: 'Delivery Fee',
    vat: 'VAT',
    discount: 'Discount',
    gross: 'Total',
    promoType: 'Promotion',
    promoFundedBy: 'Funded By',
    promoAmount: 'Discount',
  },
  statusMap: {
    delivered: 'delivered',
    completed: 'delivered',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    rejected: 'rejected',
    'rejected by vendor': 'rejected',
    refunded: 'refunded',
    'partially refunded': 'partially_refunded',
  },
  fundedByMap: {
    talabat: 'aggregator',
    platform: 'aggregator',
    vendor: 'operator',
    restaurant: 'operator',
    shared: 'shared',
    'co-funded': 'shared',
    customer: 'customer',
  },
});

export const talabatPayout: Parser = createPayoutParser({
  key: 'talabat_payout_v1',
  version: '1.0.0',
  aggregatorCode: 'talabat',
  headers: [
    'Payout Reference', 'Transaction Date', 'Order ID', 'Transaction Type',
    'Amount', 'Description', 'Period Start', 'Period End', 'Payment Date',
  ],
  columns: {
    payoutId: 'Payout Reference',
    orderId: 'Order ID',
    lineType: 'Transaction Type',
    amount: 'Amount',
    date: 'Transaction Date',
    description: 'Description',
    periodStart: 'Period Start',
    periodEnd: 'Period End',
    paidOn: 'Payment Date',
  },
  lineTypeMap: {
    'gross sales': 'gross_sale',
    'order value': 'gross_sale',
    sales: 'gross_sale',
    commission: 'commission',
    'commission fee': 'commission',
    'delivery fee': 'delivery_fee',
    'promotion funding': 'promo_funding',
    'promotion charge': 'promo_recharge',
    'promo recharge': 'promo_recharge',
    refund: 'refund',
    'customer refund': 'refund',
    cancellation: 'cancellation',
    'cancelled order': 'cancellation',
    chargeback: 'chargeback',
    vat: 'vat',
    adjustment: 'adjustment',
    'manual adjustment': 'adjustment',
    penalty: 'penalty',
    fine: 'penalty',
    tip: 'tip',
  },
  // Talabat statements quote deductions as positive figures in an Amount column
  // with the sign implied by the Transaction Type.
  deductionsArePositive: true,
});

// ---------------------------------------------------------------------------
// HungerStation
// ---------------------------------------------------------------------------

export const hungerstationOrders: Parser = createOrderParser({
  key: 'hungerstation_orders_v1',
  version: '1.0.0',
  aggregatorCode: 'hungerstation',
  headers: [
    'Order Number', 'Created At', 'Order Status', 'Items Amount', 'Delivery Charge',
    'VAT Amount', 'Discount Amount', 'Grand Total', 'Campaign', 'Campaign Funded By',
  ],
  columns: {
    orderId: 'Order Number',
    orderedAt: 'Created At',
    status: 'Order Status',
    itemTotal: 'Items Amount',
    deliveryFee: 'Delivery Charge',
    vat: 'VAT Amount',
    discount: 'Discount Amount',
    gross: 'Grand Total',
    promoType: 'Campaign',
    promoFundedBy: 'Campaign Funded By',
    promoAmount: 'Discount Amount',
  },
  statusMap: {
    delivered: 'delivered',
    complete: 'delivered',
    completed: 'delivered',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    'cancelled by customer': 'cancelled',
    'cancelled by store': 'cancelled',
    rejected: 'rejected',
    refunded: 'refunded',
  },
  fundedByMap: {
    hungerstation: 'aggregator',
    platform: 'aggregator',
    store: 'operator',
    merchant: 'operator',
    shared: 'shared',
  },
});

export const hungerstationPayout: Parser = createPayoutParser({
  key: 'hungerstation_payout_v1',
  version: '1.0.0',
  aggregatorCode: 'hungerstation',
  headers: [
    'Settlement ID', 'Date', 'Order Number', 'Type', 'Value', 'Notes',
    'Settlement From', 'Settlement To', 'Transfer Date',
  ],
  columns: {
    payoutId: 'Settlement ID',
    orderId: 'Order Number',
    lineType: 'Type',
    amount: 'Value',
    date: 'Date',
    description: 'Notes',
    periodStart: 'Settlement From',
    periodEnd: 'Settlement To',
    paidOn: 'Transfer Date',
  },
  lineTypeMap: {
    sales: 'gross_sale',
    'order amount': 'gross_sale',
    'gross amount': 'gross_sale',
    commission: 'commission',
    'platform fee': 'commission',
    delivery: 'delivery_fee',
    'delivery fee': 'delivery_fee',
    'campaign funding': 'promo_funding',
    'campaign charge': 'promo_recharge',
    discount: 'promo_recharge',
    refund: 'refund',
    cancellation: 'cancellation',
    chargeback: 'chargeback',
    vat: 'vat',
    adjustment: 'adjustment',
    penalty: 'penalty',
    tip: 'tip',
  },
  // HungerStation settlement files use signed values.
  deductionsArePositive: false,
});

// ---------------------------------------------------------------------------
// Jahez
// ---------------------------------------------------------------------------

export const jahezPayout: Parser = createPayoutParser({
  key: 'jahez_payout_v1',
  version: '1.0.0',
  aggregatorCode: 'jahez',
  headers: [
    'Invoice No', 'Entry Date', 'Reference', 'Entry Type', 'Amount (SAR)',
    'Remarks', 'From Date', 'To Date',
  ],
  columns: {
    payoutId: 'Invoice No',
    orderId: 'Reference',
    lineType: 'Entry Type',
    amount: 'Amount (SAR)',
    date: 'Entry Date',
    description: 'Remarks',
    reference: 'Reference',
    periodStart: 'From Date',
    periodEnd: 'To Date',
  },
  lineTypeMap: {
    sales: 'gross_sale',
    'total sales': 'gross_sale',
    commission: 'commission',
    'jahez commission': 'commission',
    delivery: 'delivery_fee',
    'promotion share': 'promo_funding',
    'promotion deduction': 'promo_recharge',
    refund: 'refund',
    cancellation: 'cancellation',
    chargeback: 'chargeback',
    vat: 'vat',
    adjustment: 'adjustment',
    deduction: 'adjustment',
    penalty: 'penalty',
  },
  deductionsArePositive: true,
});

export const ALL_PARSERS: readonly Parser[] = [
  talabatOrders,
  talabatPayout,
  hungerstationOrders,
  hungerstationPayout,
  jahezPayout,
];
