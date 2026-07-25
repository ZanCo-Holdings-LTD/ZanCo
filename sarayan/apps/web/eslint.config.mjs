import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Next 16 removed `next lint`, so ESLint runs through its own CLI:
 * `npm run lint` from the workspace root.
 */
export default [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**"],
  },
  {
    rules: {
      // Server actions legitimately receive a `_previous` state they do not read.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
