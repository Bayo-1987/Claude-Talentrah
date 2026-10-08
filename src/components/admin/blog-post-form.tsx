"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { TextField, Button, EyebrowLabel } from "@/components/ui";
import { TextArea } from "@/components/ui/text-area";
import type { BlogActionState } from "@/lib/admin/blog/actions";
import { inputValue } from "@/lib/forms/keep-input";
import { BlogSaveNotice } from "@/components/admin/blog-save-notice";

const initial: BlogActionState = { status: "idle" };

interface Props {
  action: (prev: BlogActionState, formData: FormData) => Promise<BlogActionState>;
  post?: {
    id: string;
    slug: string;
    title: string;
    description: string;
    author: string;
    body: string;
  };
  /** Whether the post is live: a saved published post gets a "View post" link, a draft says it is not public yet. */
  published?: boolean;
  /** Server-rendered preview HTML, refreshed on save. */
  previewHtml?: string;
  submitLabel: string;
}

/**
 * The post editor.
 *
 * ── THE PREVIEW IS IN HERE, AND THAT IS THE POINT ─────────────────────────
 *
 * There is deliberately NO public preview URL for unpublished content — no
 * signed link, no `?preview=` parameter, no exception. The moment a draft is
 * reachable by URL it is reachable by anyone holding the URL, and 0074's whole
 * guarantee is that a draft is unreadable outside an admin session.
 *
 * So the preview lives on this page, behind requireAdmin(), rendered by the
 * same `renderMarkdown` the public post uses. What an operator sees here is
 * what the post will look like, produced by the identical code path rather
 * than an approximation of it.
 *
 * The preview shown is of the SAVED body, refreshed when the form is
 * submitted. A live-as-you-type preview would mean either shipping the
 * Markdown renderer to the browser or a request per keystroke, and neither is
 * worth it for a screen where saving is one click.
 */
export function BlogPostForm({ action, post, published = false, previewHtml, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, initial);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const noticeRef = useRef<HTMLDivElement>(null);
  // After a save (or a refused save) bring the result into view, whatever the scroll position of the long form.
  useEffect(() => {
    if (state.status !== "idle") noticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [state]);

  const err = (field: string) => state.fieldErrors?.[field]?.[0];
  // A failed save hands the submitted values back, and React 19 resets the form after any action to its defaults, so those are the defaults (owner rule: an error keeps what was typed).
  const keep = (field: "title" | "slug" | "description" | "author" | "body", fallback?: string) => inputValue(state.values, field, post?.[field], fallback);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-5 border-b border-line">
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              "min-h-10 font-body text-[13px] font-bold tracking-[0.1em] uppercase " +
              (tab === t ? "border-b-2 border-ink text-ink" : "text-ink-soft")
            }
          >
            {t}
          </button>
        ))}
      </div>

      {/*
        BOTH PANELS STAY MOUNTED, one hidden. Unmounting the form to show the
        preview would throw away everything typed since the last save, which is
        the single worst thing a writing screen can do.
      */}
      <div className={tab === "preview" ? "hidden" : "block"}>
        <form action={formAction} className="flex flex-col gap-5">
          {post && <input type="hidden" name="id" value={post.id} />}
          <TextField label="Title" name="title" defaultValue={keep("title")} required error={err("title")} />
          <div className="flex flex-col gap-1.5">
            <TextField label="Slug" name="slug" defaultValue={keep("slug")} required error={err("slug")} />
            <p className="text-[12.5px] text-ink-soft">
              Becomes the public URL: /blog/your-slug. Lowercase, hyphens, no spaces.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <TextField
              label="Description"
              name="description"
              defaultValue={keep("description")}
              required
              error={err("description")}
            />
            <p className="text-[12.5px] text-ink-soft">
              The search result and share-card snippet. Around 155 characters reads best.
            </p>
          </div>
          <TextField label="Author" name="author" defaultValue={keep("author", "The Talentrah Team")} required error={err("author")} />

          <TextArea
            id="body"
            name="body"
            label="Body"
            defaultValue={keep("body")}
            required
            minRows={22}
            mono
            error={err("body") ?? undefined}
            help={
              <>
                Markdown. Headings with ##, bullets with -, bold with **. Raw HTML is stripped.
                To embed a live scholarship fact card (provider, deadline, a link — always current,
                never frozen at publish time), put{" "}
                <code className="bg-paper-alt px-1">
                  [[scholarship:&lt;its id&gt;]]
                </code>{" "}
                on its own line. If the listing later closes, it falls back to a plain notice
                automatically.
              </>
            }
          />

          <div className="flex flex-col items-start gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
            {/* Right beside the button, where the operator is looking: the old banner at the top of this long form was never seen. */}
            <div ref={noticeRef} className="scroll-mb-6">
              <BlogSaveNotice state={state} slug={post?.slug ?? ""} published={published} />
            </div>
          </div>
        </form>
      </div>

      <div className={tab === "preview" ? "block" : "hidden"}>
        <EyebrowLabel size="sm">Preview — as it will appear</EyebrowLabel>
        {previewHtml ? (
          <div
            className="mt-4 flex max-w-[760px] flex-col gap-6"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <p className="mt-4 text-[14px] text-ink-soft">
            Save the post to see it rendered here.
          </p>
        )}
      </div>
    </div>
  );
}
