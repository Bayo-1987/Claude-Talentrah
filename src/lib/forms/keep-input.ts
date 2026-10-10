/**
 * "An error keeps what was typed" for forms that submit through a Server Action (owner rule).
 *
 * React 19 RESETS a `<form action>` after the action finishes, whatever it returned, so uncontrolled fields come back empty. The fix is the same everywhere: the action returns the
 * submitted values with its error, and the form uses them as the fields' defaults, which is exactly what the reset puts back:
 *
 *   action:  return { status: "error", message, values: submittedValues(formData, ["email", "displayName"]) };
 *   form:    <TextField name="email" defaultValue={inputValue(state.values, "email", saved?.email)} />
 *
 * A success returns NO values, so the form falls back to the saved value or empty and the next visit starts clean. Secrets never travel back: a field whose name looks like a password,
 * token, code or card number is refused outright (it throws, so the mistake is found the first time the action runs), and a file is never echoed.
 */
export type SubmittedValues = Readonly<Record<string, string>>;

const SECRET_NAME = /pass(word|phrase|code)?(?![a-z])|secret|token|otp|(^|[^a-z])pin([^a-z]|$)|cvv|cvc|card[-_ ]?(number|no|num)/i;

/**
 * The listed fields exactly as typed (no trimming): a field not submitted is an empty string, a File is an empty string. A field named in `options.multi` is a checkbox group: ALL its
 * submitted values (`getAll`), comma-joined in submitted order, nothing ticked being "" (read them back with `inputList`).
 */
export function submittedValues(formData: FormData, fields: readonly string[], options: { multi?: readonly string[] } = {}): SubmittedValues {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (SECRET_NAME.test(field)) throw new Error(`keep-input: "${field}" looks like a secret and is never echoed back`);
    if (options.multi?.includes(field)) {
      out[field] = formData.getAll(field).filter((v): v is string => typeof v === "string").join(",");
      continue;
    }
    const value = formData.get(field);
    out[field] = typeof value === "string" ? value : "";
  }
  return out;
}

/** The ticked values of a checkbox group handed back by `submittedValues(..., { multi })`: `defaultChecked={inputList(state.values, "degreeLevels").includes(value)}`. */
export function inputList(values: SubmittedValues | undefined, field: string): string[] {
  const joined = values?.[field] ?? "";
  return joined === "" ? [] : joined.split(",");
}

/**
 * A React `key` for a `<select>` that must show a value handed back after a failed save. React applies a CHANGED `defaultValue` to text inputs but not to a select after it has mounted, so
 * the post-action reset put the select back on its first option. Keying the select by the returned value remounts it with the right option selected:
 *   <select key={selectKey(state.values, "roleId")} defaultValue={inputValue(state.values, "roleId")}>
 */
export function selectKey(values: SubmittedValues | undefined, field: string): string {
  return `${field}:${values && field in values ? values[field] : ""}`;
}

/** A field's default: what was submitted if a save just failed (even empty), else the saved value, else the fallback, else empty. */
export function inputValue(values: SubmittedValues | undefined, field: string, saved?: string | null, fallback = ""): string {
  if (values && field in values) return values[field];
  return saved ?? fallback;
}
