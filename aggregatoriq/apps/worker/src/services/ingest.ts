/**
 * Ingestion: bytes in, canonical rows out.
 *
 * The order of operations is load-bearing and worth reading in sequence:
 *
 *   1. Store the original file. Before anything else, so that a parser crash
 *      never loses a customer's statement.
 *   2. Write the raw rows. Immutable, and the thing replay works from.
 *   3. Parse. If this fails, steps 1 and 2 stand and the document lands in the
 *      review queue with its evidence intact.
 *   4. Map to canonical, resolving each parsed record's row index to the real
 *      source-row id. Lineage is established here and never inferred later.
 *
 * Nothing in this file interprets an amount. It moves data between layers and
 * defers every judgement to the parsers and the engine.
 */
import type { AggregatorCode, Currency, SourceDocumentKind } from '@aggregatoriq/core';
import { repositories, type Database, type Transaction } from '@aggregatoriq/db';
import { withoutTenantScope } from '@aggregatoriq/db';
import {
  parseDocument,
  parseStatusFor,
  type ParseOutput,
  type ParserContext,
} from '@aggregatoriq/parsers';
import { checksumOf, documentPath, type Storage } from '../storage.js';

export interface IngestInput {
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregatorId: string;
  readonly aggregatorCode: AggregatorCode;
  readonly currency: Currency;
  readonly timezone: string;
  readonly filename: string | null;
  readonly receivedVia: 'upload' | 'email' | 'free_audit';
  readonly content: Buffer;
}

export interface IngestResult {
  readonly documentId: string;
  readonly duplicate: boolean;
  readonly parseStatus: 'pending' | 'parsed' | 'partially_parsed' | 'needs_review' | 'failed';
  readonly rung: 'deterministic' | 'extraction' | 'manual_review';
  readonly parserKey: string | null;
  readonly ordersWritten: number;
  readonly payoutsWritten: number;
  readonly problems: number;
  readonly message: string;
}

export async function ingestDocument(
  db: Database,
  storage: Storage,
  input: IngestInput,
): Promise<IngestResult> {
  const checksum = checksumOf(input.content);
  const path = documentPath({
    orgId: input.orgId,
    branchId: input.branchId,
    checksum,
    filename: input.filename,
  });

  // Step 1: the original bytes, before anything can go wrong.
  const stored = await storage.put(path, input.content);

  const registration = await withoutTenantScope(db, (tx) =>
    repositories.ingestion.registerSourceDocument(tx, {
      orgId: input.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
      kind: 'unknown',
      storagePath: stored.path,
      originalFilename: input.filename,
      receivedVia: input.receivedVia,
      checksum,
      byteSize: stored.byteSize,
    }),
  );

  if (registration.duplicate) {
    return {
      documentId: registration.id,
      duplicate: true,
      parseStatus: 'parsed',
      rung: 'deterministic',
      parserKey: null,
      ordersWritten: 0,
      payoutsWritten: 0,
      problems: 0,
      message:
        'We already have this exact file, so nothing was imported again. Re-forwarding a ' +
        'statement is harmless — it will not double-count anything.',
    };
  }

  const context: ParserContext = {
    aggregatorCode: input.aggregatorCode,
    currency: input.currency,
    timezone: input.timezone,
  };

  const text = input.content.toString('utf8');
  const attempt = parseDocument(text, input.aggregatorCode, context);

  if (attempt.output === null) {
    // Steps 1 and 2 still happen for an unparseable document: the file is kept,
    // and a human sees why nothing came of it.
    await withoutTenantScope(db, (tx) =>
      repositories.ingestion.recordParseResult(tx, {
        documentId: registration.id,
        parseStatus: attempt.route.rung === 'manual_review' ? 'needs_review' : 'needs_review',
        parseMethod: null,
        parserKey: null,
        parserVersion: null,
        headerFingerprint: null,
        periodStart: null,
        periodEnd: null,
        rowCount: 0,
        parseError:
          attempt.error ??
          (attempt.route.rung === 'manual_review'
            ? attempt.route.reason
            : attempt.route.drift.message),
      }),
    );

    return {
      documentId: registration.id,
      duplicate: false,
      parseStatus: 'needs_review',
      rung: attempt.route.rung,
      parserKey: null,
      ordersWritten: 0,
      payoutsWritten: 0,
      problems: 0,
      message:
        attempt.error ??
        (attempt.route.rung === 'manual_review'
          ? attempt.route.reason
          : attempt.route.drift.message),
    };
  }

  const output = attempt.output;
  const written = await withoutTenantScope(db, async (tx) => {
    // Step 2: raw rows, immutable, in document order.
    const rowIds = await repositories.ingestion.insertSourceRows(tx, {
      sourceDocumentId: registration.id,
      orgId: input.orgId,
      rows: output.rawRows,
    });

    // Step 4: canonical, with every record pointing at a real raw row.
    return persistCanonical(tx, {
      orgId: input.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
      currency: input.currency,
      documentId: registration.id,
      rowIds,
      output,
    });
  });

  const status = parseStatusFor(output);

  await withoutTenantScope(db, (tx) =>
    repositories.ingestion.recordParseResult(tx, {
      documentId: registration.id,
      parseStatus: status,
      parseMethod: output.method,
      parserKey: output.parserKey,
      parserVersion: output.parserVersion,
      headerFingerprint: output.headerFingerprint,
      periodStart: output.periodStart,
      periodEnd: output.periodEnd,
      rowCount: output.rawRows.length,
      parseError: null,
      kind: output.kind as SourceDocumentKind,
    }),
  );

  return {
    documentId: registration.id,
    duplicate: false,
    parseStatus: status,
    rung: 'deterministic',
    parserKey: output.parserKey,
    ordersWritten: written.orders,
    payoutsWritten: written.payouts,
    problems: output.problems.length,
    message:
      output.problems.length === 0
        ? `Imported ${written.orders} order(s) and ${written.payouts} statement(s).`
        : `Imported ${written.orders} order(s) and ${written.payouts} statement(s), with ` +
          `${output.problems.length} row(s) we could not read. Those rows were skipped rather ` +
          `than counted as zero — open the statement to see which.`,
  };
}

interface PersistInput {
  orgId: string;
  branchId: string;
  aggregatorId: string;
  currency: Currency;
  documentId: string;
  rowIds: readonly string[];
  output: ParseOutput;
}

async function persistCanonical(
  tx: Transaction,
  input: PersistInput,
): Promise<{ orders: number; payouts: number }> {
  const { rowIds, output } = input;

  /**
   * A parsed record's `sourceRowIndex` is its position in the document; the
   * inserted rows come back in the same order. If they do not line up, we stop
   * rather than attach a value to the wrong row — a variance citing the wrong
   * evidence is worse than no variance.
   */
  const rowIdAt = (index: number): string => {
    const id = rowIds[index];
    if (id === undefined) {
      throw new Error(
        `Parsed record cites row ${index} but only ${rowIds.length} raw rows were written. ` +
          `Refusing to guess at the lineage.`,
      );
    }
    return id;
  };

  const orders = output.orders.map((order) => ({
    orgId: input.orgId,
    branchId: input.branchId,
    aggregatorId: input.aggregatorId,
    externalOrderId: order.externalOrderId,
    orderedAt: order.orderedAt,
    localDate: order.localDate,
    grossAmountMinor: order.grossAmountMinor,
    itemTotalMinor: order.itemTotalMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    vatAmountMinor: order.vatAmountMinor,
    discountTotalMinor: order.discountTotalMinor,
    promoFunding: order.promoFunding,
    status: order.status,
    currency: order.currency,
    sourceRowId: rowIdAt(order.sourceRowIndex),
  }));

  const orderCount = await repositories.canonical.upsertOrders(tx, orders);

  let payoutCount = 0;
  for (const payout of output.payouts) {
    const lines = payout.lines.map((line) => ({
      externalOrderId: line.externalOrderId,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      currency: line.currency,
      description: line.description,
      reference: line.reference,
      sourceRowId: rowIdAt(line.sourceRowIndex),
    }));

    const gross = lines
      .filter((line) => line.lineType === 'gross_sale')
      .reduce((total, line) => total + line.amountMinor, 0);
    const deductions = lines
      .filter((line) => line.amountMinor < 0)
      .reduce((total, line) => total + line.amountMinor, 0);

    await repositories.canonical.upsertPayoutWithLines(tx, {
      orgId: input.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
      externalPayoutId: payout.externalPayoutId,
      periodStart: payout.periodStart,
      periodEnd: payout.periodEnd,
      grossMinor: gross,
      deductionsMinor: deductions,
      netMinor: gross + deductions,
      currency: input.currency,
      paidOn: payout.paidOn,
      sourceDocumentId: input.documentId,
      sourceRowId: rowIdAt(payout.sourceRowIndex),
      lines,
    });
    payoutCount += 1;
  }

  return { orders: orderCount, payouts: payoutCount };
}
