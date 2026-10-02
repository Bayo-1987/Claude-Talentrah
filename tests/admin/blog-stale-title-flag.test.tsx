/**
 * send-509 / S3-21c — /admin/blog flags a post whose title carries a date that has passed.
 *
 * Rendered with the clock fixed and the post list stubbed. The flag names the date and says what to do; a title with no passed date shows
 * nothing. It FLAGS, it does not block publishing: the owner retitles the posts himself in /admin/blog.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ adminId: "a", email: "a@example.test" }) }));
const posts = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/admin/blog/posts", () => ({ listAllPosts: async () => posts.rows }));

import AdminBlogPage from "@/app/admin/(protected)/blog/page";

const post = (slug: string, title: string, status = "published") => ({
  id: slug, slug, title, status, updated_at: "2026-09-17T10:00:00.000Z", published_at: "2026-09-17T10:00:00.000Z",
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T09:00:00.000Z"));
});
afterAll(() => vi.useRealTimers());

describe("admin blog list: stale dates in titles", () => {
  it("flags a title with a passed date, names the date, and says to retitle", async () => {
    posts.rows = [post("chevening-scholarships-2027", "Chevening Scholarships 2027: The Deadline Is 6 October 2026")];
    const t = text(renderToStaticMarkup(await AdminBlogPage()));
    expect(t).toContain("Title has a date that has passed: 6 October 2026");
    expect(t).toMatch(/retitle/i);
  });

  it("shows nothing for a title with no date, or a date still ahead", async () => {
    posts.rows = [
      post("a", "What's a Good ATS Score?"),
      post("b", "Gates Cambridge: Two Deadlines, and Your Course Decides Which One Is Yours"),
      post("c", "Applications close 9 December 2026"),
    ];
    expect(text(renderToStaticMarkup(await AdminBlogPage()))).not.toContain("date that has passed");
  });

  it("flags a draft too (it will go stale before it is read)", async () => {
    posts.rows = [post("d", "Closes 2 October 2026", "draft")];
    expect(text(renderToStaticMarkup(await AdminBlogPage()))).toContain("Title has a date that has passed: 2 October 2026");
  });
});
