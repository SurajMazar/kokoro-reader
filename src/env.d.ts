/// <reference types="vite/client" />

/** True in the end-to-end test build (see scripts/manifest.ts). */
declare const __KOKORO_E2E__: boolean;

declare module '*.css?inline' {
  const css: string;
  export default css;
}
