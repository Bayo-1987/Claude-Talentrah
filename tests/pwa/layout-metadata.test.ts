/**
 * The root layout's installable-app tags (design note section 1): iOS standalone launch, the Android address-bar colour, and the icons the
 * layout already declared, unchanged. Static exports only: reading them must not need a request.
 */
import { describe, expect, it } from "vitest";
import { metadata, viewport } from "@/app/layout";
import { PAPER_HEX } from "@/lib/pwa/colors";

describe("root layout metadata", () => {
  it("asks iOS to launch the Home Screen icon standalone, titled Talentrah", () => {
    expect(metadata.appleWebApp).toMatchObject({ capable: true, title: "Talentrah" });
  });

  it("sets the theme colour to the paper hex", () => {
    expect(viewport.themeColor).toBe(PAPER_HEX);
  });

  it("keeps the favicon set and the Apple touch icon it already had", () => {
    const icons = metadata.icons as { icon: { url: string }[]; apple: { url: string }[] };
    expect(icons.icon.map((i) => i.url)).toEqual([
      "/icons/talentrah-mark-16.png",
      "/icons/talentrah-mark-32.png",
      "/icons/talentrah-mark-48.png",
      "/icons/talentrah-mark-512.png",
    ]);
    expect(icons.apple.map((i) => i.url)).toEqual(["/icons/talentrah-mark-180.png"]);
  });
});
