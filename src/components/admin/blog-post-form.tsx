"use client";

import { useActionState, useState } from "react";
import { TextField, Button, EyebrowLabel } from "@/components/ui";
import type { BlogActionState } from "@/lib/admin/blog/actions";

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
export function BlogPostForm({ action, post, previewHtml, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, initial);
  const [tab, setTab] = useState<"write" | "preview">("write");

  const err = (field: string) => state.fieldErrors?.[field]?.[0];

  return (
    <div className="flex flex-col gap-6">
      {state.status !== "idle" && state.message && (
        <p
          className={
            state.status === "error"
              ? "border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust"
              : "border-[1.5px] border-green px-3.5 py-2.5 text-[13.5px] text-green"
          }
        >
          {state.message}
        </p>
      )}

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
          <TextField label="Title" name="title" defaultValue={post?.title} required error={err("title")} />
          <div className="flex flex-col gap-1.5">
            <TextField label="Slug" name="slug" defaultValue={post?.slug} required error={err("slug")} />
            <p className="text-[12.5px] text-ink-soft">
              Becomes the public URL: /blog/your-slug. Lowercase, hyphens, no spaces.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <TextField
              label="Description"
              name="description"
              defaultValue={post?.description}
              required
              error={err("description")}
            />
            <p className="text-[12.5px] text-ink-soft">
              The search result and share-card snippet. Around 155 characters reads best.
            </p>
          </div>
          <TextField label="Author" name="author" defaultValue={post?.author ?? "The Talentrah Team"} required error={err("author")} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="body" className="font-body text-[13px] font-semibold">
              Body
            </label>
            <textarea
              id="body"
              name="body"
              defaultValue={post?.body}
              required
              rows={22}
              className="border-[1.5px] border-ink bg-card p-3 font-mono text-[13.5px] leading-[1.6]"
            />
            <p className="text-[12.5px] text-ink-soft">
              Markdown. Headings with ##, bullets with -, bold with **. Raw HTML is stripped.
            </p>
            {err("body") && <p className="text-[12.5px] text-rust">{err("body")}</p>}
          </div>

          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : submitLabel}
          </Button>
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
