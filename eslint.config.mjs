// Obsidian official lint — mirrors obsidian-sample-plugin's eslint.config.mts.
// The recommended set includes eslint core + typescript-eslint type-checked +
// Obsidian-specific rules (the same ones the plugin store's CI runs).
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // Global excludes: build artifacts, never linted (a config object with ONLY
  // `ignores` acts as a global exclusion in flat config).
  {
    ignores: ["main.js", "coverage/**"],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "stylelint.config.mjs"],
        },
      },
    },
  },
  {
    // Build/test tooling configs: Node built-ins are fine there (build machine
    // and test runner only; these files never ship to mobile).
    files: [
      "esbuild.config.mjs",
      "vitest.config.ts",
      "eslint.config.mjs",
      "stylelint.config.mjs",
    ],
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
  {
    // Tests create DETACHED host elements (document.createElement) by design —
    // document.createDiv() would auto-attach to the document and throw (DOM
    // allows only one root element; verified in Chromium against Obsidian's own
    // enhance.js semantics). The official market bot lints src/ only.
    files: ["src/**/*.test.ts", "test/**/*.ts"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
      // The polyfill file itself must define ambient globals; globalThis is
      // the correct (and only) target under jsdom, which has no popout windows.
      "obsidianmd/no-global-this": "off",
    },
  },
]);
