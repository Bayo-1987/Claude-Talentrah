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

test("font matrix extraction", async ({ page }) => {
  await page.goto("/dev/font-probe");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ printBackground: true });
  const engines: Array<[string, string | null]> = [["pdfjs", await extractPdfText(pdf)], ["poppler", pdftotext(pdf)]];
  const sourceWords = words(Object.values(S).join(" "));
  const notes: Record<string, string> = {};
  const html = await page.content();
  void html;
  for (const [engine, text] of engines) {
    if (text === null) { console.log(`MATRIX ${engine} UNAVAILABLE`); continue; }
    const seg = segments(text);
    for (const id of Object.keys(seg).sort()) {
      const miss = missingWords(sourceWords, seg[id]);
      const markerOk = ["ZQCERTIFICATIONS", "ZQPROJECTS", "ZQSKILLS", "ZQEXPERIENCE", "ZQEDUCATION", "ZQSUMMARY"].filter((m) => seg[id].includes(m)).length;
      console.log(`MATRIX ${engine} ${id} missing=${miss.length}/${sourceWords.length} markers=${markerOk}/6 broken=${JSON.stringify(miss.slice(0, 12))}`);
    }
  }
  void notes;
});

test("every registered template: computed fonts + real-prose extraction", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/dev/font-probe/slugs");
  const slugs: string[] = JSON.parse((await page.locator("#slugs").innerText()) || "[]");
  console.log(`DOC slugs=${slugs.length}`);
  for (const slug of slugs) {
    try {
      await page.goto(`/dev/font-probe/doc/${slug}`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      const info = await page.evaluate(() => {
        const root = document.querySelector("[class*='bg-resume-paper']");
        const fams = new Map<string, number>();
        let plexLeaves = 0;
        const leaves = root ? [...root.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent?.trim()) : [];
        for (const e of leaves) {
          const f = getComputedStyle(e).fontFamily.split(",")[0].replace(/"/g, "").trim();
          fams.set(f, (fams.get(f) ?? 0) + 1);
          if (/plex/i.test(getComputedStyle(e).fontFamily)) plexLeaves++;
        }
        const own = root ? getComputedStyle(root).fontFamily.split(",")[0].replace(/"/g, "") : "NO-ROOT";
        const isTracked = (e: Element) => { const cs = getComputedStyle(e); return cs.textTransform === "uppercase" || (cs.letterSpacing !== "normal" && parseFloat(cs.letterSpacing) > 0.2); };
        return {
          hasRoot: !!root, rootFont: own, plexLeaves, fams: Object.fromEntries(fams),
          text: leaves.filter((e) => !isTracked(e)).map((e) => e.textContent ?? "").join(" "),
          trackedText: leaves.filter(isTracked).map((e) => e.textContent ?? "").join(" "),
        };
      });
      const pdf = await page.pdf({ printBackground: true });
      const extracted = await extractPdfText(pdf);
      const src = words(info.text.replace(/[^\x20-\x7E\n]/g, " "));
      const miss = missingWords(src, extracted);
      const trackedSrc = words(info.trackedText.replace(/[^\x20-\x7E\n]/g, " "));
      const trackedMiss = missingWords(trackedSrc, extracted);
      console.log(`DOC ${slug} root=${info.hasRoot} rootFont=${info.rootFont} plexLeaves=${info.plexLeaves} fams=${JSON.stringify(info.fams)} bodyWords=${src.length} bodyMissing=${miss.length} ${JSON.stringify(miss.slice(0, 8))} trackedWords=${trackedSrc.length} trackedMissing=${trackedMiss.length}`);
    } catch (e) {
      console.log(`DOC ${slug} ERROR ${(e as Error).message.slice(0, 120)}`);
    }
  }
});
