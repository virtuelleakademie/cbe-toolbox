import { describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APPLICATION_NAME, runtimeAppIconPath, setDevelopmentDockIcon } from "../src/main/app-identity.js";
import { pngDimensions, inspectIcns, inspectIco, LINUX_SIZES } from "../scripts/icon-pipeline.mjs";
import { inspectLinuxIconArtifact } from "../scripts/inspect-linux-icon-artifact.mjs";

const appRoot = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8"));
const mainSource = readFileSync(path.join(appRoot, "src/main/index.ts"), "utf8");
const mainProcessSource = readdirSync(path.join(appRoot, "src/main"), { recursive: true })
  .filter((entry) => typeof entry === "string" && entry.endsWith(".ts"))
  .map((entry) => readFileSync(path.join(appRoot, "src/main", entry), "utf8"))
  .join("\n");
const settingsSource = readFileSync(path.join(appRoot, "src/renderer/components/SettingsPanel.tsx"), "utf8");
const renderedProductSource = ["main", "preload", "renderer", "shared"]
  .flatMap((surface) =>
    readdirSync(path.join(appRoot, "src", surface), { recursive: true })
      .filter((entry) => typeof entry === "string" && /\.(?:ts|tsx)$/u.test(entry))
      .map((entry) => readFileSync(path.join(appRoot, "src", surface, entry), "utf8"))
  )
  .join("\n");

describe("Scenario: Canonical runtime application name", () => {
  it("keeps the builder product name as the single CBE-owned label authority", () => {
    expect(APPLICATION_NAME).toBe(pkg.build.productName);
    expect(mainSource).toContain("() => APPLICATION_NAME");
    expect(mainSource).toContain("applicationName: APPLICATION_NAME");
  });

  it("does not let development naming mutate the established profile paths", () => {
    const defaultPaths = (appData: string, applicationName: string) => ({
      userData: path.join(appData, applicationName),
      sessionData: path.join(appData, applicationName),
    });
    expect(defaultPaths("/profile", "Electron")).not.toEqual(defaultPaths("/profile", APPLICATION_NAME));

    expect(mainProcessSource).not.toMatch(/\.setName\s*\(/);
    expect(mainProcessSource).not.toMatch(/setPath\s*\(\s*["'](?:userData|sessionData)["']/);
  });

  it("keeps the development framework bundle separate from packaged Finder identity", () => {
    expect(pkg.scripts.dev).toBe("electron-vite dev");
    expect(pkg.scripts["pack:mac"]).toContain("electron-builder --mac --arm64 --dir");
  });

  it("Cleanup preserves installed-application identity", () => {
    expect({ version: pkg.version, ...pkg.build }).toMatchObject({
      version: "0.1.23",
      appId: "com.bridgebinary.cbe-toolbox",
      productName: "CBE Toolbox",
      artifactName: "CBE-Toolbox-${version}-${arch}.${ext}",
      mac: { icon: "buildResources/icon.icns", target: ["dmg", "zip"] },
      win: { icon: "buildResources/icon.ico", target: ["nsis"] },
      linux: { icon: "buildResources/icons", target: ["AppImage"] },
      publish: [{ provider: "generic", url: "https://cbe-stories.pages.dev/update" }],
    });
    const supplierBranding = new RegExp(
      `${["Bridge", "Binary"].join("\\s*&\\s*")}|${["bridge", "binary"].join("")}`,
      "iu"
    );
    expect(renderedProductSource).not.toMatch(supplierBranding);
  });
});

describe("Scenario: Packaged targets and runtime surfaces carry the same identity", () => {
  it("keeps the current macOS, Windows and Linux targets while naming generated assets explicitly", () => {
    expect(pkg.build.directories.buildResources).toBe("buildResources");
    expect(pkg.build.mac).toMatchObject({ icon: "buildResources/icon.icns", target: ["dmg", "zip"] });
    expect(pkg.build.dmg.icon).toBe("buildResources/icon.icns");
    expect(pkg.build.win).toMatchObject({ icon: "buildResources/icon.ico", target: ["nsis"] });
    expect(pkg.build.nsis).toMatchObject({
      installerIcon: "buildResources/icon.ico",
      uninstallerIcon: "buildResources/icon.ico",
    });
    expect(pkg.build.linux).toMatchObject({ icon: "buildResources/icons", target: ["AppImage"] });
  });

  it("feeds valid target formats to every builder surface", () => {
    expect(
      inspectIcns(readFileSync(path.join(appRoot, "buildResources/icon.icns"))).map((entry) => entry.size)
    ).toEqual([16, 32, 64, 128, 256, 512, 1024]);
    expect(inspectIco(readFileSync(path.join(appRoot, "buildResources/icon.ico")))).toEqual([16, 32, 48, 64, 128, 256]);
    expect(pngDimensions(readFileSync(path.join(appRoot, "buildResources/icon.png")))).toEqual({
      width: 1024,
      height: 1024,
    });
  });

  it("copies the runtime PNG into packaged resources and derives its development/packaged paths", () => {
    expect(pkg.build.extraResources).toContainEqual({ from: "buildResources/icon.png", to: "icon.png" });

    const compiledMainDir = path.dirname(path.resolve(appRoot, pkg.main));
    expect(path.relative(appRoot, compiledMainDir)).toBe(path.join("out", "main"));
    const realDevelopmentIcon = runtimeAppIconPath({
      isPackaged: false,
      appPath: appRoot,
      resourcesPath: "/bundle/resources",
    });
    expect(realDevelopmentIcon).toBe(path.join(appRoot, "buildResources/icon.png"));
    expect(existsSync(realDevelopmentIcon)).toBe(true);
    expect(
      runtimeAppIconPath({
        isPackaged: true,
        appPath: "/bundle/resources/app.asar",
        resourcesPath: "/bundle/resources",
      })
    ).toBe(path.join("/bundle/resources", "icon.png"));
  });

  it("inspects AppImage desktop metadata, every hicolor payload and the runtime resource byte-for-byte", async () => {
    const extracted = mkdtempSync(path.join(os.tmpdir(), "cbe-appimage-icons-"));
    try {
      writeFileSync(
        path.join(extracted, "@cbeapp.desktop"),
        "[Desktop Entry]\nName=CBE Toolbox\nIcon=@cbeapp\nCategories=Education;\n"
      );
      for (const size of LINUX_SIZES) {
        const directory = path.join(extracted, "usr/share/icons/hicolor", `${size}x${size}`, "apps");
        mkdirSync(directory, { recursive: true });
        cpSync(path.join(appRoot, "buildResources/icons", `${size}x${size}.png`), path.join(directory, "@cbeapp.png"));
      }
      mkdirSync(path.join(extracted, "resources"));
      cpSync(path.join(appRoot, "buildResources/icon.png"), path.join(extracted, "resources/icon.png"));
      await expect(inspectLinuxIconArtifact(extracted)).resolves.toEqual({
        iconName: "@cbeapp",
        sizes: LINUX_SIZES,
      });

      writeFileSync(
        path.join(extracted, "@cbeapp.desktop"),
        "[Desktop Entry]\nName=CBE Toolbox\nIcon=electron\nCategories=Education;\n"
      );
      await expect(inspectLinuxIconArtifact(extracted)).rejects.toThrow(/branded icon/);
    } finally {
      rmSync(extracted, { recursive: true, force: true });
    }
  });

  it("wires BrowserWindow, validated development Dock image and package-owned About metadata without a tray", () => {
    expect(mainSource).toMatch(/new BrowserWindow\([\s\S]*icon: appIconPath\(\)/);
    expect(mainSource).toContain("setDevelopmentDockIcon({");
    expect(mainSource).toContain("nativeImage.createFromPath(imagePath)");
    expect(mainSource).toContain("isReady: app.isReady()");
    expect(mainSource).toContain("app.setAboutPanelOptions");
    expect(mainSource).toContain("applicationName: APPLICATION_NAME");
    expect(mainSource).toContain("applicationVersion: app.getVersion()");
    expect(mainSource).not.toMatch(/new Tray|Tray\(/);
  });

  it("reuses the generated build-resource PNG decoratively in the canonical About group", () => {
    expect(settingsSource).toContain('new URL("../../../buildResources/icon.png", import.meta.url).href');
    expect(settingsSource).toMatch(/<img src=\{APP_IDENTITY_ICON\} alt="" aria-hidden="true" \/>/);
    expect(settingsSource).not.toMatch(/https?:\/\/[^"']+\.(?:png|svg)/);
  });
});

describe("macOS development Dock identity", () => {
  function dockHarness(imageIsEmpty = false) {
    const image = { isEmpty: vi.fn(() => imageIsEmpty) };
    return {
      image,
      createImage: vi.fn(() => image),
      setDockIcon: vi.fn(),
    };
  }

  it("loads and sets a non-empty generated image on Darwin after readiness", () => {
    const harness = dockHarness();
    setDevelopmentDockIcon({
      platform: "darwin",
      isPackaged: false,
      isReady: true,
      iconPath: "/checkout/packages/app/buildResources/icon.png",
      createImage: harness.createImage,
      setDockIcon: harness.setDockIcon,
    });

    expect(harness.createImage).toHaveBeenCalledWith("/checkout/packages/app/buildResources/icon.png");
    expect(harness.image.isEmpty).toHaveBeenCalledOnce();
    expect(harness.setDockIcon).toHaveBeenCalledWith(harness.image);
  });

  it("fails visibly instead of retaining Electron's icon for a missing, unreadable or invalid image", () => {
    const harness = dockHarness(true);
    expect(() =>
      setDevelopmentDockIcon({
        platform: "darwin",
        isPackaged: false,
        isReady: true,
        iconPath: "/checkout/packages/app/buildResources/icon.png",
        createImage: harness.createImage,
        setDockIcon: harness.setDockIcon,
      })
    ).toThrow(/Cannot load.*buildResources\/icon\.png/);
    expect(harness.setDockIcon).not.toHaveBeenCalled();
  });

  it("does not load or set a Dock image before Electron readiness", () => {
    const harness = dockHarness();
    expect(() =>
      setDevelopmentDockIcon({
        platform: "darwin",
        isPackaged: false,
        isReady: false,
        iconPath: "/checkout/packages/app/buildResources/icon.png",
        createImage: harness.createImage,
        setDockIcon: harness.setDockIcon,
      })
    ).toThrow(/before Electron is ready/);
    expect(harness.createImage).not.toHaveBeenCalled();
    expect(harness.setDockIcon).not.toHaveBeenCalled();
  });

  it("fails visibly if Electron does not expose app.dock on Darwin after readiness", () => {
    const harness = dockHarness();
    expect(() =>
      setDevelopmentDockIcon({
        platform: "darwin",
        isPackaged: false,
        isReady: true,
        iconPath: "/checkout/packages/app/buildResources/icon.png",
        createImage: harness.createImage,
        setDockIcon: undefined,
      })
    ).toThrow(/did not expose app\.dock/);
    expect(harness.createImage).not.toHaveBeenCalled();
  });

  it.each(["linux", "win32"] as const)("does nothing on %s", (platform) => {
    const harness = dockHarness();
    setDevelopmentDockIcon({
      platform,
      isPackaged: false,
      isReady: true,
      iconPath: "/checkout/packages/app/buildResources/icon.png",
      createImage: harness.createImage,
      setDockIcon: harness.setDockIcon,
    });
    expect(harness.createImage).not.toHaveBeenCalled();
    expect(harness.setDockIcon).not.toHaveBeenCalled();
  });

  it("leaves packaged macOS Dock identity to the bundle ICNS", () => {
    const harness = dockHarness();
    setDevelopmentDockIcon({
      platform: "darwin",
      isPackaged: true,
      isReady: true,
      iconPath: "/bundle/resources/icon.png",
      createImage: harness.createImage,
      setDockIcon: harness.setDockIcon,
    });
    expect(harness.createImage).not.toHaveBeenCalled();
    expect(harness.setDockIcon).not.toHaveBeenCalled();
  });
});

describe("Scenario: Branding makes no trust claim", () => {
  it("keeps signing and icon ownership separate in package metadata", () => {
    expect(pkg.build.mac.icon).toBeTruthy();
    expect(pkg.build.win.icon).toBeTruthy();
    expect(pkg.build).not.toHaveProperty("forceCodeSigning", true);
    expect(pkg.build).not.toHaveProperty("notarize", true);
  });
});
