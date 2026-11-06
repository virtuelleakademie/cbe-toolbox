import { describe, expect, it } from "vitest";
import { manifestBytes, publicKeySpkiBase64, signatureWrapperBytes, signedWrapper } from "@cbe/corpus-schema";
import {
  activatedTrust,
  initialTrustState,
  revalidateManifestFreshness,
  verifySignedKeyset,
  verifySignedManifest,
  type ContentPackTrustState,
} from "../src/main/content-pack-trust.js";
import {
  fixtureKey,
  fixtureKeyset,
  fixtureManifest,
  signKeyset,
  signManifest,
} from "./helpers/content-pack-fixture.js";

const buildTime = new Date("2026-10-18T00:00:00Z");
const now = new Date("2026-10-20T12:00:00Z");

function acceptKeyset(
  root: ReturnType<typeof fixtureKey>,
  keyset: ReturnType<typeof fixtureKeyset>,
  current: ContentPackTrustState,
  at = now
) {
  return verifySignedKeyset({
    ...signKeyset(keyset, root),
    rootPublicKeySpki: publicKeySpkiBase64(root.publicKey),
    rootKeyId: root.id,
    packId: "cbe-corpus",
    channel: "stable",
    metadataMaxBytes: 256 * 1024,
    current,
    now: at,
    appBuildTime: buildTime,
  });
}

function acceptManifest(
  target: ReturnType<typeof fixtureKey>,
  keyset: Exclude<ReturnType<typeof acceptKeyset>, { status: "refused" }>,
  sequence: number,
  options?: { epoch?: number; artifactSha256?: string; at?: Date; version?: string }
) {
  return verifySignedManifest({
    ...signManifest(
      fixtureManifest({
        epoch: options?.epoch ?? 1,
        sequence,
        artifactSha256: options?.artifactSha256,
        version: options?.version,
      }),
      target
    ),
    keyset,
    packId: "cbe-corpus",
    channel: "stable",
    metadataMaxBytes: 256 * 1024,
    now: options?.at ?? now,
    appBuildTime: buildTime,
    compatibility: () => ({ ok: true }),
  });
}

describe("content pack key lifecycle and rollback state", () => {
  it("accepts overlap rotation then durably refuses the revoked key", () => {
    const root = fixtureKey("root-v1");
    const oldKey = fixtureKey("corpus-stable-old");
    const nextKey = fixtureKey("corpus-stable-next");
    const initial = initialTrustState("cbe-corpus", "stable", buildTime);
    const overlap = acceptKeyset(
      root,
      fixtureKeyset({ keysetVersion: 1, targets: [{ key: oldKey }, { key: nextKey }] }),
      initial
    );
    if ("status" in overlap) throw new Error(overlap.code);
    expect(acceptManifest(oldKey, overlap, 1)).toMatchObject({ signerKeyId: oldKey.id });
    expect(acceptManifest(nextKey, overlap, 1)).toMatchObject({ signerKeyId: nextKey.id });

    const revoked = acceptKeyset(
      root,
      fixtureKeyset({
        keysetVersion: 2,
        targets: [{ key: oldKey, status: "revoked" }, { key: nextKey }],
      }),
      overlap.trust
    );
    if ("status" in revoked) throw new Error(revoked.code);
    expect(revoked.trust.revokedKeyIds).toContain(oldKey.id);
    expect(acceptManifest(oldKey, revoked, 2)).toMatchObject({ status: "refused", code: "key-revoked" });

    const attemptedUnrevoke = acceptKeyset(
      root,
      fixtureKeyset({ keysetVersion: 3, targets: [{ key: oldKey }, { key: nextKey }] }),
      revoked.trust
    );
    expect(attemptedUnrevoke).toMatchObject({ status: "refused", code: "key-revoked" });
  });

  it("refuses rollback and equal-sequence equivocation across restored trust state", () => {
    const root = fixtureKey("root-v1");
    const target = fixtureKey("corpus-stable-1");
    const keyset = acceptKeyset(
      root,
      fixtureKeyset({ targets: [{ key: target }] }),
      initialTrustState("cbe-corpus", "stable", buildTime)
    );
    if ("status" in keyset) throw new Error(keyset.code);
    const accepted = acceptManifest(target, keyset, 5);
    if ("status" in accepted) throw new Error(accepted.code);
    const restored = { ...keyset, trust: activatedTrust(accepted) };

    expect(acceptManifest(target, restored, 4)).toMatchObject({ status: "refused", code: "rollback" });
    expect(acceptManifest(target, restored, 5, { artifactSha256: "f".repeat(64) })).toMatchObject({
      status: "refused",
      code: "equivocation",
    });
    expect(acceptManifest(target, restored, 5)).toMatchObject({ replay: true });
  });

  it("allows only a root-authorized higher epoch to recover a sequence fast-forward", () => {
    const root = fixtureKey("root-v1");
    const compromised = fixtureKey("corpus-stable-compromised");
    const replacement = fixtureKey("corpus-stable-replacement");
    const firstKeyset = acceptKeyset(
      root,
      fixtureKeyset({ epoch: 1, targets: [{ key: compromised }] }),
      initialTrustState("cbe-corpus", "stable", buildTime)
    );
    if ("status" in firstKeyset) throw new Error(firstKeyset.code);
    const fastForward = acceptManifest(compromised, firstKeyset, 999);
    if ("status" in fastForward) throw new Error(fastForward.code);
    const trustedFastForward = activatedTrust(fastForward);

    const sameEpochReplacement = acceptKeyset(
      root,
      fixtureKeyset({ keysetVersion: 2, epoch: 1, targets: [{ key: replacement }] }),
      trustedFastForward
    );
    if ("status" in sameEpochReplacement) throw new Error(sameEpochReplacement.code);
    expect(acceptManifest(replacement, sameEpochReplacement, 1)).toMatchObject({ status: "refused", code: "rollback" });

    const recovery = acceptKeyset(
      root,
      fixtureKeyset({ keysetVersion: 3, epoch: 2, targets: [{ key: replacement }] }),
      sameEpochReplacement.trust
    );
    if ("status" in recovery) throw new Error(recovery.code);
    const recovered = acceptManifest(replacement, recovery, 1, { epoch: 2 });
    expect(recovered).toMatchObject({ manifest: { epoch: 2, sequence: 1 }, replay: false });
  });

  it("refuses expired and far-future metadata without invalidating local trust", () => {
    const root = fixtureKey("root-v1");
    const target = fixtureKey("corpus-stable-1");
    const current = initialTrustState("cbe-corpus", "stable", buildTime);
    const expired = acceptKeyset(
      root,
      fixtureKeyset({
        createdAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-03-31T00:00:00Z",
        targets: [{ key: target }],
      }),
      current
    );
    expect(expired).toMatchObject({ status: "refused", code: "metadata-expired" });

    const future = acceptKeyset(
      root,
      fixtureKeyset({
        createdAt: "2026-10-23T12:00:01Z",
        expiresAt: "2027-01-16T12:00:00Z",
        targets: [{ key: target }],
      }),
      current
    );
    expect(future).toMatchObject({ status: "refused", code: "metadata-from-future" });
    expect(current).toEqual(initialTrustState("cbe-corpus", "stable", buildTime));
  });

  it("Higher-sequence publication rolls back content regardless of semantic version", () => {
    const root = fixtureKey("root-v1");
    const target = fixtureKey("corpus-stable-1");
    const keyset = acceptKeyset(
      root,
      fixtureKeyset({ targets: [{ key: target }] }),
      initialTrustState("cbe-corpus", "stable", buildTime)
    );
    if ("status" in keyset) throw new Error(keyset.code);
    const current = acceptManifest(target, keyset, 5, { version: "2026-09" });
    if ("status" in current) throw new Error(current.code);
    const next = { ...keyset, trust: activatedTrust(current) };
    expect(acceptManifest(target, next, 6, { version: "2026-07" })).toMatchObject({
      manifest: { version: "2026-07", sequence: 6 },
    });
  });

  it("refuses keyset rollback and equal-version equivocation", () => {
    const root = fixtureKey("root-v1");
    const target = fixtureKey("corpus-stable-1");
    const initial = initialTrustState("cbe-corpus", "stable", buildTime);
    const version2 = acceptKeyset(root, fixtureKeyset({ keysetVersion: 2, targets: [{ key: target }] }), initial);
    if ("status" in version2) throw new Error(version2.code);
    expect(
      acceptKeyset(root, fixtureKeyset({ keysetVersion: 1, targets: [{ key: target }] }), version2.trust)
    ).toMatchObject({
      status: "refused",
      code: "keyset-rollback",
    });
    const other = fixtureKey("corpus-stable-other");
    expect(
      acceptKeyset(root, fixtureKeyset({ keysetVersion: 2, targets: [{ key: other }] }), version2.trust)
    ).toMatchObject({
      status: "refused",
      code: "keyset-equivocation",
    });
  });

  it("rechecks expiry immediately before activation and keeps trusted time monotone", () => {
    const root = fixtureKey("root-v1");
    const target = fixtureKey("corpus-stable-1");
    const keyset = acceptKeyset(
      root,
      fixtureKeyset({ targets: [{ key: target }] }),
      initialTrustState("cbe-corpus", "stable", buildTime)
    );
    if ("status" in keyset) throw new Error(keyset.code);
    const accepted = acceptManifest(target, keyset, 1);
    if ("status" in accepted) throw new Error(accepted.code);
    expect(revalidateManifestFreshness(accepted, new Date("2027-01-16T12:00:00Z"), buildTime)).toMatchObject({
      status: "refused",
      code: "metadata-expired",
    });
    const clockRollback = acceptKeyset(
      root,
      fixtureKeyset({ keysetVersion: 2, targets: [{ key: target }] }),
      { ...keyset.trust, greatestCreatedAt: "2027-01-16T12:00:00Z" },
      new Date("2026-01-01T00:00:00Z")
    );
    expect(clockRollback).toMatchObject({ status: "refused", code: "metadata-expired" });
  });

  it("rejects post-signature reserialization and wrapper key substitution", () => {
    const root = fixtureKey("root-v1");
    const target = fixtureKey("corpus-stable-1");
    const keyset = acceptKeyset(
      root,
      fixtureKeyset({ targets: [{ key: target }] }),
      initialTrustState("cbe-corpus", "stable", buildTime)
    );
    if ("status" in keyset) throw new Error(keyset.code);
    const manifest = fixtureManifest();
    const raw = manifestBytes(manifest);
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(raw).toString("utf8")), null, 2) + "\n");
    const signatureRaw = signatureWrapperBytes(signedWrapper(raw, target.id, target.privateKey));
    expect(
      verifySignedManifest({
        raw: reserialized,
        signatureRaw,
        keyset,
        packId: "cbe-corpus",
        channel: "stable",
        metadataMaxBytes: 256 * 1024,
        now,
        appBuildTime: buildTime,
        compatibility: () => ({ ok: true }),
      })
    ).toMatchObject({ status: "refused", code: "signature-invalid" });

    const substituted = signatureWrapperBytes(signedWrapper(raw, "unknown-key", target.privateKey));
    expect(
      verifySignedManifest({
        raw,
        signatureRaw: substituted,
        keyset,
        packId: "cbe-corpus",
        channel: "stable",
        metadataMaxBytes: 256 * 1024,
        now,
        appBuildTime: buildTime,
        compatibility: () => ({ ok: true }),
      })
    ).toMatchObject({ status: "refused", code: "key-not-authorized" });
  });
});
