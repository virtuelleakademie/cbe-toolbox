import js from "@eslint/js";

export default [
  { ignores: ["**/dist/**", "**/out/**", "**/node_modules/**", "public-site/**"] },
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 2022, sourceType: "module" } },
  // Node CLI scripts (.mjs) run under Node, not in a bare ES module sandbox.
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  // Cloudflare Pages worker: Workers runtime provides fetch-API globals; the
  // fetch handler's third argument is fixed by the platform signature.
  {
    files: ["plan/_worker.js", "plan/docs-review-api.js"],
    languageOptions: {
      globals: {
        Response: "readonly",
        Request: "readonly",
        TextDecoder: "readonly",
        btoa: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        Headers: "readonly",
        URL: "readonly",
        caches: "readonly",
      },
    },
    rules: {
      "no-control-regex": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  // Deployed browser assets for the Cloudflare Pages portal shell (plan/):
  // they run in the browser, where the DOM globals are provided by the platform.
  {
    files: [
      "plan/assets/**/*.js",
      "plan/widget/**/*.js",
      "plan/docs-review/**/*.js",
      "scripts/docs-review/static/**/*.js",
      "scripts/public-site/static/**/*.js",
    ],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        location: "readonly",
        history: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        URL: "readonly",
        queueMicrotask: "readonly",
        setTimeout: "readonly",
        requestAnimationFrame: "readonly",
        IntersectionObserver: "readonly",
        getComputedStyle: "readonly",
      },
    },
    rules: {
      "no-control-regex": "off",
      "no-unused-vars": ["error", { caughtErrorsIgnorePattern: "^_" }],
    },
  },
];
