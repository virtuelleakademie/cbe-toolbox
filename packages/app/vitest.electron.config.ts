import { defineConfig } from "vitest/config";

/**
 * The real-renderer layout check runs on its own, AFTER the ordinary suite.
 *
 * It launches Electron under Xvfb several times; sharing the default pool with the
 * parallel jsdom suite starves both and is exactly the load the repo's known
 * flakes need. `environment: "node"` (not jsdom) so the CDP client uses Node's
 * own global `WebSocket`/`fetch`, and no renderer setup file is loaded — there
 * is no `window` to stub here.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/first-use-onboarding-layout.test.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
