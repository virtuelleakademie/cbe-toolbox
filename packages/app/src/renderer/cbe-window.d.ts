import type { CbeApi } from "../preload/index.js";

declare global {
  interface Window {
    cbe: CbeApi;
  }
}

export {};
