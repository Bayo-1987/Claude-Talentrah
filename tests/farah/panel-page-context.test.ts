/**
 * A page chip's click carries the ids the page carries (a job, a scholarship, an application), and nothing else about the page: the panel reads them from the URL and sends them with the chip's key; the server
 * validates each and loads the record through the user's own access. (A source check: the panel's click handlers need a browser to run.)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/components/app-shell/farah-panel.tsx", "utf8");

describe("the panel sends the page's ids with a chip click", () => {
  it("reads the route and the query through the same helper the chips come from", () => {
    expect(panel).toMatch(/pageContextForPath\(pathname, searchParams\)/);
    expect(panel).toMatch(/panelChipsForPath\(pathname, searchParams\)/);
  });
  it("both click paths (send now, or prefill when it would cost credits) pass the job and the other ids", () => {
    expect(panel).toMatch(/void send\(action\.starterPrompt, action\.key, pageJobId, pageIds\)/);
    expect(panel).toMatch(/sendOrPrefill\(action\.starterPrompt, action\.key, pageJobId, pageIds\)/);
  });
  it("a prefilled click remembers its ids, so pressing Send on the untouched text goes out the same way", () => {
    expect(panel).toMatch(/setPrefilled\(\{ text, quickAction, jobId, ids \}\)/);
    expect(panel).toMatch(/void send\(prefilled\.text, prefilled\.quickAction, prefilled\.jobId, prefilled\.ids\)/);
  });
  it("the request body carries them next to the message and the chip's key, and nothing computed on the client", () => {
    expect(panel).toMatch(/JSON\.stringify\(\{ message: trimmed, quickAction, sessionId: sessionId\(\), jobId, \.\.\.ids \}\)/);
  });
});

describe("a prefilled chip belongs to the page it was clicked on", () => {
  it("is forgotten when the route (path or query) changes, so Send on page B never goes out with page A's chip key and ids", () => {
    // the route as one string; when it differs from the route the chip was remembered on, the chip is dropped in the same render
    expect(panel).toMatch(/const routeKey = `\$\{pathname \?\? ""\}\?\$\{searchParams\?\.toString\(\) \?\? ""\}`;/);
    expect(panel).toMatch(/if \(prefilledRoute !== routeKey\) \{\s*setPrefilledRoute\(routeKey\);\s*setPrefilled\(null\);\s*\}/);
  });
  it("is declared after the state it clears (a use-before-declare would throw at render)", () => {
    expect(panel.indexOf("const [prefilled, setPrefilled]")).toBeGreaterThan(-1);
    expect(panel.indexOf("if (prefilledRoute !== routeKey)")).toBeGreaterThan(panel.indexOf("const [prefilled, setPrefilled]"));
  });
});
