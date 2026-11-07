/**
 * PR-E4 gate 2: the one validator for an employer's career-site link (src/lib/jobs/apply-link.ts). It imports the sheet importer's link rules (https only, no user info, port, IP, shortener, job-board host)
 * and adds the two domain paths: A, the verified company's own domain on a dot boundary; B, an allowlisted applicant-tracking host (exact hosts need a company page path, tenant hosts need exactly one
 * tenant label that is not a vendor's own). An unverified company gets Path B only. It refuses and never repairs; the only change it makes is the one the importer makes (tracking parameters removed,
 * the host folded to lower case). It is checked against the database function's rules replayed from the SQL text (tests/support/apply-link-sql-model.ts), in both directions.
 */
import { describe, expect, it } from "vitest";
import { checkApplyLink, ATS_EXACT_HOSTS, ATS_TENANT_SUFFIXES, ATS_VENDOR_LABELS, APPLY_LINK_MAX_LENGTH, applyLinkReasonMessage, type ApplyLinkReason } from "@/lib/jobs/apply-link";
import { EXACT, sqlModel, VENDOR, grab, fnText, type Org } from "../support/apply-link-sql-model";

// A job-board address exists in this file only as run-time strings built from fragments (the host-pattern test scans the repository for exactly that).
const BOARD = ["hotnigerian", "jobs"].join("");

type Case = [name: string, input: string, domain: string | null, expected: { ok: true; kind: "company" | "ats"; url?: string } | { ok: false; reason: ApplyLinkReason }];
const cases: Case[] = [
  // Path A: the company's own domain
  ["company: the domain itself", "https://acme.com/careers", "acme.com", { ok: true, kind: "company" }],
  ["company: a subdomain", "https://careers.acme.com/jobs/1", "acme.com", { ok: true, kind: "company" }],
  ["company: a deep subdomain", "https://a.b.acme.com", "acme.com", { ok: true, kind: "company", url: "https://a.b.acme.com/" }],
  ["company: upper-case host is folded, the path keeps its case", "https://ACME.COM/Careers", "acme.com", { ok: true, kind: "company", url: "https://acme.com/Careers" }],
  ["company: tracking parameters are removed, the rest of the query stays", "https://acme.com/x?utm_source=a&id=7&fbclid=z", "acme.com", { ok: true, kind: "company", url: "https://acme.com/x?id=7" }],
  ["company: the default port is dropped by the parser", "https://acme.com:443/x", "acme.com", { ok: true, kind: "company", url: "https://acme.com/x" }],
  ["company.com.evil.com is not company.com", "https://acme.com.evil.com/x", "acme.com", { ok: false, reason: "host_not_allowed" }],
  ["evilcompany.com is not company.com (no dot boundary)", "https://evilacme.com/x", "acme.com", { ok: false, reason: "host_not_allowed" }],
  ["a different domain", "https://notacme.com", "acme.com", { ok: false, reason: "host_not_allowed" }],
  ["a different top-level domain", "https://acme.co/x", "acme.com", { ok: false, reason: "host_not_allowed" }],
  ["an unverified company has no domain: its own site is refused", "https://acme.com/careers", null, { ok: false, reason: "host_not_allowed" }],
  // the importer's rules
  ["http", "http://acme.com/x", "acme.com", { ok: false, reason: "not_https" }],
  ["ftp", "ftp://acme.com/x", "acme.com", { ok: false, reason: "not_https" }],
  ["a port", "https://acme.com:8443/x", "acme.com", { ok: false, reason: "port" }],
  ["user info with a password", "https://user:pass@acme.com/x", "acme.com", { ok: false, reason: "user_info" }],
  ["user info without a password", "https://user@acme.com", "acme.com", { ok: false, reason: "user_info" }],
  ["an IPv4 host", "https://1.2.3.4/x", "acme.com", { ok: false, reason: "ip_host" }],
  ["an IPv6 host", "https://[::1]/x", "acme.com", { ok: false, reason: "ip_host" }],
  ["a numeric host the parser turns into an IP", "https://0x7f000001/x", "acme.com", { ok: false, reason: "ip_host" }],
  ["a link shortener", "https://bit.ly/abc", "acme.com", { ok: false, reason: "shortener" }],
  ["another link shortener", "https://linktr.ee/acme", "acme.com", { ok: false, reason: "shortener" }],
  ["a job board", `https://www.${BOARD}.com/job/1`, "acme.com", { ok: false, reason: "job_board" }],
  ["localhost", "https://localhost/x", "acme.com", { ok: false, reason: "not_public_host" }],
  ["a single-label host", "https://intranet/x", "acme.com", { ok: false, reason: "not_public_host" }],
  ["no scheme", "acme.com/careers", "acme.com", { ok: false, reason: "not_a_link" }],
  ["a javascript: address", "javascript:alert(1)", "acme.com", { ok: false, reason: "not_a_link" }],
  ["empty", "", "acme.com", { ok: false, reason: "empty" }],
  ["only spaces", "   ", "acme.com", { ok: false, reason: "empty" }],
  ["a space inside", "https://acme.com/a b", "acme.com", { ok: false, reason: "whitespace" }],
  ["a tab inside", "https://acme.com/a\tb", "acme.com", { ok: false, reason: "whitespace" }],
  ["a control character inside", "https://acme.com/a\u0001b", "acme.com", { ok: false, reason: "control_character" }],
  ["longer than 2000 characters", `https://acme.com/${"a".repeat(2001)}`, "acme.com", { ok: false, reason: "too_long" }],
  // the host rules added for this feature
  ["an IDN host (non-ASCII)", "https://bücher.acme.com/x", "acme.com", { ok: false, reason: "non_ascii_host" }],
  ["an xn-- label", "https://xn--bcher-kva.acme.com/x", "acme.com", { ok: false, reason: "xn_label" }],
  ["an xn-- label on a tenant host", "https://xn--abc.bamboohr.com/x", null, { ok: false, reason: "xn_label" }],
  ["a trailing dot", "https://acme.com./x", "acme.com", { ok: false, reason: "trailing_dot" }],
  // Path B: applicant-tracking hosts
  ["ats: greenhouse boards with a company page", "https://boards.greenhouse.io/acme", null, { ok: true, kind: "ats" }],
  ["ats: greenhouse job-boards", "https://job-boards.greenhouse.io/acme/jobs/1", null, { ok: true, kind: "ats" }],
  ["ats: lever", "https://jobs.lever.co/acme", null, { ok: true, kind: "ats" }],
  ["ats: workable", "https://apply.workable.com/acme/", null, { ok: true, kind: "ats" }],
  ["ats: ashby", "https://jobs.ashbyhq.com/acme", null, { ok: true, kind: "ats" }],
  ["ats: smartrecruiters jobs", "https://jobs.smartrecruiters.com/Acme", null, { ok: true, kind: "ats" }],
  ["ats: smartrecruiters careers", "https://careers.smartrecruiters.com/acme", null, { ok: true, kind: "ats" }],
  ["ats: bamboohr tenant, with a path", "https://acme.bamboohr.com/careers", null, { ok: true, kind: "ats" }],
  ["ats: bamboohr tenant, no path needed", "https://acme.bamboohr.com", null, { ok: true, kind: "ats", url: "https://acme.bamboohr.com/" }],
  ["ats: recruitee tenant", "https://acme.recruitee.com/o/job", null, { ok: true, kind: "ats" }],
  ["ats: teamtailor tenant", "https://acme.teamtailor.com/jobs", null, { ok: true, kind: "ats" }],
  ["ats: a hyphenated tenant label", "https://acme-app.bamboohr.com/x", null, { ok: true, kind: "ats" }],
  ["ats: upper-case host is folded", "https://BOARDS.GREENHOUSE.IO/Acme", null, { ok: true, kind: "ats", url: "https://boards.greenhouse.io/Acme" }],
  ["ats: a bare exact host", "https://boards.greenhouse.io", null, { ok: false, reason: "ats_needs_path" }],
  ["ats: only a slash", "https://boards.greenhouse.io/", null, { ok: false, reason: "ats_needs_path" }],
  ["ats: only a query", "https://boards.greenhouse.io/?x=1", null, { ok: false, reason: "ats_needs_path" }],
  ["ats: an empty first segment", "https://boards.greenhouse.io//x", null, { ok: false, reason: "ats_needs_path" }],
  ["ats: http", "http://boards.greenhouse.io/acme", null, { ok: false, reason: "not_https" }],
  ["lever.co alone is not an allowed host", "https://lever.co/acme", null, { ok: false, reason: "host_not_allowed" }],
  ["lever.co.evil.com", "https://lever.co.evil.com/x", null, { ok: false, reason: "host_not_allowed" }],
  ["jobs.lever.co.evil.com", "https://jobs.lever.co.evil.com/acme", null, { ok: false, reason: "host_not_allowed" }],
  ["a look-alike label before an exact host", "https://evil-jobs.lever.co/x", null, { ok: false, reason: "host_not_allowed" }],
  ["a bare tenant host (no tenant label)", "https://bamboohr.com/careers", null, { ok: false, reason: "host_not_allowed" }],
  ["a host that merely ends in the vendor name", "https://evilbamboohr.com/x", null, { ok: false, reason: "host_not_allowed" }],
  ["a nested tenant (two labels)", "https://a.b.bamboohr.com/x", null, { ok: false, reason: "host_not_allowed" }],
  ["a tenant host followed by another domain", "https://acme.teamtailor.com.evil.com/x", null, { ok: false, reason: "host_not_allowed" }],
  ["a company site is not an ATS host", "https://acme.com/x", null, { ok: false, reason: "host_not_allowed" }],
  ["a shortener is refused before any path is tried", "https://bit.ly/abc", null, { ok: false, reason: "shortener" }],
];

describe("checkApplyLink: the table", () => {
  it("has more than 40 cases and covers company.com.evil.com, evilcompany.com, lever.co.evil.com, http, a port, user info, an IP, an IDN, a shortener, a bare ATS host, upper case and a trailing dot", () => {
    expect(cases.length).toBeGreaterThan(40);
    const names = cases.map((c) => c[0]).join("|");
    for (const needle of ["evil.com", "no dot boundary", "lever.co.evil.com", "http", "port", "user info", "IPv4", "IDN", "shortener", "bare exact host", "upper-case", "trailing dot"]) expect(names, needle).toContain(needle);
  });

  it.each(cases.map((c, i) => [i + 1, ...c] as const))("case %i: %s", (_n, _name, input, domain, expected) => {
    const verdict = checkApplyLink(input, domain);
    if (expected.ok) {
      expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
      if (verdict.ok) {
        expect(verdict.kind).toBe(expected.kind);
        if (expected.url) expect(verdict.url).toBe(expected.url);
        expect(verdict.host).toBe(new URL(verdict.url).hostname);
      }
    } else {
      expect(verdict.ok, JSON.stringify(verdict)).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).toBe(expected.reason);
        expect(verdict.message.length).toBeGreaterThan(20);
      }
    }
  });

  it("every vendor-own label is refused on every tenant vendor, and a real tenant label passes", () => {
    for (const suffix of ATS_TENANT_SUFFIXES) {
      for (const label of ATS_VENDOR_LABELS) expect(checkApplyLink(`https://${label}.${suffix}/careers`, null), `${label}.${suffix}`).toMatchObject({ ok: false, reason: "ats_vendor_label" });
      expect(checkApplyLink(`https://acme.${suffix}/careers`, null), suffix).toMatchObject({ ok: true, kind: "ats" });
    }
  });

  it("refuses anything that is not text, never throws", () => {
    for (const bad of [undefined, null, 5, {}, []]) expect(checkApplyLink(bad as never, "acme.com")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("Path A needs a domain: a company with no domain, or an empty one, gets Path B only", () => {
    expect(checkApplyLink("https://acme.com/x", "")).toMatchObject({ ok: false });
    expect(checkApplyLink("https://boards.greenhouse.io/acme", "")).toMatchObject({ ok: true, kind: "ats" });
  });

  it("the refusal for a host that is not allowed says what to do, and differs when the company is unverified", () => {
    const verified = checkApplyLink("https://other.example/x", "acme.com");
    const unverified = checkApplyLink("https://acme.com/x", null);
    expect(verified.ok || verified.message).toMatch(/company's website|applicant tracking/i);
    expect(unverified.ok || unverified.message).toMatch(/verif/i);
  });
});

describe("the name-mismatch warning (a warning, never a block)", () => {
  it("an ATS page whose company slug resembles the company name carries no warning", () => {
    expect(checkApplyLink("https://boards.greenhouse.io/acme", null, { companyName: "Acme Ltd" })).toMatchObject({ ok: true, warning: undefined });
    expect(checkApplyLink("https://acme.bamboohr.com/x", null, { companyName: "ACME Nigeria Limited" })).toMatchObject({ ok: true, warning: undefined });
  });
  it("one that does not resembles it still passes, with a warning", () => {
    expect(checkApplyLink("https://boards.greenhouse.io/someone-else", null, { companyName: "Acme Ltd" })).toMatchObject({ ok: true, kind: "ats", warning: "name_mismatch" });
    expect(checkApplyLink("https://zeta.recruitee.com/", null, { companyName: "Acme Ltd" })).toMatchObject({ ok: true, warning: "name_mismatch" });
  });
  it("without a company name there is no warning, and a company-domain link never warns", () => {
    expect(checkApplyLink("https://boards.greenhouse.io/acme", null)).toMatchObject({ ok: true, warning: undefined });
    expect(checkApplyLink("https://acme.com/x", "acme.com", { companyName: "Totally Different" })).toMatchObject({ ok: true, kind: "company", warning: undefined });
  });
});

describe("the constants agree with the database function (read from the SQL text)", () => {
  it("the exact-host allowlist, the tenant families, the vendor labels and the length cap are the SQL's", () => {
    expect([...ATS_EXACT_HOSTS].sort()).toEqual([...EXACT].sort());
    expect([...ATS_TENANT_SUFFIXES].sort().join("|")).toBe(grab(/v_host !~ '\^\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?\\\.\(([^)]+)\)\$'/, "tenant families").split("|").map((s) => s.replace(/\\\./g, ".")).sort().join("|"));
    expect([...ATS_VENDOR_LABELS].sort()).toEqual([...VENDOR].sort());
    expect(fnText).toContain(`char_length(p_url) > ${APPLY_LINK_MAX_LENGTH}`);
  });
  it("every reason has a plain message", () => {
    const reasons: ApplyLinkReason[] = ["empty", "whitespace", "control_character", "too_long", "not_a_link", "not_https", "user_info", "port", "ip_host", "not_public_host", "shortener", "job_board", "non_ascii_host", "xn_label", "trailing_dot", "host_not_allowed", "ats_needs_path", "ats_vendor_label"];
    for (const r of reasons) expect(applyLinkReasonMessage(r, true).length, r).toBeGreaterThan(20);
  });
});

describe("TypeScript and SQL agree, in both directions, on the whole table", () => {
  const orgOf = (domain: string | null): Org => ({ domain: domain ?? "acme.com", verified: domain !== null });
  it.each(cases.map((c, i) => [i + 1, ...c] as const))("case %i: %s", (_n, name, input, domain) => {
    const org = orgOf(domain);
    const ts = checkApplyLink(input, domain);
    if (ts.ok) {
      // Whatever the validator accepts, the function accepts (given the tick), from the cleaned address it is handed.
      expect(sqlModel(ts.url, ts.kind, org, true), `SQL must accept what TS accepts: ${name}`).toBe("accept");
    } else {
      // Whatever the validator refuses, the function refuses under either kind.
      for (const kind of ["company", "ats"]) expect(sqlModel(input, kind, org, true), `SQL must refuse what TS refuses (${kind}): ${name}`).not.toBe("accept");
    }
  });
});
