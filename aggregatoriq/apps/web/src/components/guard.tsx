import { getTranslations } from 'next-intl/server';
import {
  NoOrganisationError,
  NotAuthenticatedError,
  requireMembership,
  selectedOrgId,
  type Membership,
} from '@/lib/auth';
import { Card, EmptyState } from './ui';

/**
 * Resolve the acting organisation, or render why we cannot.
 *
 * Returning a node instead of throwing keeps the "signed in but no organisation
 * yet" case a normal screen rather than an error page. That state is the first
 * thing a new user sees, and an error boundary is the wrong greeting.
 */
export type GuardResult =
  | { readonly ok: true; readonly membership: Membership }
  | { readonly ok: false; readonly node: React.ReactNode };

export async function guard(): Promise<GuardResult> {
  const t = await getTranslations('errors');

  try {
    const preferred = await selectedOrgId();
    return { ok: true, membership: await requireMembership(preferred) };
  } catch (error) {
    if (error instanceof NotAuthenticatedError) {
      return {
        ok: false,
        node: (
          <Card>
            <EmptyState title={t('notSignedIn')} />
          </Card>
        ),
      };
    }

    if (error instanceof NoOrganisationError) {
      return {
        ok: false,
        node: (
          <Card>
            <EmptyState title={t('noOrganisation')} />
          </Card>
        ),
      };
    }

    throw error;
  }
}
