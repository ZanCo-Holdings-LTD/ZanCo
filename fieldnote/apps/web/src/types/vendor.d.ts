/**
 * `tailwindcss-logical` ships no type declarations. It is what gives us
 * `ms-*` / `me-*` / `ps-*` / `pe-*` / `start-*` / `end-*`, which the entire UI
 * depends on for RTL — so it is declared here rather than silenced with a cast
 * at the import site.
 */
declare module 'tailwindcss-logical' {
  const plugin: { handler: (...args: unknown[]) => void };
  export default plugin;
}
