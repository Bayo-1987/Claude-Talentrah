import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { getAllPosts, getPostBySlug } from "@/lib/blog/posts";
import { mdxComponents } from "@/components/marketing/mdx-components";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  return {
    title: `${post.title} — Talentrah Blog`,
    description: post.description,
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <>
      <MarketingMasthead />
      <div className="py-20">
        <Container className="flex max-w-[760px] flex-col gap-10">
          <div className="flex flex-col gap-4 border-b border-line pb-10">
            <EyebrowLabel>Blog</EyebrowLabel>
            <h1 className="text-[34px] leading-[1.25]">{post.title}</h1>
            <p className="text-[13.5px] text-ink-soft">
              {formatDate(post.date)} · {post.author}
            </p>
          </div>
          <div className="flex flex-col gap-6">
            <MDXRemote source={post.content} components={mdxComponents} />
          </div>
        </Container>
      </div>
      <MarketingFooter />
    </>
  );
}
