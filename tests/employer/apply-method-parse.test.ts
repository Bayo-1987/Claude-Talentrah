/**
 * PR-E2b: reading "How should people apply?" from the employer's form, and turning a refusal of the database function into a plain sentence. The database's own text never reaches the person;
 * it goes to the server log with the job and the user. Every address below is invented.
 */
import { describe, expect, it, vi } from "vitest";
import { APPLY_EMAIL_CONFIRM_MESSAGE, APPLY_METHOD_MESSAGES, applyMethodMessage, readApplyMethod, setApplyEmail } from "@/lib/employer/apply-method";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("readApplyMethod", () => {
  it("is 'On Talentrah' unless the form says email, whatever else it carries", () => {
    expect(readApplyMethod(fd({}))).toEqual({ ok: true, method: { kind: "talentrah" } });
    expect(readApplyMethod(fd({ applyMethod: "talentrah", applyEmail: "careers@example.test", applyEmailConfirm: "on" }))).toEqual({ ok: true, method: { kind: "talentrah" } });
    expect(readApplyMethod(fd({ applyMethod: "anything-else" }))).toEqual({ ok: true, method: { kind: "talentrah" } });
  });
  it("by email: the address is normalised and the tick is required", () => {
    expect(readApplyMethod(fd({ applyMethod: "email", applyEmail: " Careers@Example.TEST ", applyEmailConfirm: "on" }))).toEqual({ ok: true, method: { kind: "email", address: "careers@example.test" } });
    expect(readApplyMethod(fd({ applyMethod: "email", applyEmail: "careers@example.test" }))).toEqual({ ok: false, error: APPLY_EMAIL_CONFIRM_MESSAGE });
  });
  it.each(["", "   ", "not-an-address", "a@b", "a@b.co, c@d.co", "a@b.co; c@d.co", "<a@b.co>", "a b@c.co", "a@b.co?cc=x", "mailto:a@b.co", "a..b@c.co", "é@b.co"])("refuses %j with the address sentence, never repaired", (address) => {
    expect(readApplyMethod(fd({ applyMethod: "email", applyEmail: address, applyEmailConfirm: "on" }))).toEqual({ ok: false, error: APPLY_METHOD_MESSAGES.AE003 });
  });
  it("refuses a missing address field", () => {
    expect(readApplyMethod(fd({ applyMethod: "email", applyEmailConfirm: "on" }))).toEqual({ ok: false, error: APPLY_METHOD_MESSAGES.AE003 });
  });
});

describe("the plain sentences", () => {
  it("are exactly the function's own, so a screen and a direct call say the same", () => {
    expect(APPLY_METHOD_MESSAGES.AE001).toBe("This job already has applications on Talentrah, so it can't be switched to email. Close it and post a new job instead.");
    expect(APPLY_METHOD_MESSAGES.AE002).toBe("This job's apply method was changed 5 times in the last 24 hours. Try again tomorrow.");
    expect(APPLY_METHOD_MESSAGES.AE003).toBe("Enter one email address, such as careers@yourcompany.com.");
    expect(APPLY_METHOD_MESSAGES.AE004).toBe("This job's apply method can't be changed.");
    expect(APPLY_METHOD_MESSAGES["42501"]).toBe("We couldn't find that job.");
    expect(APPLY_METHOD_MESSAGES["28000"]).toBe("Sign in again to change how people apply.");
  });
  it("applyMethodMessage maps a known code and falls back for an unknown or missing one", () => {
    expect(applyMethodMessage("AE002", "FALLBACK")).toBe(APPLY_METHOD_MESSAGES.AE002);
    expect(applyMethodMessage("XX000", "FALLBACK")).toBe("FALLBACK");
    expect(applyMethodMessage(undefined, "FALLBACK")).toBe("FALLBACK");
  });
});

describe("setApplyEmail", () => {
  const MARKER = 'function raised "zz_marker_4417" for the job';
  const client = (error: null | { code?: string; message: string }) => {
    const rpc = vi.fn(async () => ({ data: null, error }));
    return { rpc: rpc as never, calls: rpc };
  };

  it("calls the function with the job and the address (null clears)", async () => {
    const a = client(null);
    expect(await setApplyEmail(a, "job-1", "careers@example.test", { userId: "u1", fallback: "TRY" })).toEqual({ ok: true });
    expect(a.calls).toHaveBeenCalledWith("set_job_apply_email", { p_job_id: "job-1", p_address: "careers@example.test" });
    const b = client(null);
    await setApplyEmail(b, "job-1", null, { userId: "u1", fallback: "TRY" });
    expect(b.calls).toHaveBeenCalledWith("set_job_apply_email", { p_job_id: "job-1", p_address: null });
  });

  it.each(["AE001", "AE002", "AE003", "AE004", "42501", "28000"] as const)("a refusal with code %s shows its sentence, never the database's text, and logs the real text with the job and user", async (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await setApplyEmail(client({ code, message: MARKER }), "job-7", "careers@example.test", { userId: "user-9", fallback: "TRY" });
    expect(out).toEqual({ ok: false, error: APPLY_METHOD_MESSAGES[code] });
    const logged = log.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    log.mockRestore();
    expect(logged).toContain("zz_marker_4417");
    expect(logged).toContain("job-7");
    expect(logged).toContain("user-9");
  });

  it("an unknown code gets the try-again line, and the database's text stays out of it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await setApplyEmail(client({ code: "XX000", message: MARKER }), "job-7", null, { userId: "user-9", fallback: "Please try again." });
    log.mockRestore();
    expect(out).toEqual({ ok: false, error: "Couldn't change how people apply. Please try again." });
    expect(JSON.stringify(out)).not.toContain("zz_marker_4417");
  });
});
