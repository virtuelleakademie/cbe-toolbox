import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CorpusStatus, presentCorpusRefresh } from "../src/renderer/components/CorpusStatus.js";
import { setActiveLanguage } from "../src/renderer/chrome.js";
import { LANGUAGES, stringsFor, type ChromeCatalogue, type InterfaceLanguage } from "../src/shared/i18n/index.js";
import type { CorpusInfo, CorpusRefreshResult } from "../src/shared/ipc-contract.js";

const INITIAL_INFO: CorpusInfo = { version: "2026-07", cacheDate: null, source: "bundled" };
const UPDATED_INFO: CorpusInfo = {
  version: "2026-08",
  cacheDate: "2026-07-09T12:00:00.000Z",
  source: "downloaded",
};

interface OutcomeCase {
  name: string;
  result: CorpusRefreshResult;
  expected: (t: ChromeCatalogue) => string;
  ok: boolean;
}

const OUTCOMES: OutcomeCase[] = [
  {
    name: "updated",
    result: { status: "updated", version: "2026-08" },
    expected: (t) => t.corpusUpdated({ version: "2026-08" }),
    ok: true,
  },
  {
    name: "up to date",
    result: { status: "up-to-date", version: "2026-07" },
    expected: (t) => t.corpusUpToDate({ version: "2026-07" }),
    ok: true,
  },
  {
    name: "integrity mismatch",
    result: { status: "integrity-mismatch", expected: "aa", actual: "bb" },
    expected: (t) => t.corpusIntegrityMismatch,
    ok: false,
  },
  {
    name: "unconfigured channel",
    result: { status: "unavailable", reason: { code: "not-configured" } },
    expected: (t) => t.corpusRefreshNotConfigured,
    ok: false,
  },
  {
    name: "pointer HTTP failure",
    result: { status: "unavailable", reason: { code: "pointer-http", httpStatus: 503 } },
    expected: (t) => t.corpusRefreshPointerHttp({ httpStatus: 503 }),
    ok: false,
  },
  {
    name: "pointer read failure",
    result: { status: "unavailable", reason: { code: "pointer-read" } },
    expected: (t) => t.corpusRefreshPointerRead,
    ok: false,
  },
  {
    name: "invalid pointer",
    result: { status: "unavailable", reason: { code: "pointer-invalid" } },
    expected: (t) => t.corpusRefreshPointerInvalid,
    ok: false,
  },
  {
    name: "download HTTP failure",
    result: { status: "unavailable", reason: { code: "download-http", httpStatus: 429 } },
    expected: (t) => t.corpusRefreshDownloadHttp({ httpStatus: 429 }),
    ok: false,
  },
  {
    name: "download read failure",
    result: { status: "unavailable", reason: { code: "download-read" } },
    expected: (t) => t.corpusRefreshDownloadRead,
    ok: false,
  },
  {
    name: "missing archive marker",
    result: { status: "unavailable", reason: { code: "missing-marker", markerFile: "index.json" } },
    expected: (t) => t.corpusRefreshMissingMarker({ markerFile: "index.json" }),
    ok: false,
  },
  {
    name: "unsafe archive entry",
    result: { status: "unavailable", reason: { code: "unsafe-entry", entryName: "../escape.txt" } },
    expected: (t) => t.corpusRefreshUnsafeEntry({ entryName: "../escape.txt" }),
    ok: false,
  },
  {
    name: "install failure",
    result: { status: "unavailable", reason: { code: "install-failed" } },
    expected: (t) => t.corpusRefreshInstallFailed,
    ok: false,
  },
  {
    name: "signed refusal",
    result: { status: "signed-refused", code: "equivocation", field: "indexContractSha256" },
    expected: (t) => t.corpusRefreshSignedRefused({ code: "equivocation", field: "indexContractSha256" }),
    ok: false,
  },
  {
    name: "signed transport failure",
    result: { status: "signed-unavailable", code: "redirect-refused" },
    expected: (t) => t.corpusRefreshSignedUnavailable({ code: "redirect-refused" }),
    ok: false,
  },
];

const MALFORMED_RESULTS: Array<{ name: string; value: unknown; leaked?: string }> = [
  { name: "null result", value: null },
  { name: "unknown status", value: { status: "surprise", code: "RAW-STATUS" }, leaked: "RAW-STATUS" },
  { name: "unknown reason", value: { status: "unavailable", reason: { code: "RAW-REASON" } }, leaked: "RAW-REASON" },
  { name: "missing HTTP data", value: { status: "unavailable", reason: { code: "pointer-http" } } },
  {
    name: "invalid HTTP data",
    value: { status: "unavailable", reason: { code: "download-http", httpStatus: "503 RAW" } },
    leaked: "503 RAW",
  },
  { name: "missing marker data", value: { status: "unavailable", reason: { code: "missing-marker" } } },
  { name: "empty entry data", value: { status: "unavailable", reason: { code: "unsafe-entry", entryName: "" } } },
  { name: "missing integrity data", value: { status: "integrity-mismatch", expected: "aa" } },
  {
    name: "legacy message-only result",
    value: { status: "unavailable", message: "LEGACY SECRET EXCEPTION" },
    leaked: "LEGACY SECRET EXCEPTION",
  },
  { name: "missing version", value: { status: "updated" } },
  { name: "unknown signed refusal", value: { status: "signed-refused", code: "RAW-SIGNED" }, leaked: "RAW-SIGNED" },
  {
    name: "unknown signed transport",
    value: { status: "signed-unavailable", code: "RAW-TRANSPORT" },
    leaked: "RAW-TRANSPORT",
  },
];

const LANGUAGE_ENTRIES = Object.entries(LANGUAGES);
const LANGUAGE_PAIRS = LANGUAGE_ENTRIES.map(
  ([code], index) => [code, LANGUAGE_ENTRIES[(index + 1) % LANGUAGE_ENTRIES.length]![0]] as const
);

function useLanguage(code: InterfaceLanguage): void {
  act(() => setActiveLanguage(code));
}

function installRefresh(result: unknown, infoAfter: CorpusInfo = UPDATED_INFO) {
  const getCorpusInfo = vi.fn().mockResolvedValueOnce(INITIAL_INFO).mockResolvedValueOnce(infoAfter);
  const refreshCorpus = vi.fn().mockResolvedValue(result);
  const sendPrompt = vi.fn();
  Object.assign(window.cbe, { getCorpusInfo, refreshCorpus, sendPrompt });
  return { getCorpusInfo, refreshCorpus, sendPrompt };
}

async function clickRefresh(t: ChromeCatalogue): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: t.corpusRefresh }));
  return screen.findByRole("status");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("Corpus version auditable from the app", () => {
  it("shows the loaded corpus version and cache date", async () => {
    Object.assign(window.cbe, { getCorpusInfo: vi.fn().mockResolvedValue(UPDATED_INFO) });
    render(<CorpusStatus />);
    expect(await screen.findByText(UPDATED_INFO.version!)).toBeTruthy();
    expect(screen.queryByText(stringsFor("en").corpusShippedWithApp)).toBeNull();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThanOrEqual(2);
  });

  it("Information surface identifies effective corpus in every language", async () => {
    for (const [code] of LANGUAGE_ENTRIES) {
      useLanguage(code);
      const t = stringsFor(code);
      Object.assign(window.cbe, {
        getCorpusInfo: vi.fn().mockResolvedValue({
          ...UPDATED_INFO,
          pack: {
            packId: "cbe-corpus",
            channel: "stable",
            epoch: 2,
            sequence: 7,
            version: "2026-08",
            source: "downloaded",
            sourceCommit: "a".repeat(40),
            manifestSha256: "b".repeat(64),
            signerKeyId: "corpus-stable-2",
            installedAt: UPDATED_INFO.cacheDate!,
          },
        }),
      });
      const { unmount } = render(<CorpusStatus />);
      expect(await screen.findByText(t.corpusPackIdentityLabel)).toBeTruthy();
      expect(
        screen.getByText(
          t.corpusPackIdentityValue({ channel: "stable", epoch: 2, sequence: 7, keyId: "corpus-stable-2" })
        )
      ).toBeTruthy();
      unmount();
    }
  });

  it("labels the bundled corpus from the catalogue", async () => {
    const t = stringsFor("en");
    Object.assign(window.cbe, { getCorpusInfo: vi.fn().mockResolvedValue(INITIAL_INFO) });
    render(<CorpusStatus />);
    expect(await screen.findByText(t.corpusShippedWithApp)).toBeTruthy();
  });
});

describe("every semantic refresh outcome resolves through every shipped catalogue", () => {
  it.each(LANGUAGE_ENTRIES.flatMap(([code]) => OUTCOMES.map((outcome) => ({ code, outcome }))))(
    "renders $outcome.name in $code",
    async ({ code, outcome }) => {
      useLanguage(code);
      const t = stringsFor(code);
      installRefresh(outcome.result);
      const { container } = render(<CorpusStatus />);
      await screen.findByText(INITIAL_INFO.version!);

      const status = await clickRefresh(t);
      expect(status.textContent).toBe(outcome.expected(t));
      expect(status.classList.contains(outcome.ok ? "set-note-ok" : "set-note-warn")).toBe(true);
      expect(within(container).getAllByRole("status")).toHaveLength(1);
    }
  );
});

describe("malformed and rejected refreshes use the safe catalogue fallback", () => {
  it.each(LANGUAGE_ENTRIES.flatMap(([code]) => MALFORMED_RESULTS.map((malformed) => ({ code, malformed }))))(
    "hides $malformed.name in $code",
    async ({ code, malformed }) => {
      useLanguage(code);
      const t = stringsFor(code);
      installRefresh(malformed.value);
      render(<CorpusStatus />);
      await screen.findByText(INITIAL_INFO.version!);

      const status = await clickRefresh(t);
      expect(status.textContent).toBe(t.corpusRefreshUnexpected);
      expect(status.textContent).not.toContain("undefined");
      if (malformed.leaked) expect(status.textContent).not.toContain(malformed.leaked);
    }
  );

  it.each(LANGUAGE_ENTRIES)("hides Error and non-Error rejections in %s", async (code) => {
    useLanguage(code);
    const t = stringsFor(code);
    const getCorpusInfo = vi.fn().mockResolvedValue(INITIAL_INFO);
    const refreshCorpus = vi
      .fn()
      .mockRejectedValueOnce(new Error("RAW ERROR SECRET"))
      .mockRejectedValueOnce("RAW NON-ERROR SECRET");
    Object.assign(window.cbe, { getCorpusInfo, refreshCorpus });
    render(<CorpusStatus />);
    await screen.findByText(INITIAL_INFO.version!);

    for (const secret of ["RAW ERROR SECRET", "RAW NON-ERROR SECRET"]) {
      const status = await clickRefresh(t);
      expect(status.textContent).toBe(t.corpusRefreshUnexpected);
      expect(status.textContent).not.toContain(secret);
    }
    expect((screen.getByRole("button", { name: t.corpusRefresh }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("post-refresh corpus-info failures preserve the outcome and prior info", () => {
  it.each(LANGUAGE_ENTRIES.flatMap(([code]) => OUTCOMES.map((outcome) => ({ code, outcome }))))(
    "keeps $outcome.name and adds the info warning in $code",
    async ({ code, outcome }) => {
      useLanguage(code);
      const t = stringsFor(code);
      const getCorpusInfo = vi
        .fn()
        .mockResolvedValueOnce(INITIAL_INFO)
        .mockRejectedValueOnce(new Error("RAW INFO SECRET"));
      Object.assign(window.cbe, {
        getCorpusInfo,
        refreshCorpus: vi.fn().mockResolvedValue(outcome.result),
      });
      render(<CorpusStatus />);
      await screen.findByText(INITIAL_INFO.version!);

      const status = await clickRefresh(t);
      expect(status.textContent).toBe(`${outcome.expected(t)} ${t.corpusInfoReloadFailed}`);
      expect(status.textContent).not.toContain("RAW INFO SECRET");
      expect(screen.getByText(INITIAL_INFO.version!)).toBeTruthy();
      expect(getCorpusInfo).toHaveBeenCalledTimes(2);
    }
  );
});

describe("visible and pending notices follow main-reported language changes", () => {
  const SWITCH_VARIANTS = [
    ...OUTCOMES,
    {
      name: "unexpected fallback",
      result: { status: "legacy", message: "RAW LEGACY" },
      expected: (t: ChromeCatalogue) => t.corpusRefreshUnexpected,
      ok: false,
    },
  ];

  it.each(SWITCH_VARIANTS)("re-resolves an existing $name without another request", async (variant) => {
    const [from, to] = LANGUAGE_PAIRS[0]!;
    useLanguage(from);
    const calls = installRefresh(variant.result);
    const view = render(<CorpusStatus />);
    await screen.findByText(INITIAL_INFO.version!);
    const original = await clickRefresh(stringsFor(from));
    expect(original.textContent).toBe(variant.expected(stringsFor(from)));

    useLanguage(to);
    const switched = screen.getByRole("status");
    expect(switched.textContent).toBe(variant.expected(stringsFor(to)));
    expect(calls.refreshCorpus).toHaveBeenCalledTimes(1);
    expect(calls.getCorpusInfo).toHaveBeenCalledTimes(2);
    expect(view.container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it.each(LANGUAGE_PAIRS)("finishes a pending refresh in the new language (%s → %s)", async (from, to) => {
    useLanguage(from);
    const pending = deferred<CorpusRefreshResult>();
    const getCorpusInfo = vi.fn().mockResolvedValue(INITIAL_INFO);
    const refreshCorpus = vi.fn(() => pending.promise);
    Object.assign(window.cbe, { getCorpusInfo, refreshCorpus });
    render(<CorpusStatus />);
    await screen.findByText(INITIAL_INFO.version!);
    fireEvent.click(screen.getByRole("button", { name: stringsFor(from).corpusRefresh }));
    expect(
      (screen.getByRole("button", { name: stringsFor(from).corpusRefreshing }) as HTMLButtonElement).disabled
    ).toBe(true);

    useLanguage(to);
    expect((screen.getByRole("button", { name: stringsFor(to).corpusRefreshing }) as HTMLButtonElement).disabled).toBe(
      true
    );
    await act(async () => pending.resolve({ status: "updated", version: "2026-08" }));

    expect((await screen.findByRole("status")).textContent).toBe(stringsFor(to).corpusUpdated({ version: "2026-08" }));
    expect(refreshCorpus).toHaveBeenCalledTimes(1);
    expect(getCorpusInfo).toHaveBeenCalledTimes(2);
  });

  it.each(LANGUAGE_PAIRS)("reports a pending info rejection in the new language (%s → %s)", async (from, to) => {
    useLanguage(from);
    const pendingInfo = deferred<CorpusInfo>();
    const getCorpusInfo = vi
      .fn()
      .mockResolvedValueOnce(INITIAL_INFO)
      .mockImplementationOnce(() => pendingInfo.promise);
    const refreshCorpus = vi.fn().mockResolvedValue({ status: "updated", version: "2026-08" });
    Object.assign(window.cbe, { getCorpusInfo, refreshCorpus });
    render(<CorpusStatus />);
    await screen.findByText(INITIAL_INFO.version!);
    fireEvent.click(screen.getByRole("button", { name: stringsFor(from).corpusRefresh }));
    await screen.findByRole("status");

    useLanguage(to);
    await act(async () => pendingInfo.reject(new Error("RAW PENDING INFO SECRET")));
    const t = stringsFor(to);
    expect(screen.getByRole("status").textContent).toBe(
      `${t.corpusUpdated({ version: "2026-08" })} ${t.corpusInfoReloadFailed}`
    );
    expect(screen.getByRole("status").textContent).not.toContain("RAW PENDING INFO SECRET");
    expect(refreshCorpus).toHaveBeenCalledTimes(1);
    expect(getCorpusInfo).toHaveBeenCalledTimes(2);
  });
});

describe("technical refresh data remains inert text", () => {
  const hostile = `" & <img src=x onerror=alert(1)>\n\`\`\``;
  const cases: OutcomeCase[] = [
    {
      name: "version",
      result: { status: "updated", version: hostile },
      expected: (t) => t.corpusUpdated({ version: hostile }),
      ok: true,
    },
    {
      name: "marker",
      result: { status: "unavailable", reason: { code: "missing-marker", markerFile: hostile } },
      expected: (t) => t.corpusRefreshMissingMarker({ markerFile: hostile }),
      ok: false,
    },
    {
      name: "entry",
      result: { status: "unavailable", reason: { code: "unsafe-entry", entryName: hostile } },
      expected: (t) => t.corpusRefreshUnsafeEntry({ entryName: hostile }),
      ok: false,
    },
  ];

  it.each(LANGUAGE_ENTRIES.flatMap(([code]) => cases.map((item) => ({ code, item }))))(
    "renders hostile $item.name data literally in $code",
    async ({ code, item }) => {
      useLanguage(code);
      const t = stringsFor(code);
      installRefresh(item.result);
      const { container } = render(<CorpusStatus />);
      await screen.findByText(INITIAL_INFO.version!);
      const status = await clickRefresh(t);

      expect(status.textContent).toBe(item.expected(t));
      expect(status.textContent).toContain(hostile);
      expect(container.querySelector("img, script, a, pre, code")).toBeNull();
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    }
  );
});

describe("refresh presentation stays outside the conversation and model boundary", () => {
  it.each([OUTCOMES[0]!, OUTCOMES[5]!, OUTCOMES[10]!])(
    "does not dispatch or mutate differently languaged conversation content for $name",
    async (outcome) => {
      const t = stringsFor("en");
      const calls = installRefresh(outcome.result);
      const conversation = "Guten Tag — bestehender Gesprächsinhalt";
      render(
        <>
          <div data-testid="conversation-fixture">{conversation}</div>
          <CorpusStatus />
        </>
      );
      await screen.findByText(INITIAL_INFO.version!);
      await clickRefresh(t);
      useLanguage(LANGUAGE_PAIRS[0]![1]);

      expect(screen.getByTestId("conversation-fixture").textContent).toBe(conversation);
      expect(calls.sendPrompt).not.toHaveBeenCalled();
      expect(calls.refreshCorpus).toHaveBeenCalledWith();
    }
  );

  it("keeps the projection free of legacy messages, HTML/Markdown rendering and language input", () => {
    const source = presentCorpusRefresh.toString();
    expect(source).not.toMatch(/result\.message|dangerouslySetInnerHTML|Markdown/);
    expect(source).not.toMatch(/interfaceLanguage|language:/);
  });
});
