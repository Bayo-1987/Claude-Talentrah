import { describe, expect, it } from "vitest";
import { absoluteUrl } from "@/lib/seo/site";
import { buildMassEmail, createPacer, massUnsubscribeUrl, planBatches, quotaRoom, streamFor, MassEmailBuildError } from "@/lib/email/mass-send";

const identity = { from: "Talentrah <announce@mail.example.test>", replyTo: null };
const base = { identity, to: "zq7.one@example.test", subject: "Platform notice", body: "First.\n\nSecond line\nstill second.", linkPath: null, firstName: "Ada" };

describe("one email object per recipient", () => {
  it("has exactly one recipient, a string, never a list", () => {
    const e = buildMassEmail({ ...base, stream: "announcements", unsubscribeToken: "tok-1", consentLine: null });
    expect(e.to).toBe("zq7.one@example.test");
    expect(Array.isArray(e.to)).toBe(false);
    expect(Object.keys(e).sort()).toEqual(["from", "headers", "html", "subject", "text", "to"]); // no cc, no bcc, no second recipient
  });

  it("is sent from the configured mass-send address, and carries the reply-to only when one is configured", () => {
    const e = buildMassEmail({ ...base, stream: "announcements", unsubscribeToken: "tok-1", consentLine: null });
    expect(e.from).toBe(identity.from);
    expect(e.replyTo).toBeUndefined();
    const r = buildMassEmail({ ...base, identity: { ...identity, replyTo: "help@example.test" }, stream: "announcements", unsubscribeToken: "tok-1", consentLine: null });
    expect(r.replyTo).toBe("help@example.test");
  });
});

describe("the unsubscribe footer", () => {
  it("every email carries a link built from the recipient's OWN token and the stream, in the html and the text", () => {
    for (const stream of ["announcements", "promotions"] as const) {
      const consentLine = stream === "promotions" ? "You asked for promotions." : null;
      const a = buildMassEmail({ ...base, stream, unsubscribeToken: "tok-aaa", consentLine });
      const b = buildMassEmail({ ...base, to: "zq7.two@example.test", stream, unsubscribeToken: "tok-bbb", consentLine });
      const urlA = absoluteUrl(`/unsubscribe?token=tok-aaa&pref=${stream}`);
      const urlB = absoluteUrl(`/unsubscribe?token=tok-bbb&pref=${stream}`);
      expect(a.html).toContain(urlA.replace(/&/g, "&amp;"));
      expect(a.text).toContain(urlA);
      expect(b.text).toContain(urlB);
      expect(a.text).not.toContain("tok-bbb");
      expect(b.text).not.toContain("tok-aaa");
    }
  });

  it("builds the link with the token url-encoded and the stream named", () => {
    expect(massUnsubscribeUrl("a b+c", "promotions")).toBe(absoluteUrl("/unsubscribe?token=a%20b%2Bc&pref=promotions"));
  });

  it("a mass email without the recipient's token cannot be built", () => {
    expect(() => buildMassEmail({ ...base, stream: "announcements", unsubscribeToken: "", consentLine: null })).toThrow(MassEmailBuildError);
  });
});

describe("promotions", () => {
  it("carry the consent line and the List-Unsubscribe and one-click headers", () => {
    const e = buildMassEmail({ ...base, stream: "promotions", unsubscribeToken: "tok-p", consentLine: "You receive this because you opted in to promotions." });
    expect(e.html).toContain("You receive this because you opted in to promotions.");
    expect(e.text).toContain("You receive this because you opted in to promotions.");
    expect(e.headers["List-Unsubscribe"]).toBe(`<${absoluteUrl("/unsubscribe?token=tok-p&pref=promotions")}>`);
    expect(e.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("cannot be built without a consent line", () => {
    for (const consentLine of [null, "", "   "]) {
      expect(() => buildMassEmail({ ...base, stream: "promotions", unsubscribeToken: "t", consentLine })).toThrow(/consent/);
    }
  });

  it("an announcement is the announcements stream, a promotion the promotions stream", () => {
    expect(streamFor("promotion")).toBe("promotions");
    expect(streamFor("service_announcement")).toBe("announcements");
    expect(streamFor("anything_else")).toBe("announcements");
  });
});

describe("the content is the author's text, escaped", () => {
  it("escapes markup in the title-independent body, keeps paragraphs and line breaks", () => {
    const e = buildMassEmail({ ...base, body: "Click <b>here</b> & now\n\nSecond", stream: "announcements", unsubscribeToken: "t", consentLine: null });
    expect(e.html).toContain("Click &lt;b&gt;here&lt;/b&gt; &amp; now");
    expect(e.html).not.toContain("<b>here</b>");
    expect(e.text).toContain("Click <b>here</b> & now");
  });

  it("adds a button only when the message has a link, to the site's own address", () => {
    const without = buildMassEmail({ ...base, stream: "announcements", unsubscribeToken: "t", consentLine: null });
    expect(without.html).not.toContain("Open Talentrah");
    const withLink = buildMassEmail({ ...base, linkPath: "/jobs", stream: "announcements", unsubscribeToken: "t", consentLine: null });
    expect(withLink.html).toContain("Open Talentrah");
    expect(withLink.html).toContain(absoluteUrl("/jobs"));
  });
});

describe("planBatches", () => {
  it("101 recipients become two requests: 100 and 1", () => {
    const items = Array.from({ length: 101 }, (_, i) => i);
    const plan = planBatches(items, 100);
    expect(plan.map((p) => p.length)).toEqual([100, 1]);
    expect(plan.flat()).toEqual(items);
  });
  it("an empty list is no request, an exact multiple has no empty tail", () => {
    expect(planBatches([], 100)).toEqual([]);
    expect(planBatches(Array.from({ length: 200 }, (_, i) => i), 100).map((p) => p.length)).toEqual([100, 100]);
  });
  it("refuses a size of zero", () => {
    expect(() => planBatches([1], 0)).toThrow();
  });
});

describe("quota room", () => {
  it("is the smaller of the two quotas, and null when neither is known", () => {
    expect(quotaRoom({ rateRemaining: 5, dailyRemaining: 40, monthlyRemaining: 300 })).toBe(40);
    expect(quotaRoom({ rateRemaining: 5, dailyRemaining: null, monthlyRemaining: 300 })).toBe(300);
    expect(quotaRoom({ rateRemaining: 5, dailyRemaining: null, monthlyRemaining: null })).toBeNull();
    expect(quotaRoom(null)).toBeNull();
  });
});

describe("the pacer", () => {
  function fakeClock() {
    let t = 1_000_000;
    return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } };
  }
  it("starts the first request at once and spaces the next by the gap", async () => {
    const clock = fakeClock();
    const pacer = createPacer(clock, 2000);
    const starts: number[] = [];
    for (let i = 0; i < 3; i++) {
      await pacer.beforeRequest();
      starts.push(clock.now());
    }
    expect(starts[1] - starts[0]).toBe(2000);
    expect(starts[2] - starts[1]).toBe(2000);
  });
  it("does not wait twice when the work itself took longer than the gap", async () => {
    const clock = fakeClock();
    const pacer = createPacer(clock, 2000);
    await pacer.beforeRequest();
    const first = clock.now();
    clock.advance(5000);
    await pacer.beforeRequest();
    expect(clock.now() - first).toBe(5000);
  });
  it("doubles the next gap when the provider reports few requests left, then returns to normal", async () => {
    const clock = fakeClock();
    const pacer = createPacer(clock, 2000);
    await pacer.beforeRequest();
    const first = clock.now();
    pacer.observe({ rateRemaining: 1, dailyRemaining: 50, monthlyRemaining: 1000 });
    await pacer.beforeRequest();
    const second = clock.now();
    expect(second - first).toBe(4000);
    await pacer.beforeRequest();
    expect(clock.now() - second).toBe(2000);
  });
});
