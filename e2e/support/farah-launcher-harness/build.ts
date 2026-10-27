import path from "node:path";
import { readFileSync } from "node:fs";
import { build, type Plugin } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const ROOT = path.resolve(__dirname, "../../..");
const HERE = __dirname;

/** "@/..." is src/...; the modules that only exist inside a Next.js server are swapped for the stubs next to this file. */
const stubs: Plugin = {
  name: "farah-launcher-harness-stubs",
  setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.join(HERE, "link-stub.tsx") }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.join(HERE, "navigation-stub.ts") }));
    b.onResolve({ filter: /^@\/lib\/auth\/actions$/ }, () => ({ path: path.join(HERE, "actions-stub.ts") }));
    b.onResolve({ filter: /^@\/lib\/auth\/switch-side$/ }, () => ({ path: path.join(HERE, "switch-side-stub.ts") }));
    b.onResolve({ filter: /^@\/lib\/profile\/settings-actions$/ }, () => ({ path: path.join(HERE, "settings-actions-stub.ts") }));
    b.onResolve({ filter: /^@\// }, (args) => b.resolve(path.join(ROOT, "src", args.path.slice(2)), { resolveDir: ROOT, kind: args.kind }));
  },
};

/** One self-contained HTML document: the real compiled app stylesheet, the bundled components, a #root. */
export async function buildHarnessHtml(): Promise<string> {
  const js = await build({
    entryPoints: [path.join(HERE, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [stubs],
    logLevel: "silent",
  });
  const cssSource = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  const css = await postcss([tailwind({ base: ROOT })]).process(cssSource, { from: path.join(ROOT, "src/app/globals.css") });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body class="bg-paper text-ink"><div id="root"></div><script>${js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
