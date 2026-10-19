/**
 * An in-memory stand-in for the data export store and its audit writers, for the download tests that must run without a database (tests/data-export/download-*.test.ts).
 * The fake claim is the same rule as claim_data_export_download: owner, generated, unclaimed, undeleted, unexpired, with a path, and it marks the row claimed in the same step.
 * A test installs it with vi.mock(..., async () => (await import("../support/data-export-fake-store")).storeModule()) and likewise auditModule().
 */
import { randomUUID } from "node:crypto";

export interface FakeRow {
  id: string;
  attempt_id: string;
  user_id: string;
  status: string;
  object_path: string | null;
  expires_at: string | null;
  claimed_at: string | null;
  deleted_at: string | null;
}

export interface FakeAudit {
  fn: "downloaded" | "deleted" | "denied";
  exportId: string;
  reason?: string;
}

export const fake = {
  rows: new Map<string, FakeRow>(),
  objects: new Map<string, string>(),
  audit: [] as FakeAudit[],
  calls: { getRow: 0, claim: 0, download: 0, remove: 0, markDeleted: 0 },
  failClaim: false,
  unreadable: false,
  reset(): void {
    this.rows.clear();
    this.objects.clear();
    this.audit.length = 0;
    this.calls = { getRow: 0, claim: 0, download: 0, remove: 0, markDeleted: 0 };
    this.failClaim = false;
    this.unreadable = false;
  },
};

/** A generated, unclaimed export with a file in the fake bucket. */
export function seedExport(over: Partial<FakeRow> & { body?: string } = {}): FakeRow {
  const id = over.id ?? randomUUID();
  const attempt = over.attempt_id ?? randomUUID();
  const path = `${id}/${attempt}.json`;
  const row: FakeRow = {
    id,
    attempt_id: attempt,
    user_id: over.user_id ?? randomUUID(),
    status: "generated",
    object_path: path,
    expires_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
    claimed_at: null,
    deleted_at: null,
    ...over,
  };
  fake.rows.set(row.id, row);
  fake.objects.set(path, over.body ?? JSON.stringify({ tables: { profiles: [{ email: "fixture@example.test" }] } }));
  return row;
}

export function storeModule() {
  return {
    getRow: async (_s: unknown, id: string) => {
      fake.calls.getRow += 1;
      return fake.rows.get(id) ?? null;
    },
    claimDownload: async (_s: unknown, { exportId, userId }: { exportId: string; userId: string }) => {
      fake.calls.claim += 1;
      if (fake.failClaim) throw new Error("claim failed");
      const r = fake.rows.get(exportId);
      if (!r || r.user_id !== userId || r.status !== "generated" || r.claimed_at !== null || r.deleted_at !== null || !r.object_path || !r.expires_at || new Date(r.expires_at).getTime() <= Date.now()) return null;
      r.claimed_at = new Date().toISOString();
      r.status = "downloaded";
      return r.object_path;
    },
    downloadObject: async (_s: unknown, path: string) => {
      fake.calls.download += 1;
      if (fake.unreadable) return null;
      const body = fake.objects.get(path);
      return body === undefined ? null : new Blob([body]);
    },
    removeObject: async (_s: unknown, path: string) => {
      fake.calls.remove += 1;
      fake.objects.delete(path);
      return true;
    },
    markObjectDeleted: async (_s: unknown, { exportId, status }: { exportId: string; attemptId: string; status: string | null }) => {
      fake.calls.markDeleted += 1;
      const r = fake.rows.get(exportId);
      if (!r) return false;
      r.deleted_at = new Date().toISOString();
      if (status) r.status = status;
      return true;
    },
  };
}

export function auditModule() {
  return {
    auditDownloaded: async ({ exportId }: { exportId: string }) => void fake.audit.push({ fn: "downloaded", exportId }),
    auditDeleted: async ({ exportId, reason }: { exportId: string; reason: string }) => void fake.audit.push({ fn: "deleted", exportId, reason }),
    auditDownloadDenied: async ({ exportId }: { exportId: string }) => void fake.audit.push({ fn: "denied", exportId }),
  };
}
