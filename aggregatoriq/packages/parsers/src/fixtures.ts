/**
 * Synthetic statement fixtures.
 *
 * Real customer statements are a restaurant's commercial records and are
 * gitignored — see `docs/parsers.md`. These are hand-built to exercise the
 * awkward cases the real corpus is full of: quoted fields, a preamble above the
 * header, mixed date formats, negatives in three notations, an unmapped
 * transaction type, and a cancelled order that still carries commission.
 */

export const TALABAT_ORDERS_CSV = [
  'Order ID,Order Date,Status,Subtotal,Delivery Fee,VAT,Discount,Total,Promotion,Funded By',
  'TLB1001,05/03/2025 19:32,Delivered,100.00,0.00,5.00,0.00,105.00,,',
  'TLB1002,05/03/2025 20:10,Delivered,200.00,10.00,10.00,20.00,200.00,Ramadan15,Talabat',
  'TLB1003,06/03/2025 13:05,Cancelled,80.00,0.00,4.00,0.00,84.00,,',
  'TLB1004,06/03/2025 21:47,Delivered,50.00,0.00,2.50,0.00,52.50,,',
  '"TLB1005",07/03/2025 12:00,Delivered,"1,200.00",0.00,60.00,0.00,"1,260.00",,',
].join('\n');

/**
 * A Talabat payout for the same period. Deliberately wrong in ways the engine
 * should find: TLB1002 charged commission at 30% instead of 25%, TLB1003
 * charged commission on a cancelled order, TLB1004 absent entirely, and a
 * Ramadan15 promotion recharged to the operator that Talabat agreed to fund.
 */
export const TALABAT_PAYOUT_CSV = [
  'Talabat Partner Settlement',
  'Store: Example Restaurant Riyadh',
  '',
  'Payout Reference,Transaction Date,Order ID,Transaction Type,Amount,Description,Period Start,Period End,Payment Date',
  'PAY-2025-05,05/03/2025,TLB1001,Gross Sales,105.00,,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,05/03/2025,TLB1001,Commission,25.00,,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,05/03/2025,TLB1002,Gross Sales,200.00,,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,05/03/2025,TLB1002,Commission,60.00,,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,05/03/2025,TLB1002,Promotion Charge,20.00,Ramadan15,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,06/03/2025,TLB1003,Commission,20.00,,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,07/03/2025,TLB1005,Gross Sales,"1,260.00",,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,07/03/2025,TLB1005,Commission,300.00,,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,10/03/2025,,Chargeback,75.00,,01/03/2025,15/03/2025,29/03/2025',
  'PAY-2025-05,11/03/2025,,Manual Adjustment,120.00,,01/03/2025,15/03/2025,29/03/2025',
].join('\n');

/** HungerStation uses signed values and a semicolon delimiter in some exports. */
export const HUNGERSTATION_PAYOUT_CSV = [
  'Settlement ID;Date;Order Number;Type;Value;Notes;Settlement From;Settlement To;Transfer Date',
  'HS-9001;2025-03-05;HS-501;Sales;105.00;;2025-03-01;2025-03-15;2025-03-25',
  'HS-9001;2025-03-05;HS-501;Commission;-25.00;;2025-03-01;2025-03-15;2025-03-25',
  'HS-9001;2025-03-06;HS-502;Sales;210.00;;2025-03-01;2025-03-15;2025-03-25',
  'HS-9001;2025-03-06;HS-502;Commission;(52.50);;2025-03-01;2025-03-15;2025-03-25',
  'HS-9001;2025-03-07;;Adjustment;-40.00;;2025-03-01;2025-03-15;2025-03-25',
].join('\n');

export const JAHEZ_PAYOUT_CSV = [
  'Invoice No,Entry Date,Reference,Entry Type,Amount (SAR),Remarks,From Date,To Date',
  'JZ-77,03/03/2025,JZ-1,Total Sales,105.00,,01/03/2025,15/03/2025',
  'JZ-77,03/03/2025,JZ-1,Jahez Commission,26.25,,01/03/2025,15/03/2025',
  'JZ-77,04/03/2025,JZ-2,Total Sales,63.00,,01/03/2025,15/03/2025',
  'JZ-77,04/03/2025,JZ-2,Jahez Commission,15.75,,01/03/2025,15/03/2025',
  'JZ-77,05/03/2025,JZ-3,Mystery Fee,99.00,,01/03/2025,15/03/2025',
].join('\n');

/** The same Talabat layout with a renamed column — the drift case. */
export const TALABAT_PAYOUT_DRIFTED_CSV = [
  'Payout Reference,Transaction Date,Order ID,Txn Type,Net Amount,Description,Period Start,Period End,Payment Date',
  'PAY-2025-06,20/03/2025,TLB2001,Gross Sales,105.00,,16/03/2025,31/03/2025,14/04/2025',
].join('\n');

/** Nothing recognisable: an email body forwarded instead of the attachment. */
export const UNRECOGNISABLE_TEXT = [
  'Dear partner,',
  'Please find attached your settlement for the period.',
  'Regards, Partner Support',
].join('\n');
