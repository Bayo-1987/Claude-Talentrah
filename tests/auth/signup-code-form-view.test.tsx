/**
 * The markup of the signup code page (S1-101): the input's attributes, the labelling, the announced regions, the cooldown button, and the things that must
 * not be in it. Rendered with react-dom/server, the repo's convention (no browser here); the behaviour in a real browser is e2e/signup-code.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SignupCodeEnded, SignupCodeFormView, type SignupCodeFormViewProps } from "@/components/auth/signup-code-form";
import { initialCodeState, initialResendCodeState } from "@/lib/auth/code-state";

const noop = () => {};
function view(over: Partial<SignupCodeFormViewProps> = {}) {
  return renderToStaticMarkup(
    <SignupCodeFormView
      maskedEmail="a••••@example.com"
      code=""
      onCodeChange={noop}
      verifyAction={noop}
      verifyPending={false}
      state={initialCodeState}
      resendAction={noop}
      resendPending={false}
      resendState={initialResendCodeState}
      secondsLeft={0}
      startOverAction={noop}
      webmailUrl={null}
      {...over}
    />,
  );
}
const inputTag = (html: string) => html.match(/<input[^>]*id="code"[^>]*>/)![0];

describe("the code input", () => {
  it("is a text field with the numeric keypad and the one-time-code hint, named and id'd 'code'", () => {
    const tag = inputTag(view());
    expect(tag).toContain('type="text"');
    expect(tag).toContain('inputMode="numeric"');
    expect(tag).toContain('autoComplete="one-time-code"');
    expect(tag).toContain('name="code"');
  });

  it("does not cut a paste short: no maxLength, and not type=number (which drops leading zeros and shows spinners)", () => {
    const tag = inputTag(view());
    expect(tag).not.toMatch(/maxLength/i);
    expect(tag).not.toContain('type="number"');
  });

  it("is labelled: a <label for='code'> says what to enter", () => {
    expect(view()).toMatch(/<label[^>]*for="code"[^>]*>6-digit code<\/label>/);
  });

  it("shows what was typed", () => {
    expect(inputTag(view({ code: "123456" }))).toContain('value="123456"');
  });

  it("has a visible focus style", () => {
    expect(inputTag(view())).toContain("focus-visible:outline-2");
  });

  it("is marked invalid and linked to its error when the code is not six digits", () => {
    const html = view({ state: { ...initialCodeState, status: "error", fieldError: "Enter the 6-digit code from the email.", code: "12" } });
    const tag = inputTag(html);
    expect(tag).toContain('aria-invalid="true"');
    expect(tag).toContain('aria-describedby="code-error"');
    expect(html).toContain('<p id="code-error"');
    expect(html).toContain("Enter the 6-digit code from the email.");
  });

  it("is not marked invalid when there is no field error", () => {
    expect(inputTag(view())).not.toContain("aria-invalid");
  });
});

describe("what is announced", () => {
  it("both status regions are in the page from the first render, empty, polite and atomic", () => {
    const html = view();
    for (const id of ["code-status", "resend-status"]) {
      expect(html).toMatch(new RegExp(`<div role="status" aria-live="polite" aria-atomic="true" data-testid="${id}"></div>`));
    }
  });

  it("a refused code's message sits inside the status region", () => {
    const html = view({ state: { ...initialCodeState, status: "error", message: "That code didn't work." } });
    expect(html).toMatch(/data-testid="code-status"><p[^>]*>That code didn&#x27;t work\.<\/p><\/div>/);
  });

  it("the resend message sits inside its own region", () => {
    const html = view({ resendState: { status: "success", message: "We sent a new code. Check your inbox.", cooldownSeconds: 60, ended: false } });
    expect(html).toMatch(/data-testid="resend-status"><p[^>]*>We sent a new code\. Check your inbox\.<\/p><\/div>/);
  });
});

describe("resend and the cooldown", () => {
  const resendButton = (html: string) => html.match(/<button[^>]*>(Resend code[^<]*|Sending…)<\/button>/)!;

  it("while the minute runs the button is disabled and says how long is left", () => {
    const m = resendButton(view({ secondsLeft: 42 }));
    expect(m[0]).toMatch(/\sdisabled(=|\s|>)/);
    expect(m[1]).toBe("Resend code in 42s");
  });

  it("after the minute it is enabled and says 'Resend code'", () => {
    const m = resendButton(view({ secondsLeft: 0 }));
    expect(m[0]).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(m[1]).toBe("Resend code");
  });

  it("while sending it says so and is disabled", () => {
    const m = resendButton(view({ resendPending: true }));
    expect(m[0]).toMatch(/\sdisabled(=|\s|>)/);
  });
});

describe("the address", () => {
  it("shows the masked address and 'Wrong address?' as a form button", () => {
    const html = view();
    expect(html).toContain("a••••@example.com");
    expect(html).toMatch(/<form[^>]*><button type="submit"[^>]*>Wrong address\?<\/button><\/form>/);
  });

  it("puts no address and no query string with an email in any link", () => {
    const html = view({ webmailUrl: "https://mail.google.com/" });
    expect(html).not.toMatch(/href="[^"]*(email=|@|%40)[^"]*"/);
  });

  it("the webmail link opens in a new tab without handing over the opener", () => {
    expect(view({ webmailUrl: "https://mail.google.com/" })).toMatch(/href="https:\/\/mail\.google\.com\/" target="_blank" rel="noopener noreferrer"/);
  });
});

describe("the 'start again' state", () => {
  const html = renderToStaticMarkup(<SignupCodeEnded />);
  it("says plainly what happened and offers the way back, as a link to /signup", () => {
    expect(html).toContain("This step has timed out. Go back to sign up and we&#x27;ll send a new code.");
    expect(html).toMatch(/<a href="\/signup"[^>]*>Back to sign up<\/a>/);
  });
  it("announces its message", () => {
    expect(html).toMatch(/<p[^>]*role="status"[^>]*>This step has timed out/);
  });
});
