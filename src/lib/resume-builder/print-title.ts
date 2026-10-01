/**
 * The saved PDF's default filename. Chromium (and Safari) name the file from
 * `document.title` at the moment the print dialog opens, so with the app's own
 * page title ("Edit resume — Talentrah") every export used to arrive as
 * `Edit resume — Talentrah.pdf` — and an employer receiving it saw that. The
 * Save-as-PDF buttons set `<First>-<Last>-Resume` for the duration of the
 * print and put the real title back afterwards.
 */

/** Characters no mainstream filesystem accepts in a filename. */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * `Ada Obi` -> `Ada-Obi-Resume`. First and last name only (a middle name is
 * noise in a filename), unicode letters kept, filesystem-unsafe characters
 * dropped, and a missing or unusable name falls back to plain `Resume` rather
 * than something like `-Resume`.
 */
export function resumePrintTitle(name: string | undefined | null): string {
  // Split on whitespace BEFORE stripping: tab/newline are control characters
  // too, and removing them first would glue "Ada\tObi" into "AdaObi".
  const parts = (name ?? "")
    .split(/\s+/)
    .map((part) => part.replace(UNSAFE_FILENAME_CHARS, ""))
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "Resume";
  const nameParts = parts.length === 1 ? parts : [parts[0], parts[parts.length - 1]];
  return `${nameParts.join("-")}-Resume`;
}

/**
 * How long to wait for `afterprint` before restoring the title anyway.
 * Chromium's `print()` blocks until the dialog closes and then fires
 * `afterprint`; a browser with a non-blocking print UI fires it later. The
 * timer only exists so a browser that never fires it cannot leave the tab
 * titled "Ada-Obi-Resume" for good, so it is deliberately long.
 */
export const PRINT_TITLE_FALLBACK_MS = 60_000;

/** The slice of `document` / `window` this module touches — narrow so it can be faked in a node-environment test. */
interface TitleDocument {
  title: string;
}
interface PrintWindow {
  addEventListener(type: "afterprint", listener: () => void): void;
  removeEventListener(type: "afterprint", listener: () => void): void;
  setTimeout(handler: () => void, timeoutMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

/**
 * Runs `print` with `document.title` set to `title`, and restores the
 * original title on `afterprint`, when `print` throws, or (last resort) after
 * `PRINT_TITLE_FALLBACK_MS`. Restoration happens exactly once, and never
 * overwrites a title something else has set in the meantime.
 */
export function printWithTitle(
  title: string,
  {
    print = () => window.print(),
    doc = document,
    win = window,
  }: { print?: () => void; doc?: TitleDocument; win?: PrintWindow } = {},
): void {
  const original = doc.title;
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    win.removeEventListener("afterprint", restore);
    win.clearTimeout(timer);
    // Only undo our own write: if the page was retitled meanwhile (a route
    // change while a non-blocking print UI was open), that title is newer.
    if (doc.title === title) doc.title = original;
  };

  doc.title = title;
  win.addEventListener("afterprint", restore);
  // `restore` only ever runs after this line (afterprint, the timer itself, or
  // the catch below), so it sees `timer` initialised.
  const timer = win.setTimeout(restore, PRINT_TITLE_FALLBACK_MS);
  try {
    print();
  } catch (error) {
    restore();
    throw error;
  }
}
