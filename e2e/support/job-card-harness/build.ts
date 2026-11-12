import path from "node:path";
import { readFileSync } from "node:fs";
import { build, type Plugin } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const ROOT = path.resolve(__dirname, "../../..");
const HERE = __dirname;

/** "@/..." is src/...; the modules that only exist inside a Next.js server are swapped for the stubs next to this file. */
const stubs: Plugin = {
  name: "job-card-harness-stubs",
  setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.join(HERE, "link-stub.tsx") }));
    b.onResolve({ filter: /^@\/lib\/applications\/actions$/ }, () => ({ path: path.join(HERE, "actions-stub.ts") }));
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: path.join(ROOT, "tests/stubs/server-only.ts") }));
    b.onResolve({ filter: /^@\// }, (args) => b.resolve(path.join(ROOT, "src", args.path.slice(2)), { resolveDir: ROOT, kind: args.kind }));
  },
};

/** One self-contained HTML document: the real compiled app stylesheet, the REAL JobCard bundled, a #root. */
export async function buildJobCardHarnessHtml(): Promise<string> {
  const js = await build({
    entryPoints: [path.join(HERE, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    // Some modules the card imports read process.env at load; in a browser document there is no `process`.
    banner: { js: "var process = { env: {} };" },
    plugins: [stubs],
    logLevel: "silent",
  });
  const cssSource = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  const css = await postcss([tailwind({ base: ROOT })]).process(cssSource, { from: path.join(ROOT, "src/app/globals.css") });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body class="bg-paper text-ink"><div id="root"></div><script>window.__navigated=[];</script><script>${js.outputFiles[0].text.replace(/<\/script/g, "<\\/script")}</script></body></html>`;
}
