import { test } from "@playwright/test";
import { PDFParse } from "pdf-parse";

// THROWAWAY DIAGNOSTIC (send-473): never asserts, only logs what CI's Linux Chromium actually does with blueprint.
for (const route of ["/dev/template-skeletons/blueprint"]) {
  for (const width of [816, 1280]) {
    test(`diag ${route} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1056 });
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      const info = await page.evaluate(() => {
        const markers = ["ZQNAME","ZQSUMMARY","ZQEXPERIENCE","ZQEDUCATION","ZQCERTIFICATIONS","ZQSKILLS","ZQPROJECTS"];
        const pos: Record<string, number | null> = {};
        for (const m of markers) {
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n: Node | null; pos[m] = null;
          while ((n = w.nextNode())) if (n.textContent?.includes(m)) { const r = document.createRange(); r.selectNodeContents(n); pos[m] = Math.round(r.getBoundingClientRect().top + scrollY); break; }
        }
        const cs = (sel: string) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontFamily.slice(0, 60) : null; };
        return { pos, docH: document.documentElement.scrollHeight, loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`), h1: cs("h1"), h2: cs("h2"), p: cs("p"), li: cs("li") };
      });
      console.log(`DIAG@${width} INFO ${JSON.stringify(info)}`);
      const buf = await page.pdf({ printBackground: true });
      const parser = new PDFParse({ data: buf });
      const r = await parser.getText();
      console.log(`DIAG@${width} PAGES ${r.pages?.length} perPage ${JSON.stringify(r.pages?.map((p: { num: number; text: string }) => ({ n: p.num, len: p.text.length, m: p.text.match(/ZQ[A-Z]+/g) })))}`);
      console.log(`DIAG@${width} TEXT ${JSON.stringify(r.text.slice(-700))}`);
      await parser.destroy();
    });
  }
}
