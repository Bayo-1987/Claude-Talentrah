import Link from "next/link";
import { demoRefusalMessage, type DemoRefusalReason } from "@/lib/demo/refusal-copy";

/**
 * A refused homepage-demo visitor: the reason, and the way forward. The route sends its own wording with the
 * reason; that wins when present (the route may be ahead of a cached client), and otherwise the shared copy
 * for the reason is used, so no refusal can render empty.
 */
export function JdDemoRefusal({ reason, message }: { reason: DemoRefusalReason; message?: string }) {
  return (
    <div
      aria-live="polite"
      className="flex flex-col items-center gap-2 border-[1.5px] border-ink bg-card px-5 py-4 text-center"
    >
      <p className="text-[14px] text-ink">{message ?? demoRefusalMessage(reason)}</p>
      <Link href="/signup" className="text-[13.5px] font-bold text-rust underline underline-offset-3">
        Create a free account →
      </Link>
    </div>
  );
}
