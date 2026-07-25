import type { Config } from 'tailwindcss';
import logical from 'tailwindcss-logical';

/**
 * Logical properties throughout.
 *
 * The plugin gives `ms-*` / `me-*` / `ps-*` / `pe-*` / `start-*` / `end-*` in
 * place of their left/right equivalents, so the same class list lays out
 * correctly in English and Arabic. This is not a nice-to-have — the GCC
 * vertical has Arabic-speaking field crews, and a UI that mirrors incorrectly
 * is a UI nobody in that market trusts.
 *
 * Physical direction classes (`ml-`, `pr-`, `left-`, `text-left`) are a bug in
 * this codebase unless the thing genuinely has a physical direction, like an
 * audio waveform.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Amber is load-bearing: it marks a value a human must check before
        // export unlocks. It is deliberately the only warm colour in the UI.
        amber: {
          bg: '#fef6e4',
          border: '#e8b931',
          text: '#8a6100',
        },
        ink: {
          DEFAULT: '#1a1a1a',
          muted: '#5c5c5c',
          faint: '#8f8f8f',
        },
        paper: '#fbfbf9',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [logical],
} satisfies Config;
