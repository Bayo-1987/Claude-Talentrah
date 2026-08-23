import { EyebrowLabel } from "@/components/ui";

const FAQS = [
  {
    q: "Is Talentrah free to use?",
    a: "Checking your match score and previewing a tailored resume needs no account. Deeper AI actions — full tailoring, applying, interview prep — use credits: you get a free allotment when you create a free account, with more available if you need them.",
  },
  {
    q: "What's the difference between Farah and a human mentor?",
    a: "Day-to-day, Farah handles the matching, tailoring, and coaching. When the stakes are highest — negotiating pay, or prepping for a final round — you're handed off to a real mentor who's done it before.",
  },
  {
    q: "Do I have to pay for a mentor session?",
    a: "Many mentors offer free or volunteer sessions. Paid sessions are priced by the mentor and paid directly — never through credits.",
  },
  {
    q: "Can employers post jobs on Talentrah?",
    a: "Yes — employers can post roles directly, or work with our team on recruitment and staffing through Talentrah's business services.",
  },
];

export function FaqSection() {
  return (
    <div id="faqs" className="border-t border-line py-24">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="mb-12 flex max-w-[560px] flex-col gap-4">
          <EyebrowLabel>Frequently asked</EyebrowLabel>
          <h2 className="text-[32px] leading-[1.25]">Questions, answered plainly.</h2>
        </div>
        <div className="flex max-w-[760px] flex-col border-t border-line">
          {FAQS.map((faq) => (
            <div
              key={faq.q}
              className="flex flex-col gap-3 border-b border-line py-6 min-[901px]:flex-row min-[901px]:gap-8"
            >
              <h3 className="text-[17px] min-[901px]:w-65 min-[901px]:flex-shrink-0">{faq.q}</h3>
              <p className="flex-1 text-[15px] text-ink-soft">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
