/** CSS imported by the overlay bundle arrives as a string so it can be injected into a shadow root. */
declare module '*.css' {
  const contents: string;
  export default contents;
}

/** True only in `HIRAISHIN_TRACE=1` builds, which record wheel gestures (ui/overlay/trace.ts). */
declare const __TRACE__: boolean;
