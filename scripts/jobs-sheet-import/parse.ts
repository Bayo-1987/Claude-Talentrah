/**
 * Re-export: the sheet reader moved to src/lib/jobs/sheet-import/parse.ts so the admin uploader can use it. It reads the sheet's own `apply_email` cell (the leaks test names this file for that).
 */
export * from "../../src/lib/jobs/sheet-import/parse";
