/**
 * The REAL stop controller (capability `agent-harness`, Requirement: *A Lecturer
 * Can Stop a Running Turn*), bound to a test's own fake session.
 *
 * It is a pure state machine over injected callbacks — no runtime, no provider,
 * no Electron — so a fake session carries the production object rather than a
 * stub of it. That keeps the tests below from drifting away from the controller
 * they stand in for, and it is why every one of them imports it from the
 * package's `./turn-stop` SUBPATH: several of these files mock `@cbe/pi-bridge`
 * wholesale, and the root specifier would be swallowed by that mock.
 *
 * The stop's own behaviour is exercised in `packages/pi-bridge/tests/`; here the
 * controller only has to exist and answer honestly for a session that is doing
 * nothing unusual.
 */
import { TurnStopController } from "@cbe/pi-bridge/turn-stop";

export function fakeTurnStop(session: { inFlight: boolean }): TurnStopController {
  return new TurnStopController({
    abort: async () => {},
    clearQueue: () => ({ steering: [], followUp: [] }),
    hasPendingTurn: () => session.inFlight,
    isCompacting: () => false,
  });
}
