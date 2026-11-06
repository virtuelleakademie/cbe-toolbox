import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    // The Electron/Xvfb layout check has its own config and runs after this
    // suite — see `vitest.electron.config.ts`.
    exclude: ["**/node_modules/**", "tests/first-use-onboarding-layout.test.ts"],
    setupFiles: ["tests/vitest.setup.ts"],
  },
});
