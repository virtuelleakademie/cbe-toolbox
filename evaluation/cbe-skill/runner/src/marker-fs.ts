/**
 * Filesystem-backed crash-recovery marker. Lives at a STABLE path (not inside a
 * per-run timestamped dir) so a fresh invocation after a crash can find it. The
 * marker carries the iteration number and a full skill snapshot for revert.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import type { MarkerIO } from "./loop.js";

export class FsMarkerIO implements MarkerIO {
  constructor(private readonly markerPath: string) {}

  exists(): boolean {
    return existsSync(this.markerPath);
  }

  read(): { iteration: number; snapshot: Map<string, string> } | null {
    if (!this.exists()) return null;
    try {
      const raw = JSON.parse(readFileSync(this.markerPath, "utf8")) as {
        iteration: number;
        snapshot: Record<string, string>;
      };
      return { iteration: raw.iteration, snapshot: new Map(Object.entries(raw.snapshot)) };
    } catch {
      return null;
    }
  }

  write(iteration: number, snapshot: Map<string, string>): void {
    writeFileSync(this.markerPath, JSON.stringify({ iteration, snapshot: Object.fromEntries(snapshot) }), "utf8");
  }

  clear(): void {
    rmSync(this.markerPath, { force: true });
  }
}
