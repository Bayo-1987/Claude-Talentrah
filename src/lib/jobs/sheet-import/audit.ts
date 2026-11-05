import "server-only";
import { recordAdminAction, recordAdminActionStrict } from "@/lib/admin/audit";
import { JOBS_IMPORT_AUDIT, type ImportAudit } from "./constants";

/**
 * The real audit writes of the jobs uploader. A row holds counts and short codes only (the callers build the detail from numbers and codes; nothing here adds a title, a company, an
 * address or a database message). `requested` is STRICT: it is written BEFORE any write to job_postings and throws when it cannot be, and then nothing is written. `denied` and
 * `finished` describe something that already happened, so they never throw.
 */
export function realAudit(): ImportAudit {
  return {
    async denied(admin, detail) {
      await recordAdminAction({ identity: admin, action: JOBS_IMPORT_AUDIT.denied, targetTable: "job_postings", targetId: null, detail });
    },
    async requested(admin, detail) {
      return recordAdminActionStrict({ identity: admin, action: JOBS_IMPORT_AUDIT.requested, targetTable: "job_postings", targetId: null, detail });
    },
    async finished(admin, detail) {
      await recordAdminAction({ identity: admin, action: JOBS_IMPORT_AUDIT.finished, targetTable: "job_postings", targetId: null, detail });
    },
  };
}
