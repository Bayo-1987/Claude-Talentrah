/**
 * Time-zone names for the push device registration (N1). The database accepts exactly the names in pg_timezone_names (case-sensitive, no offsets, no padding). The notifications fake
 * checks with the runtime's Intl, which is more lenient on three kinds of name; those are listed apart so the difference is on record and not hidden in a test.
 */
export const ZONE_VALID: ReadonlyArray<string> = ["Africa/Lagos", "UTC", "America/Los_Angeles", "Asia/Kolkata", "Etc/GMT+5", "Pacific/Kiritimati", "EST", "Asia/Calcutta"];
/** Refused by the database AND by the fake. */
export const ZONE_INVALID_BOTH: ReadonlyArray<string> = ["Mars/Olympus", "UTC+1", "Z", "Africa/Lagos ", "Africa//Lagos", "x".repeat(65)];
/** Refused by the database only: the fake's Intl check accepts them. KNOWN DIFFERENCE (reported). */
export const ZONE_INVALID_DB_ONLY: ReadonlyArray<string> = ["africa/lagos", "AFRICA/LAGOS", "PST", "+01:00"];
