/**
 * ADAPTER-TEST ONLY access to the Pi session behind a CBE port (capability
 * `agent-harness`, Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port*;
 * change `isolate-pi-behind-cbe-runtime`, task 2.3).
 *
 * Production code never reaches the Pi session: the port is a closure over it,
 * and `piSessionOf` is exported from no package entry point. Tests that prove
 * the ADAPTER itself — the composed system prompt, the registered tool
 * definitions, the seeded transcript, the active model — inspect the Pi session
 * through this one helper, and the boundary guard (`pi-boundary.test.ts`) keeps
 * every product module and product test away from it.
 */
export { piSessionOf } from "../../src/runtime/pi-session-port.js";
