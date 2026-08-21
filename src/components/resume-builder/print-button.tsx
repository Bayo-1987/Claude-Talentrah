"use client";

import { Button } from "@/components/ui";

/**
 * PDF export via the browser's native print-to-PDF, per plan doc M4 — no
 * server-side PDF library needed. DOCX export is explicitly not implemented
 * in Phase 1.
 */
export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()} className="print:hidden">
      Download PDF
    </Button>
  );
}
