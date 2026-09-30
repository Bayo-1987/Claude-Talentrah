/** A `.woff2` import resolves to its bundler-hashed URL, the same one the `url()` in the font's CSS resolves to. */
declare module "*.woff2" {
  const url: string;
  export default url;
}
