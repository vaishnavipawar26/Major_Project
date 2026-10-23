import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

// Catches undefined names (a missing import) before they crash a page at runtime. Deliberately small: only correctness rules.
export default [
  { ignores: ["dist/**", "node_modules/**", "src/test-fixtures/**"] },
  {
    files: ["**/*.{js,jsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: "18.3" } },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "no-unused-vars": ["warn", { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_", caughtErrors: "none" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-dupe-keys": "error",
      "no-redeclare": "error",
      "no-unreachable": "error",
    },
  },
  {
    files: ["**/*.test.{js,jsx}", "src/**/*.test.*"],
    languageOptions: { globals: { ...globals.browser, ...globals.node, vi: "readonly", describe: "readonly", it: "readonly", expect: "readonly", beforeEach: "readonly", afterEach: "readonly" } },
  },
];
