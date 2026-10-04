/**
 * The billing page (direction C, "balance first"), rendered in each of its states and pinned.
 *
 *   1 no pass, some credits      4 pass ended
 *   2 active pass, card          5 zero credits
 *   3 active pass, mobile money  6 first visit, nothing bought
 *
 * plus: every price comes from the pricing source, "Included" comes from PASS_COVERAGE (and a covered row shows no price, the pinned
 * rule), each Buy and top-up form is bound to the same purchase action with the same arguments as before, Cancel auto-renewal is bound to
 * the right pass, the page's four reads are the same reads, and the markup is built for a screen reader.
 *
 * Server component rendered with a fake Supabase client that returns fixed rows per table and records every call made on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { creditPriceList } from "@/lib/credits/price-list";
import { priceText } from "@/lib/credits/price-labels";
import { PASS_COVERAGE, coveredByPass } from "@/lib/passes/pass-coverage";
import { PASSES, CREDIT_PACKS } from "@/lib/billing/catalog";
import { formatDate } from "@/lib/format/datetime";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const world = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  balance: 12,
  reads: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
  bound: [] as Array<{ action: string; args: unknown[] }>,
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ profile: { id: "u1", credits_balance: world.balance, country: "Nigeria" }, user: { id: "u1" } }),
}));
vi.mock("@/lib/billing/actions", () => {
  const spy = (name: string) => Object.assign(async () => {}, { bind: (_t: unknown, ...args: unknown[]) => { world.bound.push({ action: name, args }); return async () => {}; } });
  return { initiatePurchaseAction: spy("initiatePurchase"), cancelAutoRenewAction: spy("cancelAutoRenew") };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const rec = { table, calls: [] as Array<[string, unknown[]]> };
      world.reads.push(rec);
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: world.rows[table] ?? [], error: null });
            return (...args: unknown[]) => {
              rec.calls.push([String(prop), args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  }),
}));

import BillingPage from "@/app/(app)/billing/page";

const packs = [
  { id: "pk1", name: "Starter", credits: 20, price_ngn: 2500 },
  { id: "pk2", name: "Plus", credits: 50, price_ngn: 5000 },
];
const passes = [
  { id: "ps7", name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 6500 },
  { id: "ps30", name: "30-Day Pass", duration_days: 30, price_ngn: 13500 },
  { id: "ps90", name: "90-Day Pass", duration_days: 90, price_ngn: 30000 },
];
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const livePass = (over: Record<string, unknown> = {}) => ({
  id: "up1",
  pass_id: "ps30",
  payment_method: "card",
  auto_renew_status: "active",
  next_renewal_date: "2026-10-22",
  expires_at: iso(18 * DAY),
  started_at: iso(-12 * DAY),
  payment_transaction_id: "t-pass",
  status: "active",
  passes: { name: "30-Day Pass" },
  ...over,
});
const purchases = [
  { id: "t-pass", amount: 13500, currency: "NGN", product_type: "pass", product_id: "ps30", rail: "paystack", channel: "card", paystack_reference: "pass_678586c1-9f2e-4c3a-8d11-0a1b2c3d4e5f", created_at: iso(-12 * DAY) },
  { id: "t-plus", amount: 5000, currency: "NGN", product_type: "credit_pack", product_id: "pk2", rail: "paystack", channel: "card", paystack_reference: "credit_pack_11111111-9f2e-4c3a-8d11-0a1b2c3d4e5f", created_at: iso(-20 * DAY) },
  { id: "t-old", amount: 2500, currency: "NGN", product_type: "credit_pack", product_id: "retired-pack", rail: "paystack", channel: "bank", paystack_reference: "credit_pack_22222222-9f2e-4c3a-8d11-0a1b2c3d4e5f", created_at: iso(-60 * DAY) },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  world.balance = 12;
  world.reads = [];
  world.bound = [];
  world.rows = { credit_packs: packs, passes, user_passes: [], payment_transactions: purchases };
});
afterEach(() => vi.useRealTimers());

const render = async (searchParams: { purchased?: string; error?: string } = {}) =>
  renderToString(await BillingPage({ searchParams: Promise.resolve(searchParams) }));
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("state 1: no pass, some credits", () => {
  it("leads with the balance and a pass column that says none is active, with the lowest pass price from the data", async () => {
    const t = text(await render());
    expect(t).toContain("Your balance");
    expect(t).toContain("None active");
    expect(t).toContain("A pass covers tailoring, cover letters, bullet rewrites, Auto-Apply, scholarship checks and SOP drafts at zero credit cost. From ₦6,500 for 7 days.");
    expect(await render()).toMatch(/href="#passes"[^>]*>See passes</);
  });

  it("the lowest price and its length follow the rows, not a typed-in number", async () => {
    world.rows.passes = [{ id: "x", name: "Quick Pass", duration_days: 3, price_ngn: 1234 }];
    expect(text(await render())).toContain("From ₦1,234 for 3 days.");
  });

  it("shows no Included marker and every action with its price", async () => {
    const t = text(await render());
    expect(t).not.toMatch(/included with your Pass/i);
    for (const e of creditPriceList()) expect(t, e.label).toContain(e.text);
  });

  it("has a Passes section with the three passes, the per-day figure and one coverage paragraph", async () => {
    const t = text(await render());
    for (const [name, headline, day] of [
      ["7-Day Sprint Pass", "Unlimited for 7 days", "about ₦929 a day"],
      ["30-Day Pass", "Unlimited for 30 days", "about ₦450 a day"],
      ["90-Day Pass", "Unlimited for 90 days", "about ₦333 a day"],
    ]) {
      expect(t).toContain(name);
      expect(t).toContain(headline);
      expect(t).toContain(day);
    }
    expect(t.match(/Covers tailoring, cover letters, bullet rewrites, Auto-Apply beyond your 5 free weekly applications, and scholarship eligibility checks and SOP drafts — all at zero credit cost, up to 30 actions a day\. Template unlocks and Talent Directory verification are sold separately, credits only\. Auto-renews if paid by card; one-time if paid by mobile money\./g)).toHaveLength(1);
  });
});

describe("state 2: active pass paid by card", () => {
  beforeEach(() => {
    world.rows.user_passes = [livePass()];
  });

  it("names the pass, shows days left, the renewal date, the reminder line and a progress bar with a name and a value", async () => {
    const html = await render();
    const t = text(html);
    expect(t).toContain("30-Day Pass");
    expect(t).toContain("18 days left");
    expect(t).toContain("Renews 22 Oct 2026");
    expect(t).toContain("You'll get a reminder before you're charged.");
    const bar = /<div[^>]*role="progressbar"[^>]*>/.exec(html)?.[0] ?? "";
    expect(bar).toMatch(/aria-label="[^"]+"/);
    expect(bar).toMatch(/aria-valuenow="12"/);
    expect(bar).toMatch(/aria-valuemax="30"/);
    expect(bar).toMatch(/aria-valuemin="0"/);
    expect(bar).toMatch(/aria-valuetext="12 of 30 days used"/);
  });

  it("is not described as a state-1 page: no 'None active'", async () => {
    expect(text(await render())).not.toContain("None active");
  });

  it("marks exactly the actions PASS_COVERAGE covers as 'included with your Pass', with NO price on them, and shows a price on the rest", async () => {
    const html = await render();
    const items = [...html.matchAll(/<li[^>]*data-action="(\w+)"[^>]*>([\s\S]*?)<\/li>/g)];
    expect(items).toHaveLength(Object.keys(CREDIT_COSTS).length);
    for (const [, key, inner] of items) {
      const t = text(inner);
      const k = key as keyof typeof CREDIT_COSTS;
      if (coveredByPass(k)) {
        expect(t, key).toContain(priceText({ cost: CREDIT_COSTS[k], passCovered: true }));
        expect(t, key).not.toMatch(/\d+ credits?/);
      } else {
        expect(t, key).toContain(priceText({ cost: CREDIT_COSTS[k] }));
        expect(t, key).not.toMatch(/included with your Pass/i);
      }
    }
    expect(Object.values(PASS_COVERAGE).filter((v) => v === "pass")).toHaveLength(7);
  });

  it("never draws a struck-through price (the pinned rule: a covered user is not shown a price)", async () => {
    const html = await render();
    expect(html).not.toMatch(/line-through|<s[ >]|<del[ >]/);
  });

  it("says 'after your free messages' on the Farah row, and nowhere else", async () => {
    const html = await render();
    const farah = /<li[^>]*data-action="farahChatMessage"[^>]*>([\s\S]*?)<\/li>/.exec(html)?.[1] ?? "";
    expect(text(farah)).toContain("after your free messages");
    expect(text(html).match(/after your free messages/g)).toHaveLength(1);
  });

  it("marks the current pass's card 'Current' and keeps its Buy form; the other two cards are not marked", async () => {
    const html = await render();
    expect(text(html).match(/\bCurrent\b/g)).toHaveLength(1);
    const buys = world.bound.filter((b) => b.action === "initiatePurchase" && b.args[0] === "pass").map((b) => b.args[1]);
    expect(buys.sort()).toEqual(["ps30", "ps7", "ps90"]);
  });

  it("tags the payment that started the running pass 'Active' in the activity table, and no other row", async () => {
    const html = await render();
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => text(m[1]));
    const withTag = rows.filter((r) => /\bActive\b/.test(r));
    expect(withTag).toHaveLength(1);
    expect(withTag[0]).toContain("30-Day Pass");
  });

  it("Cancel auto-renewal is present once and bound to this pass's id", async () => {
    const t = text(await render());
    expect(t.match(/Cancel auto-renewal/g)).toHaveLength(1);
    expect(world.bound.filter((b) => b.action === "cancelAutoRenew")).toEqual([{ action: "cancelAutoRenew", args: ["up1"] }]);
  });

  it("with two running passes, leads with the one that expires last, says how many others there are, and still lets each be cancelled", async () => {
    world.rows.user_passes = [
      livePass(),
      livePass({ id: "up2", pass_id: "ps7", expires_at: iso(2 * DAY), started_at: iso(-5 * DAY), next_renewal_date: "2026-10-06", payment_transaction_id: "t-x", passes: { name: "7-Day Sprint Pass" } }),
    ];
    const t = text(await render());
    expect(t).toContain("18 days left");
    expect(t).toContain("1 other active pass");
    expect(world.bound.filter((b) => b.action === "cancelAutoRenew").map((b) => b.args[0]).sort()).toEqual(["up1", "up2"]);
  });

  it("a cancelled auto-renew says it ends and shows the existing notice; no Cancel button", async () => {
    world.rows.user_passes = [livePass({ auto_renew_status: "canceled" })];
    const t = text(await render());
    expect(t).toContain("Ends 22 Oct 2026".replace("22 Oct 2026", formatDate(iso(18 * DAY))));
    expect(t).toContain("Auto-renewal canceled — access continues until it expires, then this Pass won't renew.");
    expect(t).not.toContain("Cancel auto-renewal");
  });

  it("a lapsed renewal shows the existing notice", async () => {
    world.rows.user_passes = [livePass({ auto_renew_status: "lapsed" })];
    expect(text(await render())).toContain("A renewal charge failed, so this Pass won't auto-renew. Buy a new one below to keep access after it expires.");
  });
});

describe("state 3: active pass paid by mobile money", () => {
  it("says Ends <date>, has no renewal line and no Cancel button", async () => {
    world.rows.user_passes = [livePass({ payment_method: "mobile_money", auto_renew_status: null, next_renewal_date: null })];
    const t = text(await render());
    expect(t).toContain(`Ends ${formatDate(iso(18 * DAY))}`);
    expect(t).not.toContain("Renews ");
    expect(t).not.toContain("reminder before");
    expect(t).not.toContain("Cancel auto-renewal");
  });
});

describe("state 4: the pass has ended", () => {
  beforeEach(() => {
    // status is still 'active': nothing flips it when the date passes (src/lib/passes/entitlement.ts).
    world.rows.user_passes = [livePass({ expires_at: iso(-9 * DAY), started_at: iso(-39 * DAY) })];
  });

  it("shows nothing running: says None active, then Your <name> ended <date>.", async () => {
    const t = text(await render());
    expect(t).toContain("None active");
    expect(t).toContain(`Your 30-Day Pass ended ${formatDate(iso(-9 * DAY))}.`);
  });

  it("does not call it active, count days left, offer a cancel, mark Current or mark anything Included", async () => {
    const t = text(await render());
    expect(t).not.toMatch(/is active|days? left|Cancel auto-renewal|Current/);
    expect(t).not.toMatch(/included with your Pass/i);
    expect(world.bound.filter((b) => b.action === "cancelAutoRenew")).toEqual([]);
  });
});

describe("state 5: zero credits", () => {
  it("shows 0 in the balance and the heading, and the top-up forms are there", async () => {
    world.balance = 0;
    const t = text(await render());
    expect(t).toContain("Your balance: 0 credits");
    expect(world.bound.filter((b) => b.action === "initiatePurchase" && b.args[0] === "credit_pack").map((b) => b.args[1]).sort()).toEqual(["pk1", "pk2"]);
  });
});

describe("state 6: first visit, nothing bought", () => {
  it("says 'No purchases yet.' and draws no table", async () => {
    world.rows.payment_transactions = [];
    const html = await render();
    expect(text(html)).toContain("No purchases yet.");
    expect(html).not.toContain("<table");
  });

  it("with purchases it is a real table: a caption, column headers, one row per purchase, the short receipt number", async () => {
    const html = await render();
    expect(html).toContain("<table");
    expect(html).toMatch(/<caption[^>]*>[^<]*Recent activity/);
    expect(html.match(/<th[ >]/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect((html.match(/<tbody[\s\S]*<\/tbody>/)?.[0].match(/<tr[ >]/g) ?? []).length).toBe(purchases.length);
    const t = text(html);
    expect(t).toContain("Receipt PS-678586C1");
    expect(t).toContain("Plus pack · 50 credits");
    expect(t).toContain("Talentrah Pass".replace("Talentrah Pass", "30-Day Pass"));
  });

  it("a retired pack falls back to the generic label", async () => {
    expect(text(await render())).toContain("Credit pack");
  });

  it("has no status column and no Receipt button", async () => {
    const html = await render();
    expect(html).not.toMatch(/<th[^>]*>\s*Status\s*<\/th>/);
    expect(html).not.toMatch(/<(button|a)[^>]*>\s*Receipt\s*<\/(button|a)>/);
  });
});

describe("every displayed price equals its source", () => {
  it("pack and pass prices come from the rows, and the catalog the rows are seeded from agrees", async () => {
    const html = await render();
    for (const p of packs) expect(html, p.name).toContain(`>₦${p.price_ngn.toLocaleString("en-NG")}<`);
    for (const p of passes) expect(html, p.name).toContain(`>₦${p.price_ngn.toLocaleString("en-NG")}<`);
    for (const c of CREDIT_PACKS) expect(packs.find((p) => p.name === c.name)).toMatchObject({ credits: c.credits, price_ngn: c.price_ngn });
    for (const c of PASSES) expect(passes.find((p) => p.name === c.name)).toMatchObject({ duration_days: c.duration_days, price_ngn: c.price_ngn });
  });

  it("the 11 action prices follow CREDIT_COSTS: a repricing moves the page", async () => {
    const original = { ...CREDIT_COSTS };
    try {
      (CREDIT_COSTS as Record<string, number>).tailoringRun = 77;
      (CREDIT_COSTS as Record<string, number>).talentDirectoryBoost = 99;
      const t = text(await render());
      expect(t).toContain("Tailor a resume · 77 credits");
      expect(t).toContain("Talent Directory boost · 99 credits");
      expect(t).not.toContain("Tailor a resume · 20 credits");
    } finally {
      Object.assign(CREDIT_COSTS, original);
    }
  });

  it("the per-day figure follows the row", async () => {
    world.rows.passes = [{ id: "ps7", name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 7000 }];
    expect(text(await render())).toContain("about ₦1,000 a day");
  });
});

describe("the purchase forms start the same flows with the same arguments", () => {
  it("credit packs: ('credit_pack', pack.id); passes: ('pass', pass.id); nothing else is bound", async () => {
    await render();
    const buys = world.bound.filter((b) => b.action === "initiatePurchase").map((b) => `${b.args[0]}:${b.args[1]}`).sort();
    expect(buys).toEqual(["credit_pack:pk1", "credit_pack:pk2", "pass:ps30", "pass:ps7", "pass:ps90"]);
  });
});

describe("the page's reads are the same reads", () => {
  it("credit_packs, passes, user_passes and payment_transactions, filtered and ordered as before, and nothing else", async () => {
    await render();
    const by = (table: string) => world.reads.filter((r) => r.table === table);
    expect(world.reads.map((r) => r.table).sort()).toEqual(["credit_packs", "passes", "payment_transactions", "user_passes"]);
    const calls = (table: string) => by(table)[0].calls.map(([m, a]) => `${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
    expect(calls("credit_packs")).toEqual(['select("*")', 'eq("is_active",true)', 'order("price_ngn")']);
    expect(calls("passes")).toEqual(['select("*")', 'eq("is_active",true)', 'order("price_ngn")']);
    const up = calls("user_passes");
    expect(up).toContain('eq("user_id","u1")');
    expect(up).toContain('eq("status","active")');
    expect(up).toContain('order("expires_at",{"ascending":false})');
    const upSelect = (by("user_passes")[0].calls.find(([m]) => m === "select")?.[1][0] as string).split(",").map((s) => s.trim());
    for (const col of ["id", "payment_method", "auto_renew_status", "next_renewal_date", "expires_at", "status", "passes(name)"]) expect(upSelect).toContain(col);
    const pt = calls("payment_transactions");
    expect(pt).toContain('eq("user_id","u1")');
    expect(pt).toContain('eq("status","success")');
    expect(pt).toContain('order("created_at",{"ascending":false})');
    expect(pt).toContain("limit(10)");
    const ptSelect = (by("payment_transactions")[0].calls.find(([m]) => m === "select")?.[1][0] as string).split(",").map((s) => s.trim());
    for (const col of ["id", "amount", "currency", "product_type", "rail", "channel", "paystack_reference", "created_at"]) expect(ptSelect).toContain(col);
  });

  it("never asks for the card token column", async () => {
    await render();
    const selects = world.reads.flatMap((r) => r.calls.filter(([m]) => m === "select").map(([, a]) => String(a[0])));
    expect(selects.join(" ")).not.toContain("authorization_code");
  });
});

describe("the page keeps what the old one did", () => {
  it("the purchase confirmation, the error banner and the unconfigured note", async () => {
    const t = text(await render({ purchased: "1", error: "payments_unavailable" }));
    expect(t).toContain("Payment received");
    expect(t).toContain("You're all set.");
    expect(t).toContain("Credit pack · ₦2,500".replace("Credit pack · ₦2,500", "Talentrah Pass · ₦13,500"));
    expect(t).toContain("That purchase couldn't start — payments aren't configured yet in this environment.");
  });

  it("the big credit-pack price keeps its test id, as one ₦ text node", async () => {
    const html = await render();
    expect(html).toMatch(/data-testid="credit-pack-price"[^>]*>₦2,500</);
  });
});

describe("built for a screen reader", () => {
  it("one h1 ('Billing'), then h2 sections, then h3 pass names: no level skipped", async () => {
    world.rows.user_passes = [livePass()];
    const html = await render();
    const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading ${i} after ${levels[i - 1]}`).toBeLessThanOrEqual(1);
    expect(html).toMatch(/<h1[^>]*>Billing<\/h1>/);
    expect(text(html)).toContain("Talentrah billing");
  });

  it("the section headings the design names are all there", async () => {
    const t = text(await render());
    for (const h of ["Your balance", "Pass", "Top up credits", "Passes", "Recent activity", "Talentrah credits"]) expect(t).toContain(h);
    expect(t).toContain("Credits pay for the actions below, after any free allowance. Prices are per use.");
    expect(t).toContain("Credit packs, never expire.");
  });
});
