/**
 * /admin/blog/[id]: "Save changes" gave no visible feedback. The only confirmation was a small green "Saved." banner at the very TOP of a long form (the Write/Preview tabs and a 22-row body
 * sit between it and the button), so the operator never saw it. Now: a confirmation next to the button, "Saved · View post" with a working link to the live post (/blog/<slug>) when the post
 * is published (a draft has no public URL: it says so instead of linking to a 404), scrolled into view after a save; a failed save shows its error the same way and, with #836's
 * keep-input, keeps the typed text (body included). Saving still revalidates the post, /blog and the sitemap, and is audited (blog.update). Browser proof: QA's admin blog specs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BlogSaveNotice } from "@/components/admin/blog-save-notice";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");
const html = (props: Parameters<typeof BlogSaveNotice>[0]) => renderToStaticMarkup(<BlogSaveNotice {...props} />);

describe("BlogSaveNotice", () => {
  it("a saved PUBLISHED post: 'Saved' and a link to the live post at the slug that was just saved", () => {
    const out = html({ state: { status: "success", message: "Saved.", savedSlug: "renamed-slug" }, slug: "old-slug", published: true });
    expect(out).toContain("Saved");
    expect(out).toMatch(/<a [^>]*href="\/blog\/renamed-slug"[^>]*>View post/);
    expect(out).not.toContain("old-slug");
  });
  it("without a returned slug the link uses the post's current slug", () => {
    expect(html({ state: { status: "success", message: "Saved." }, slug: "my-post", published: true })).toContain('href="/blog/my-post"');
  });
  it("a saved DRAFT says it is not public yet and does NOT link to a page that would 404", () => {
    const out = html({ state: { status: "success", message: "Saved." }, slug: "my-post", published: false });
    expect(out).toContain("Saved");
    expect(out).toMatch(/not public/i);
    expect(out).not.toContain("<a ");
  });
  it("it is a status region, so a screen reader announces it", () => {
    expect(html({ state: { status: "success", message: "Saved." }, slug: "s", published: true })).toMatch(/role="status"/);
  });
  it("a failed save shows the server's message as an alert, with no 'Saved'", () => {
    const out = html({ state: { status: "error", message: "A post with that slug already exists." }, slug: "s", published: true });
    expect(out).toContain("A post with that slug already exists.");
    expect(out).toMatch(/role="alert"/);
    expect(out).not.toContain("Saved");
    expect(out).not.toContain("View post");
  });
  it("nothing before the first save", () => {
    expect(html({ state: { status: "idle" }, slug: "s", published: true })).toBe("");
  });
});

describe("the form and the action", () => {
  const form = read("src/components/admin/blog-post-form.tsx");
  const actions = read("src/lib/admin/blog/actions.ts");
  const page = read("src/app/admin/(protected)/blog/[id]/page.tsx");
  it("the notice sits next to the submit button, not at the top of the form, and is scrolled into view after a save", () => {
    expect(form).toContain("<BlogSaveNotice");
    expect(form.indexOf("<BlogSaveNotice")).toBeGreaterThan(form.indexOf("<TextArea"));
    expect(form).toContain("scrollIntoView");
  });
  it("the edit page tells the form whether the post is published", () => {
    expect(page).toContain("published={published}");
  });
  it("the update action returns the slug it saved", () => {
    const update = actions.slice(actions.indexOf("export async function updatePostAction"), actions.indexOf("export async function setPublishedAction") > 0 ? actions.indexOf("export async function setPublishedAction") : undefined);
    expect(update).toContain("savedSlug: parsed.data.slug");
  });
  it("the validation message no longer points 'below' (the notice now sits under the button)", () => {
    expect(actions).not.toContain("Check the fields below.");
    expect(actions).toContain("Check the highlighted fields.");
  });
  it("regression: saving still revalidates the post, /blog and the sitemap and is audited as blog.update", () => {
    const update = actions.slice(actions.indexOf("export async function updatePostAction"), actions.indexOf("export async function setPublishedAction") > 0 ? actions.indexOf("export async function setPublishedAction") : undefined);
    expect(update).toContain("revalidateBlog(parsed.data.slug)");
    expect(update).toContain('action: "blog.update"');
    expect(actions).toContain('revalidatePath("/blog")');
    expect(actions).toContain('revalidatePath("/sitemap.xml")');
  });
});
