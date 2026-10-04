/**
 * Docked panel quick-actions (build-prompt §6.5 / §5 IA).
 *
 * CV Builder and Cover Letter Builder — pure navigation shortcuts, `href`
 * set and `starterPrompt: null`, into /resume-builder and /tailor — were
 * dropped 2026-09-08. Every entry left here opens the chat with a starter
 * prompt and behaves as normal conversation from there; a generic
 * panel-wide link to either flow duplicated navigation already reachable
 * elsewhere without adding anything a conversation actually does. `href`
 * stays on the type — every remaining entry happens to be chat-only, but
 * the type itself still describes either shape.
 */
import { FARAH_CHIPS } from "./chip-registry";

export interface FarahQuickAction {
  key: string;
  label: string;
  href: string | null;
  starterPrompt: string | null;
}

/**
 * Derived from the chip registry (chip-registry.ts), which is the one place a chip is defined. Order, labels and starter prompts are exactly the
 * three chips every page has shown since the panel shipped; tests/farah/chip-registry.test.ts pins them.
 */
export const FARAH_QUICK_ACTIONS: FarahQuickAction[] = FARAH_CHIPS.filter((c) => c.surface === "panel").map(({ key, label, starterPrompt }) => ({
  key,
  label,
  href: null,
  starterPrompt,
}));
