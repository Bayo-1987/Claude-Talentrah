/**
 * The Farah panel's message box: what Enter does, and what counts as a message. Pure logic plus the real handler called with a stand-in event (this project's unit environment has no DOM; real typing is e2e).
 *
 *   Enter            sends, once (a held key's repeats do not), on a keyboard with a fine pointer (desktop)
 *   Shift+Enter      inserts a line break and sends nothing
 *   Enter while an input method is composing (IME)  never sends: it confirms the composition
 *   Enter on a touch device (coarse pointer)        inserts a line break; the send button is how a message is sent there
 *   an empty, whitespace-only or newline-only box   sends nothing, and Enter does not add a stray line break
 *   while a reply is streaming                      sends nothing
 */
import { describe, expect, it, vi } from "vitest";
import { composerKeyAction, handleComposerKeyDown, prepareMessage, shouldRefocusAfterSend, type ComposerKeyEvent } from "@/lib/farah/composer";

const base = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, repeat: false, coarsePointer: false, text: "hello", pending: false };

describe("composerKeyAction", () => {
  it("plain Enter on a keyboard sends", () => expect(composerKeyAction(base)).toBe("send"));
  it("Shift+Enter is a line break", () => expect(composerKeyAction({ ...base, shiftKey: true })).toBe("default"));
  it("Enter while an input method is composing never sends", () => expect(composerKeyAction({ ...base, isComposing: true })).toBe("default"));
  it("a held Enter does not send again", () => expect(composerKeyAction({ ...base, repeat: true })).toBe("block"));
  it("Enter on a touch device is a line break, not a send", () => expect(composerKeyAction({ ...base, coarsePointer: true })).toBe("default"));
  it("Enter on an empty box sends nothing and adds no line break", () => expect(composerKeyAction({ ...base, text: "" })).toBe("block"));
  it("Enter on a whitespace-only box sends nothing", () => expect(composerKeyAction({ ...base, text: "   \t " })).toBe("block"));
  it("Enter on a newline-only box sends nothing", () => expect(composerKeyAction({ ...base, text: "\n\n\r\n" })).toBe("block"));
  it("Enter while a reply is streaming sends nothing", () => expect(composerKeyAction({ ...base, pending: true })).toBe("block"));
  it("a modified Enter (Ctrl, Cmd, Alt) is left to the browser", () => {
    for (const m of ["ctrlKey", "metaKey", "altKey"]) expect(composerKeyAction({ ...base, [m]: true })).toBe("default");
  });
  it("any other key is left alone", () => {
    for (const key of ["a", " ", "Tab", "Escape", "ArrowUp", "Backspace"]) expect(composerKeyAction({ ...base, key })).toBe("default");
  });
});

describe("handleComposerKeyDown: the real handler, with a stand-in event", () => {
  const event = (over: Partial<ComposerKeyEvent> = {}) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), ...over });
  const deps = (over = {}) => ({ text: "hello", pending: false, coarsePointer: () => false, onSend: vi.fn(), ...over });

  it("Enter sends once and stops the browser's own line break", () => {
    const e = event(), d = deps();
    handleComposerKeyDown(e, d);
    expect(d.onSend).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });
  it("Shift+Enter inserts a line break (the default is NOT prevented) and sends nothing", () => {
    const e = event({ shiftKey: true }), d = deps();
    handleComposerKeyDown(e, d);
    expect(d.onSend).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
  it("Enter during composition sends nothing and leaves the key to the input method", () => {
    const e = event({ nativeEvent: { isComposing: true } }), d = deps();
    handleComposerKeyDown(e, d);
    expect(d.onSend).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
  it("Enter on a touch device sends nothing and leaves the line break to the keyboard", () => {
    const e = event(), d = deps({ coarsePointer: () => true });
    handleComposerKeyDown(e, d);
    expect(d.onSend).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
  it("Enter on an empty or newline-only box sends nothing and is swallowed (no stray line break)", () => {
    for (const text of ["", "  ", "\n", "\n \n"]) {
      const e = event(), d = deps({ text });
      handleComposerKeyDown(e, d);
      expect(d.onSend, JSON.stringify(text)).not.toHaveBeenCalled();
      expect(e.preventDefault, JSON.stringify(text)).toHaveBeenCalledTimes(1);
    }
  });
  it("a held Enter sends once, not once per repeat", () => {
    const d = deps();
    handleComposerKeyDown(event(), d);
    handleComposerKeyDown(event({ repeat: true }), d);
    handleComposerKeyDown(event({ repeat: true }), d);
    expect(d.onSend).toHaveBeenCalledTimes(1);
  });
  it("Enter while a reply streams sends nothing", () => {
    const e = event(), d = deps({ pending: true });
    handleComposerKeyDown(e, d);
    expect(d.onSend).not.toHaveBeenCalled();
  });
});

describe("prepareMessage: what is sent", () => {
  it("keeps the line breaks inside the message exactly, and trims only the ends", () => {
    expect(prepareMessage("  first line\nsecond line\n\nthird  \n")).toBe("first line\nsecond line\n\nthird");
  });
  it("a one-line message is unchanged", () => expect(prepareMessage("hello")).toBe("hello"));
  it("empty, whitespace-only and newline-only boxes are not a message", () => {
    for (const t of ["", "   ", "\n", "\n\n\n", " \r\n \t\n"]) expect(prepareMessage(t), JSON.stringify(t)).toBeNull();
  });
});

describe("shouldRefocusAfterSend: focus goes back to the box after a reply, only when it was lost to the disabled box", () => {
  const ok = { wasPending: true, pending: false, focusIsNeutral: true, coarsePointer: false };
  it("a reply just finished, focus was dropped (on the page body): back to the box", () => expect(shouldRefocusAfterSend(ok)).toBe(true));
  it("not while the reply is still streaming", () => expect(shouldRefocusAfterSend({ ...ok, pending: true })).toBe(false));
  it("not when nothing was pending before (no reply just finished)", () => expect(shouldRefocusAfterSend({ ...ok, wasPending: false })).toBe(false));
  it("not when the person moved focus somewhere else on purpose (a link, a chip, another field)", () => expect(shouldRefocusAfterSend({ ...ok, focusIsNeutral: false })).toBe(false));
  it("not on a touch device: it would bring the on-screen keyboard up uninvited", () => expect(shouldRefocusAfterSend({ ...ok, coarsePointer: true })).toBe(false));
});
