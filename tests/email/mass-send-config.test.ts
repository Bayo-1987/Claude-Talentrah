import { describe, expect, it } from "vitest";
import {
  MIN_REQUEST_GAP_MS,
  MassSendConfigError,
  PROVIDER_MAX_PER_REQUEST,
  massSendIdentity,
  resolveMassSendConfig,
} from "@/lib/email/mass-send-config";

describe("the pace configuration", () => {
  it("the first release is the provider's maximum of 100 per request, one request every 2000 ms", () => {
    expect(PROVIDER_MAX_PER_REQUEST).toBe(100);
    expect(MIN_REQUEST_GAP_MS).toBe(2000);
    expect(resolveMassSendConfig()).toEqual({ perRequest: 100, gapMs: 2000 });
  });

  it("the pace config cannot be set above the provider's 100 per request", () => {
    expect(() => resolveMassSendConfig({ perRequest: 101 })).toThrow(MassSendConfigError);
    expect(() => resolveMassSendConfig({ perRequest: 500 })).toThrow(/maximum of 100/);
    expect(resolveMassSendConfig({ perRequest: 100 }).perRequest).toBe(100);
  });

  it("a smaller batch is allowed, a nonsense one is not", () => {
    expect(resolveMassSendConfig({ perRequest: 30 }).perRequest).toBe(30);
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(() => resolveMassSendConfig({ perRequest: bad })).toThrow(MassSendConfigError);
  });

  it("the gap between requests cannot be shorter than 2000 ms", () => {
    expect(() => resolveMassSendConfig({ gapMs: 1999 })).toThrow(MassSendConfigError);
    expect(() => resolveMassSendConfig({ gapMs: 0 })).toThrow(MassSendConfigError);
    expect(resolveMassSendConfig({ gapMs: 5000 }).gapMs).toBe(5000);
  });
});

describe("the mass-send identity", () => {
  it("reads its from-address from configuration and has no fallback: unset means no identity", () => {
    expect(massSendIdentity({})).toBeNull();
    expect(massSendIdentity({ MASS_EMAIL_FROM: "   " })).toBeNull();
  });

  it("returns the configured address and the optional reply-to", () => {
    expect(massSendIdentity({ MASS_EMAIL_FROM: "Talentrah <announce@mail.example.test>" })).toEqual({
      from: "Talentrah <announce@mail.example.test>",
      replyTo: null,
    });
    expect(massSendIdentity({ MASS_EMAIL_FROM: "a@mail.example.test", MASS_EMAIL_REPLY_TO: "help@example.test" })).toEqual({
      from: "a@mail.example.test",
      replyTo: "help@example.test",
    });
  });
});
