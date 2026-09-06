import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These two rules come from the React Compiler-readiness ruleset
      // bundled with eslint-config-next. This app does not enable the React
      // Compiler (see next.config.ts), and several interactive components
      // (drag/scatter positioning, the Strudel scope popup, window focus
      // state) intentionally use patterns these rules flag as unsafe for a
      // compiled build but that are fine today. Kept as warnings so they
      // stay visible for a future compiler-adoption pass instead of
      // blocking the build.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Plain CommonJS prod server script, not part of the Next.js app build.
    "server.js",
    "tools/**",
  ]),
]);

export default eslintConfig;
