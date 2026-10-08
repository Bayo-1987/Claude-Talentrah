/**
 * Owner rule: an error keeps what was typed. A form that submits through a Server Action (`<form action>` with useActionState) is RESET by React 19 after the action, whatever
 * it returned, so uncontrolled fields come back empty. The shared answer: the action returns the submitted values with its error (`values: submittedValues(formData, FIELDS)`) and the
 * form uses them as the fields' defaults (`inputValue(state.values, "email", saved)`), which is what the reset puts back. A success returns no values, so the next visit starts clean.
 * Secrets never travel back: a field whose name looks like a password, token or code is refused, and a File is never echoed.
 */
import { describe, expect, it } from "vitest";
import { inputValue, selectKey, submittedValues } from "@/lib/forms/keep-input";

function form(entries: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("submittedValues", () => {
  it("returns the listed fields exactly as typed (no trimming, no lower-casing) and nothing else", () => {
    const v = submittedValues(form({ email: " Ada@X.com ", displayName: "Ada  L", id: "hidden-id", extra: "x" }), ["email", "displayName"]);
    expect(v).toEqual({ email: " Ada@X.com ", displayName: "Ada  L" });
  });
  it("a listed field that was not submitted comes back as an empty string", () => {
    expect(submittedValues(form({ a: "1" }), ["a", "b"])).toEqual({ a: "1", b: "" });
  });
  it("a file is never echoed back", () => {
    expect(submittedValues(form({ title: "T", cover: new File(["x"], "c.png") }), ["title", "cover"])).toEqual({ title: "T", cover: "" });
  });
  it("refuses a field that looks like a secret (password, passphrase, secret, token, otp, pin, cvv, card number)", () => {
    for (const name of ["password", "newPassword", "confirm_password", "passphrase", "apiSecret", "accessToken", "otp", "pin", "cvv", "cardNumber"]) {
      expect(() => submittedValues(form({ [name]: "x" }), [name]), name).toThrow(/never echoed/);
    }
  });
  it("does not refuse ordinary names that merely contain those letters", () => {
    for (const name of ["spinner", "company", "description", "displayName", "title", "slug", "body"]) {
      expect(() => submittedValues(form({ [name]: "x" }), [name]), name).not.toThrow();
    }
  });
});

describe("inputValue", () => {
  it("after a failed save the submitted value wins, even when it is empty (the operator emptied it on purpose)", () => {
    expect(inputValue({ title: "Typed" }, "title", "Saved")).toBe("Typed");
    expect(inputValue({ author: "" }, "author", "Saved", "Default")).toBe("");
  });
  it("with no submitted values (first visit, or after a success) it is the saved value, then the fallback, then empty", () => {
    expect(inputValue(undefined, "title", "Saved")).toBe("Saved");
    expect(inputValue(undefined, "author", undefined, "The Talentrah Team")).toBe("The Talentrah Team");
    expect(inputValue(undefined, "author", null)).toBe("");
  });
  it("a field not among the submitted values falls back to the saved value", () => {
    expect(inputValue({ title: "T" }, "slug", "saved-slug")).toBe("saved-slug");
  });
});

describe("selectKey", () => {
  it("changes when a failed save hands a different value back, so a <select> remounts with the new default (React does not apply a changed defaultValue to a select after mount)", () => {
    expect(selectKey(undefined, "roleId")).not.toBe(selectKey({ roleId: "r1" }, "roleId"));
    expect(selectKey({ roleId: "r1" }, "roleId")).not.toBe(selectKey({ roleId: "r2" }, "roleId"));
  });
  it("is stable for the same value, and does not collide across fields", () => {
    expect(selectKey({ roleId: "r1" }, "roleId")).toBe(selectKey({ roleId: "r1" }, "roleId"));
    expect(selectKey({ a: "x" }, "a")).not.toBe(selectKey({ a: "x" }, "b"));
  });
});
