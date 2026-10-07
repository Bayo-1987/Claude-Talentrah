/**
 * HWR-2: the signed-out masthead's HTML is byte-identical to what shipped before the "Go to your dashboard" change. The file under __snapshots__ was captured from main
 * BEFORE any HWR-2 code existed. A signed-in visitor gets a client-side swap after hydration; the static HTML every pre-rendered info page serves must not change a byte
 * (the cache, the crawler and a signed-out visitor all see this), and the layout the cold-load CLS spec measures depends on it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";

describe("the signed-out masthead markup (HWR-2)", () => {
  it("is byte-identical to the snapshot taken from main", async () => {
    await expect(renderToStaticMarkup(<MarketingMasthead />)).toMatchFileSnapshot("./__snapshots__/marketing-masthead-signed-out.html");
  });
});
