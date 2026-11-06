/**
 * Network sentinel for the contract harness (change
 * `guard-pi-upgrades-with-contract-tests`, Scenario: *Scripted provider
 * exercises the real runtime without network*).
 *
 * The scripted provider is the only model seam, so a contract run must never
 * open a connection. This records every attempt at the two places a request can
 * leave the process — the global `fetch` (the OpenAI client Pi uses) and every
 * TCP/IPC socket connect (undici, `http`, `https` and `net` all end there) — and
 * refuses it, so a regression shows up as a recorded attempt rather than as a
 * slow test waiting on an unreachable host.
 */
import { Socket } from "node:net";

export interface NetworkSentinel {
  /** Every attempted request or connection, in order. */
  readonly attempts: string[];
  restore(): void;
}

export function forbidNetwork(): NetworkSentinel {
  const attempts: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalConnect = Socket.prototype.connect;

  globalThis.fetch = ((input: unknown) => {
    attempts.push(`fetch ${String(input instanceof Request ? input.url : input)}`);
    return Promise.reject(new Error("contract harness: network access is forbidden"));
  }) as typeof fetch;
  Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
    attempts.push(`connect ${JSON.stringify(args[0])}`);
    throw new Error("contract harness: network access is forbidden");
  } as typeof Socket.prototype.connect;

  return {
    attempts,
    restore: () => {
      globalThis.fetch = originalFetch;
      Socket.prototype.connect = originalConnect;
    },
  };
}
