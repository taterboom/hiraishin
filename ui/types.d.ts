/** CSS imported by the overlay bundle arrives as a string so it can be injected into a shadow root. */
declare module '*.css' {
  const contents: string;
  export default contents;
}
