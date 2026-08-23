import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const BLOG_DIR = path.join(process.cwd(), "src/content/blog");

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
}

export interface BlogPost extends BlogPostMeta {
  content: string;
}

function readSlugs(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => file.replace(/\.mdx$/, ""));
}

/** All published posts, newest first — for the /blog listing page. */
export function getAllPosts(): BlogPostMeta[] {
  return readSlugs()
    .map((slug) => {
      const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.mdx`), "utf8");
      const { data } = matter(raw);
      return {
        slug,
        title: data.title as string,
        description: data.description as string,
        date: data.date as string,
        author: (data.author as string) ?? "The Talentrah Team",
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** One post's full MDX body + metadata, for /blog/[slug]. */
export function getPostBySlug(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  return {
    slug,
    title: data.title as string,
    description: data.description as string,
    date: data.date as string,
    author: (data.author as string) ?? "The Talentrah Team",
    content,
  };
}
