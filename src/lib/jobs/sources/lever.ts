import "server-only";
import { computeDedupFingerprint } from "../dedup";
import { extractStructuredJd, inferSeniority, stripHtml } from "../extract-jd";
import type { EmploymentType, NormalizedJobPosting, WorkType } from "../types";

interface LeverPosting {
  id: string;
  text: string;
  categories?: { location?: string; commitment?: string };
  workplaceType?: string;
  hostedUrl: string;
  createdAt: number;
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
}

function mapEmploymentType(commitment: string | undefined): EmploymentType | undefined {
  if (!commitment) return undefined;
  const text = commitment.toLowerCase();
  if (text.includes("intern")) return "internship";
  if (text.includes("part")) return "part_time";
  if (text.includes("contract")) return "contract";
  if (text.includes("full")) return "full_time";
  return undefined;
}

function mapWorkType(workplaceType: string | undefined): WorkType | undefined {
  if (workplaceType === "remote" || workplaceType === "hybrid" || workplaceType === "onsite") {
    return workplaceType;
  }
  return undefined;
}

/** api.lever.co/v0/postings/{token} is Lever's public, unauthenticated per-company board API. */
export async function fetchLeverJobs(
  token: string,
  companyName: string,
): Promise<NormalizedJobPosting[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Lever board "${token}" returned ${res.status}`);
  }

  const postings = (await res.json()) as LeverPosting[];

  return postings.map((posting) => {
    const listsText = (posting.lists ?? [])
      .map((l) => `${l.text}\n${stripHtml(l.content)}`)
      .join("\n\n");
    const description = [posting.descriptionPlain, listsText].filter(Boolean).join("\n\n");
    const location = posting.categories?.location;

    return {
      title: posting.text,
      companyName,
      location,
      workType: mapWorkType(posting.workplaceType),
      employmentType: mapEmploymentType(posting.categories?.commitment),
      seniority: inferSeniority(posting.text),
      description,
      structuredJd: extractStructuredJd(description),
      externalUrl: posting.hostedUrl,
      externalSource: "lever" as const,
      postedAt: new Date(posting.createdAt).toISOString(),
      dedupFingerprint: computeDedupFingerprint(companyName, posting.text, location),
    };
  });
}
