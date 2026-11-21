// Vite's `?worker&url` import: the URL of a bundled worker entry. Declared here so the
// package typechecks on its own; apps/web gets the same declaration from vite/client.
declare module '*?worker&url' {
  const url: string;
  export default url;
}
