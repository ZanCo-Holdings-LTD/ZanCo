import { parseEnv, webEnvSchema } from '@fieldnote/shared/env';
import type { WebEnv } from '@fieldnote/shared/env';

/**
 * Server-side environment.
 *
 * Importing this module from a client component is a build error, because it
 * reads secrets that must never reach a browser bundle. Client components read
 * `NEXT_PUBLIC_*` directly, which Next inlines at build time.
 */
import 'server-only';

export const env: WebEnv = parseEnv(webEnvSchema);
