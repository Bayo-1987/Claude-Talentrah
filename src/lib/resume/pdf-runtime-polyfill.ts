import "server-only";

/**
 * Browser globals that pdfjs-dist's legacy Node build expects to exist at
 * IMPORT time — installed here so importing `pdf-parse` cannot crash.
 *
 * ── The production outage this fixes ──────────────────────────────────────
 *
 * `POST /api/resume/parse` returned 500 on production with:
 *
 *   Warning: Cannot load "@napi-rs/canvas" package: Cannot find module '@napi-rs/canvas'
 *   Warning: Cannot polyfill `DOMMatrix`, rendering may be broken.
 *   Error: Failed to load external module pdf-parse-…: ReferenceError: DOMMatrix is not defined
 *
 * This is NOT the bug PR #21 fixed. That one was worker-path resolution, and
 * `serverExternalPackages` still correctly handles it. This is a different
 * mechanism with the same symptom.
 *
 * The cause, read out of the dependency rather than inferred:
 * `pdfjs-dist/legacy/build/pdf.mjs` line 15620 is
 *
 *     const SCALE_MATRIX = new DOMMatrix();
 *
 * at MODULE SCOPE. It runs the moment the module is imported, before any PDF
 * is touched. pdf.js normally satisfies it a few lines earlier by pulling
 * `DOMMatrix` off `@napi-rs/canvas` — through a try/catch `require()`, which is
 * precisely the pattern Vercel's dependency tracer cannot see. The package is
 * installed at build time (it is an optional dependency, resolved in
 * package-lock.json) and simply never copied into the deployed function.
 *
 * ── Why a stub rather than forcing the package into the bundle ────────────
 *
 * `outputFileTracingIncludes` would also work, and was the obvious fix. It is
 * not the one taken, because measuring first showed it isn't needed:
 *
 *   with @napi-rs/canvas hidden + this stub:
 *     getText OK -> "Amaka Obi\nBackend engineer, Lagos\n\n-- 1 of 1 --"
 *
 * Canvas is pdf.js's RENDERING dependency. This route only ever extracts text
 * — it never rasterises a page — so the real implementation is never used, only
 * constructed. Shipping a ~10MB platform-specific native binary into every
 * deployment of this function to satisfy a constructor call would be paying a
 * real cost for a code path we never take, and would leave the fix dependent on
 * the tracer continuing to behave and on naming the right
 * `@napi-rs/canvas-linux-x64-gnu` variant for the runtime. This has neither
 * dependency: it cannot regress when the tracer changes, when the platform
 * changes, or when the optional dependency set is reshuffled by a bump.
 *
 * An earlier revision tried to load the real `@napi-rs/canvas` first and fall
 * back to the stubs — nicer in principle, and it broke the build: Turbopack
 * rejects a `createRequire` of a package listed in `serverExternalPackages`
 * with "non-ecmascript placeable asset". Not worth working around for a code
 * path this route never takes; the stubs are unconditional, and the comment
 * below says what would have to change if that stops being true.
 *
 * ── The limit, stated ─────────────────────────────────────────────────────
 *
 * These stubs are sufficient for text extraction and nothing else. They are
 * geometrically inert — an identity matrix that ignores every transform. If a
 * future feature renders a PDF page to an image (a thumbnail, a preview), it
 * will produce silently wrong output rather than failing, and that feature must
 * add `@napi-rs/canvas` as a real dependency and force it into the trace. The
 * real object is preferred whenever it is actually available, below.
 */

/*
 * Assigned through an index signature rather than the DOM lib's own types.
 * TypeScript resolves `globalThis.ImageData`/`Path2D` to the full browser
 * interfaces, and these stubs deliberately implement only what pdf.js touches
 * during text extraction — satisfying the real interface would mean writing a
 * canvas, which is the thing this module exists to avoid.
 */
type GlobalWithPdfShims = Record<string, unknown>;

/** Identity-only. Every mutator returns `this` so chained calls don't throw. */
class InertDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[] | string) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }
  }

  multiplySelf() {
    return this;
  }
  preMultiplySelf() {
    return this;
  }
  invertSelf() {
    return this;
  }
  translate() {
    return this;
  }
  scale() {
    return this;
  }
}

class InertPath2D {
  addPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
}

/**
 * Idempotent, and safe to call from multiple entry points — it only ever fills
 * a global that is missing, so a runtime that already has the real thing (a
 * browser, or a Node process where @napi-rs/canvas did load) keeps it.
 */
export function ensurePdfRuntimeGlobals(): void {
  const g = globalThis as unknown as GlobalWithPdfShims;

  // Only ever fills a global that is missing, so a runtime that genuinely has
  // these (a browser, or a Node process where pdf.js already self-polyfilled
  // from a real canvas) keeps the real implementation.
  if (!g.DOMMatrix) g.DOMMatrix = InertDOMMatrix;

  // Neither of these is module-scope in the current pdfjs build, so neither is
  // load-bearing today. Stubbed because the same warning names all three, and a
  // future version promoting one to module scope would be the identical outage.
  if (!g.ImageData) {
    g.ImageData = class {
      constructor(
        public width = 0,
        public height = 0,
      ) {}
    };
  }
  if (!g.Path2D) g.Path2D = InertPath2D;
}
