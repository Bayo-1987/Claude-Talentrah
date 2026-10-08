/**
 * The server-side switch for the employer job-list widget (owner condition, 8 Oct 2026): the widget is OFF for every employer until the owner has added the Vercel Firewall rate-limit rule on
 * /embed/*, and turns it on by setting EMBED_WIDGET_ENABLED=1 in the deployment. Default OFF; only the exact value "1" turns it on, so a stray "true", "yes" or empty value cannot.
 * It is an environment read, not request state: the embed route stays cacheable (tests/embed/embed-route-source.test.ts still holds).
 */
import { afterEach, describe, expect, it } from "vitest";
import { embedWidgetEnabled } from "@/lib/embed/feature";

const original = process.env.EMBED_WIDGET_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.EMBED_WIDGET_ENABLED;
  else process.env.EMBED_WIDGET_ENABLED = original;
});

describe("embedWidgetEnabled", () => {
  it("is OFF when the variable is not set", () => {
    delete process.env.EMBED_WIDGET_ENABLED;
    expect(embedWidgetEnabled()).toBe(false);
  });
  it.each(["", " ", "0", "true", "TRUE", "yes", "on", "enabled", "01", "1 ", " 1", "2"])("is OFF for %j", (value) => {
    process.env.EMBED_WIDGET_ENABLED = value;
    expect(embedWidgetEnabled()).toBe(false);
  });
  it('is ON only for exactly "1"', () => {
    process.env.EMBED_WIDGET_ENABLED = "1";
    expect(embedWidgetEnabled()).toBe(true);
  });
  it("is read at call time, so a deployment's value is the one used (not a value frozen at import)", () => {
    process.env.EMBED_WIDGET_ENABLED = "1";
    expect(embedWidgetEnabled()).toBe(true);
    process.env.EMBED_WIDGET_ENABLED = "0";
    expect(embedWidgetEnabled()).toBe(false);
  });
});
