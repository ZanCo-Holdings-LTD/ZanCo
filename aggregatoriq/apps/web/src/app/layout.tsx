import type { ReactNode } from 'react';

/**
 * The root layout renders nothing but its children.
 *
 * `html` and `body` are emitted by the locale layout, because both need the
 * `lang` and `dir` attributes and those are not known until the locale is
 * resolved. Setting `dir` after hydration instead would show every Arabic user
 * a left-to-right flash of the whole application.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
