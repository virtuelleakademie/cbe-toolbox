import path from "node:path";
import appPackage from "../../package.json";

/**
 * The one application-name owner for both electron-builder and CBE-owned
 * native labels. Importing the builder value avoids a second product-name
 * literal that could drift between development and packaged applications.
 */
export const APPLICATION_NAME = appPackage.build.productName;

/**
 * The one runtime path derivation for the generated application identity.
 * Development reads the committed build resource; a packaged app reads the
 * same generated PNG copied by electron-builder into `resources/icon.png`.
 */
export function runtimeAppIconPath({
  isPackaged,
  appPath,
  resourcesPath,
}: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string {
  return isPackaged ? path.join(resourcesPath, "icon.png") : path.join(appPath, "buildResources", "icon.png");
}

interface RuntimeIconImage {
  isEmpty(): boolean;
}

/** Set the generated PNG as the macOS development Dock identity after Electron is ready. */
export function setDevelopmentDockIcon<Image extends RuntimeIconImage>({
  platform,
  isPackaged,
  isReady,
  iconPath,
  createImage,
  setDockIcon,
}: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  isReady: boolean;
  iconPath: string;
  createImage: (imagePath: string) => Image;
  setDockIcon: ((image: Image) => void) | undefined;
}): void {
  if (platform !== "darwin" || isPackaged) return;
  if (!isReady) throw new Error("Cannot set the macOS development Dock icon before Electron is ready");
  if (!setDockIcon) throw new Error("Electron did not expose app.dock on macOS after readiness");

  const image = createImage(iconPath);
  if (image.isEmpty()) {
    throw new Error(`Cannot load the generated macOS development Dock icon at ${iconPath}`);
  }
  setDockIcon(image);
}
