import { test } from "@playwright/test";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { extractPdfText } from "./support/pdf-text";

// THROWAWAY DIAGNOSTIC (send-473) — never merged. Logs only; never asserts.

const S = {
  s1: "Professional certifications and key projects: AWS Certified Solutions Architect, PMP certification, TypeScript and Kubernetes.",
  s2: "Led the migration of the settlement ledger to an event-sourced model, cutting incident triage time in half across three teams.",
  s3: "ZQCERTIFICATIONS ZQPROJECTS ZQSKILLS ZQEXPERIENCE ZQEDUCATION ZQSUMMARY",
  s4: "PROFESSIONAL CERTIFICATIONS KEY PROJECTS EDUCATION",
};

function words(text: string): string[] {
  return [...new Set((text.match(/[A-Za-z]{3,}/g) ?? []))];
}
function missingWords(source: string[], extracted: string): string[] {
  return source.filter((w) => !new RegExp(`(^|[^A-Za-z])${w}([^A-Za-z]|$)`, "i").test(extracted));
}

function pdftotext(pdf: Buffer): string | null {
  const path = "/tmp/zz-probe.pdf";
  writeFileSync(path, pdf);
  const run = () => execSync(`pdftotext -raw ${path} -`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    return run();
  } catch {
    if (!process.env.CI) return null;
    try {
      execSync("sudo apt-get update -qq && sudo apt-get install -y -qq poppler-utils", { stdio: "ignore" });
      return run();
    } catch {
      return null;
    }
  }
}

function segments(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = text.split(/\[(F\d\d)\]/);
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

test("font matrix extraction v2 (one block per page)", async ({ page }) => {
  await page.goto("/dev/font-probe");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const notes: Record<string, string> = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("section")].map((s) => {
      const t = (s.querySelector("p")?.textContent ?? "");
      return [t.slice(1, 4), t.slice(6)];
    })));
  const prose: string[] = await page.evaluate(() => [...document.querySelectorAll("section")[0].querySelectorAll("p")].slice(1).map((p) => p.textContent ?? ""));
  const sourceWords = words(prose.join(" "));
  const pdf = await page.pdf({ printBackground: true });
  // per-page text
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: pdf });
  const r = await parser.getText();
  await parser.destroy();
  const pdfjsPages = (r.pages ?? []).map((p: { text: string }) => p.text);
  const pop = pdftotext(pdf);
  const popPages = pop === null ? null : pop.split("\f");
  console.log(`MATRIX2 sourceWords=${sourceWords.length} pdfjsPages=${pdfjsPages.length} popplerPages=${popPages?.length ?? "n/a"}`);
  for (const [engine, pages] of [["pdfjs", pdfjsPages], ["poppler", popPages]] as const) {
    if (!pages) continue;
    for (const pageText of pages) {
      const idm = pageText.match(/\[(F\d\d)\]/);
      if (!idm) continue;
      const id = idm[1];
      const miss = missingWords(sourceWords, pageText);
      const snippets = miss.slice(0, 6).map((w) => {
        const i = pageText.toLowerCase().indexOf(w.slice(0, 4).toLowerCase());
        return i < 0 ? `${w}=>(absent)` : `${w}=>${JSON.stringify(pageText.slice(i, i + w.length + 4))}`;
      });
      console.log(`MATRIX2 ${engine} ${id} [${notes[id] ?? ""}] missing=${miss.length}/${sourceWords.length} ${snippets.join(" ")}`);
    }
  }
});

const VARIANTS: Record<string, string | null> = {
  "source-sans": null, // current resume font, no override
  plex: "var(--font-body)",
  "work-sans": "var(--font-worksans)",
  newsreader: "var(--font-newsreader)",
  poppins: "var(--font-poppins)",
  lora: "var(--font-lora)",
  "barlow-condensed": "var(--font-barlow-condensed)",
};

test.describe.configure({ mode: "parallel" });

for (const [variant, family] of Object.entries(VARIANTS)) {
  test(`FONTS all templates: ${variant}`, async ({ page }) => {
    test.setTimeout(1_500_000);
    await page.goto("/dev/font-probe/slugs");
    let slugs: string[] = JSON.parse((await page.locator("#slugs").innerText()) || "[]");
    if (process.env.PROBE_LIMIT) slugs = slugs.slice(0, Number(process.env.PROBE_LIMIT));
    for (const slug of slugs) {
      try {
        await page.goto(`/dev/font-probe/doc/${slug}`);
        await page.waitForLoadState("networkidle");
        if (family) {
          await page.addStyleTag({ content: `[class*='bg-resume-paper'], [class*='bg-resume-paper'] * { font-family: ${family}, Arial, sans-serif !important; }` });
          await page.waitForLoadState("networkidle");
        }
        await page.evaluate(async () => {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          await document.fonts.ready;
        });
        const info = await page.evaluate(() => {
          const root = document.querySelector("[class*='bg-resume-paper']");
          const leaves = root ? [...root.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent?.trim()) : [];
          const isTracked = (e: Element) => { const cs = getComputedStyle(e); return cs.textTransform === "uppercase" || parseFloat(cs.letterSpacing) > 0.2; };
          const fams = new Set(leaves.map((e) => getComputedStyle(e).fontFamily.split(",")[0].replace(/"/g, "").trim()));
          const loaded = new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")));
          return { fams: [...fams].join("|"), loaded: [...loaded].join("|"), body: leaves.filter((e) => !isTracked(e)).map((e) => e.textContent ?? "").join(" ") };
        });
        const pdf = await page.pdf({ printBackground: true });
        const src = words(info.body.replace(/[^\x20-\x7E\n]/g, " "));
        const a = missingWords(src, await extractPdfText(pdf));
        const popText = pdftotext(pdf);
        const b = popText === null ? null : missingWords(src, popText);
        console.log(`FONTS3 ${variant} ${slug} fams=${info.fams} loaded=${info.loaded} words=${src.length} pdfjs=${a.length} poppler=${b === null ? "n/a" : b.length}`);
      } catch (e) {
        console.log(`FONTS3 ${variant} ${slug} ERROR ${(e as Error).message.slice(0, 100)}`);
      }
    }
  });
}
