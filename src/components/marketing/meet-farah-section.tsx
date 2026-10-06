import { EyebrowLabel, FarahMark } from "@/components/ui";

export function MeetFarahSection() {
  return (
    <div id="farah" className="border-y border-line bg-paper-alt py-24">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-8 px-10 text-center min-[901px]:grid-cols-[300px_1fr] min-[901px]:gap-16 min-[901px]:text-left">
        <div className="flex justify-center min-[901px]:justify-start">
          <FarahMark />
        </div>
        <div className="flex flex-col gap-4.5">
          <EyebrowLabel>Your co-pilot</EyebrowLabel>
          <h2 className="text-[34px]">Meet Farah.</h2>
          <p className="max-w-[560px] text-[16px] text-ink-soft">
            Farah is the AI behind every match, tailored resume, and interview-prep session on
            Talentrah — encouraging, direct, and specific, never generic filler. She&apos;ll
            benchmark your salary expectations, help you practice for interviews, and tell you
            exactly what&apos;s missing before you apply.
          </p>
          <p className="max-w-[560px] text-[16px] text-ink-soft">
            When a human is the better call, Farah will tell you plainly and connect you with a
            real mentor.
          </p>
        </div>
      </div>
    </div>
  );
}
