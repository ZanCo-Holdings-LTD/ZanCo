import 'server-only';
import { repositories } from '@aggregatoriq/db';
import { findCoverageGaps, period, type Period } from '@aggregatoriq/core';
import { asUser } from './db';
import type { Membership } from './auth';

/**
 * Page-level reads.
 *
 * Each of these is one transaction under the signed-in user's identity, so every
 * query inside it is scoped by row-level security. Composing several repository
 * calls into one transaction also means a page renders a single consistent
 * snapshot rather than a mixture of moments.
 */

export async function dashboardData(membership: Membership) {
  return asUser(membership.user.id, async (tx) => {
    const [branches, aggregators, runs, recovered, summary] = await Promise.all([
      repositories.branches.listBranches(tx, membership.orgId),
      repositories.branches.listAggregators(tx),
      repositories.recon.listReconRuns(tx, membership.orgId, { limit: 20 }),
      repositories.disputes.totalRecovered(tx, membership.orgId),
      repositories.recon.summariseVariancesByCause(tx, membership.orgId),
    ]);

    return { branches, aggregators, runs, recovered, summary };
  });
}

export async function statementsData(membership: Membership) {
  return asUser(membership.user.id, async (tx) => {
    const [statements, branches, aggregators, addresses] = await Promise.all([
      repositories.ingestion.listStatements(tx, membership.orgId),
      repositories.branches.listBranches(tx, membership.orgId),
      repositories.branches.listAggregators(tx),
      repositories.ingestion.listIngestionAddresses(tx, membership.orgId),
    ]);

    return { statements, branches, aggregators, addresses };
  });
}

/**
 * Coverage gaps for a branch and aggregator.
 *
 * A missing period is itself a finding — orders with no statement covering them
 * are revenue nobody has checked. Computed on read rather than stored, because
 * it changes every time a statement arrives and a stale answer here would tell
 * someone a hole was filled when it was not.
 */
export async function coverageFor(
  membership: Membership,
  input: { branchId: string; aggregatorId: string; window: Period },
): Promise<Period[]> {
  const covered = await asUser(membership.user.id, (tx) =>
    repositories.canonical.listCoveredPeriods(tx, {
      orgId: membership.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
    }),
  );

  return findCoverageGaps(covered, input.window);
}

export async function reconRunsData(membership: Membership) {
  return asUser(membership.user.id, async (tx) => {
    const [runs, branches, aggregators] = await Promise.all([
      repositories.recon.listReconRuns(tx, membership.orgId, { limit: 50 }),
      repositories.branches.listBranches(tx, membership.orgId),
      repositories.branches.listAggregators(tx),
    ]);
    return { runs, branches, aggregators };
  });
}

export async function reconRunDetail(membership: Membership, runId: string) {
  return asUser(membership.user.id, async (tx) => {
    const run = await repositories.recon.getReconRun(tx, membership.orgId, runId);
    if (run === null) return null;

    const [variances, branches, aggregators] = await Promise.all([
      repositories.recon.listVariances(tx, membership.orgId, { reconRunId: runId }),
      repositories.branches.listBranches(tx, membership.orgId),
      repositories.branches.listAggregators(tx),
    ]);

    return { run, variances, branches, aggregators };
  });
}

/**
 * One finding, with the raw rows behind it resolved.
 *
 * This is the drill-through the brief calls the trust-building feature: from a
 * number, to the exact rows of the exact document it came from. It is not
 * compromised for performance — the row fetch is a second query rather than a
 * summary embedded in the variance.
 */
export async function varianceDetail(membership: Membership, varianceId: string) {
  return asUser(membership.user.id, async (tx) => {
    const variance = await repositories.recon.getVariance(tx, membership.orgId, varianceId);
    if (variance === null) return null;

    const sourceRows = await repositories.ingestion.getSourceRowsByIds(
      tx,
      variance.evidence.source_row_ids,
    );

    return { variance, sourceRows };
  });
}

export async function disputesData(membership: Membership) {
  return asUser(membership.user.id, async (tx) => {
    const [disputes, aggregators, recovered] = await Promise.all([
      repositories.disputes.listDisputes(tx, membership.orgId),
      repositories.branches.listAggregators(tx),
      repositories.disputes.totalRecovered(tx, membership.orgId),
    ]);
    return { disputes, aggregators, recovered };
  });
}

export async function settingsData(membership: Membership) {
  return asUser(membership.user.id, async (tx) => {
    const [branches, brands, aggregators, accounts, members, addresses] = await Promise.all([
      repositories.branches.listBranches(tx, membership.orgId),
      repositories.branches.listBrands(tx, membership.orgId),
      repositories.branches.listAggregators(tx),
      repositories.branches.listAggregatorAccounts(tx, membership.orgId),
      repositories.organisations.listMembers(tx, membership.orgId),
      repositories.ingestion.listIngestionAddresses(tx, membership.orgId),
    ]);
    return { branches, brands, aggregators, accounts, members, addresses };
  });
}

/** The last full month, the period a reconciliation defaults to. */
export function defaultPeriod(today: string): Period {
  const [year, month] = today.split('-').map(Number);
  if (year === undefined || month === undefined) return period(today, today);

  const start = new Date(Date.UTC(year, month - 2, 1));
  const end = new Date(Date.UTC(year, month - 1, 0));

  const iso = (value: Date): string => value.toISOString().slice(0, 10);
  return period(iso(start), iso(end));
}
