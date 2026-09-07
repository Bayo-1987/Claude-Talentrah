import type { StructuredResume } from "@/lib/resume/types";

/**
 * THE MULTI-PERSONA REWORK. Before this, every one of
 * the 65 catalog templates previewed against — and every "Start from an
 * example" seeded — the same single PM resume below. That produced a real
 * mismatch: a template whose section labels reference something
 * category-specific (an engineering "Safety & HSE Certifications" section,
 * an NGO "Volunteer & Community Work" section) rendered a PM's CSPO
 * certificate and payments-dashboard bullets underneath it — content that
 * reads as wrong, not generic, to anyone in that field. `blueprint`'s old
 * "Professional Certifications (COREN)" label was the first instance of this
 * found and fixed as a one-off (see catalog-configs.ts and
 * tests/resume-builder/catalog-configs-labels.test.ts); this is the general
 * fix, not another one-off.
 *
 * `EXAMPLE_PERSONAS` below is now the source of truth — `PREVIEW_SAMPLE_RESUME`
 * stays exported, UNCHANGED, as one entry in that array (see its own doc
 * comment for why it was kept rather than retired). Every consumer that used
 * to compare against "the one example" now compares against "any persona in
 * the registry": example-guard.ts's flagging logic, and the two seeding call
 * sites (createResumeAction's "example" start state, template-thumbnail.tsx's
 * gallery preview) resolve WHICH persona via
 * `src/lib/resume-builder/persona-for-category.ts`, keyed off the template's
 * `industry_category`. A category with no dedicated persona yet falls back to
 * `PREVIEW_SAMPLE_RESUME` — see that file's own header for the full mapping
 * and the fallback rule.
 *
 * ONLY 2 OF 21 CATEGORY GROUPS GOT A DEDICATED PERSONA IN THIS PASS
 * (Engineering + Construction & Real Estate + Oil & Gas/Energy, and NGO &
 * Development + Agriculture & Agribusiness) — deliberately scoped, not a
 * partial implementation left unfinished. The remaining ~12-13 personas are
 * out of scope for this change; every category without one renders the PM
 * persona, which is a pre-existing, already-shipped state (this is exactly
 * what every category rendered before this change), not a regression.
 *
 * The original header below, describing `PREVIEW_SAMPLE_RESUME` itself,
 * still applies verbatim to that one constant.
 */

/**
 * The resume every template thumbnail is drawn from — AND, since Stage 3.1,
 * what "Start from an example" seeds into a brand-new builder resume
 * (createResumeAction, src/lib/resume-builder/actions.ts).
 *
 * That second job raised the bar on this content. As a thumbnail source it
 * only had to look plausible at 26% scale; as something a real user edits
 * line-by-line, it has to read as genuinely good Nigerian CV writing —
 * quantified impact, not vague duties — because a user copying this
 * *style* is exactly the point of "start from an example" (see the founder's
 * framing: Canva/Enhancv open a filled document to edit, not a blank one).
 * It is also, since the same stage added an export guard
 * (src/lib/resume-builder/example-guard.ts), the exact reference content that
 * guard compares against field-by-field — every value below has to be
 * distinctive enough that a real user's real data won't collide with it by
 * coincidence.
 *
 * A LOCAL LITERAL, deliberately. The gallery needs a resume before the visitor
 * has one — a new user's first sight of the templates is the moment they have
 * nothing saved — so this cannot read from `resumes`, and it must not depend
 * on seed data either: a public-ish gallery that changes when someone edits
 * the demo account, or renders blank in an unseeded environment, is worse than
 * a static picture. The name, employers ("Kolopay", "Riverbend Digital") and
 * email domain are fictional — not real companies or services.
 *
 * SEPARATE FROM C1's SAMPLE_RESUME (src/lib/demo/sample-resume.ts), on
 * purpose, and still on purpose now that both have landed: that one is echoed
 * to anonymous pre-signup callers and tuned to produce a realistic match
 * against a real posting for gap analysis, with empty projects/certifications
 * and no email by design — see that file's own header. This one is fed to a
 * LAYOUT and, now, to an editor a signed-in user fills in — what matters here
 * is that every section is populated and worth reading, not that it matches
 * any particular job posting.
 *
 * EVERY SECTION IS FILLED for the layout reason above: projects and
 * certifications are empty in C1's version and populated here, because two
 * templates in the registry lay those out differently and a thumbnail that
 * omits them would misrepresent the template it is advertising.
 */
export const PREVIEW_SAMPLE_RESUME: StructuredResume = {
  contact: {
    name: "Adaeze Nwachukwu",
    email: "adaeze.nwachukwu@vaultmail.com",
    phone: "+234 803 214 6678",
    location: "Lagos, Nigeria",
  },
  summary:
    "Senior product manager with seven years building payments and fintech products in Lagos, focused on merchant activation, fraud-safe onboarding and measurable revenue impact.",
  experience: [
    {
      title: "Senior Product Manager",
      company: "Kolopay",
      location: "Lagos, Nigeria",
      startDate: "2023",
      endDate: "Present",
      description:
        "Own the merchant payments dashboard used by 40,000+ SMB merchants. Redesigned the KYC intake flow with Compliance and Engineering, cutting median onboarding time from 9 days to 5.4 (a 40% reduction) while holding fraud flags flat.",
    },
    {
      title: "Product Manager",
      company: "Kolopay",
      location: "Lagos, Nigeria",
      startDate: "2021",
      endDate: "2023",
      description:
        "Shipped an in-app dispute-resolution flow that cut average chargeback resolution time by 35% and reduced payment-dispute support tickets by half.",
    },
    {
      title: "Associate Product Manager",
      company: "Riverbend Digital",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2021",
      description:
        "Ran 20+ onboarding and activation experiments for SMB merchants on a B2B payments app, lifting 30-day merchant activation from 48% to 61%.",
    },
  ],
  education: [
    { school: "University of Lagos", degree: "B.Sc.", field: "Computer Science", startDate: "2015", endDate: "2019" },
  ],
  skills: [
    "product management",
    "sql",
    "data analysis",
    "user research",
    "roadmapping",
    "agile/scrum",
    "a/b testing",
    "figma",
    "stakeholder management",
    "payments & fintech compliance",
  ],
  projects: [
    "Merchant self-onboarding redesign — cut onboarding time 40%",
    "Chargeback triage automation — 35% faster resolution, adopted company-wide",
    "Premium merchant tier pricing experiment — lifted attach rate 18%",
  ],
  certifications: ["Certified Scrum Product Owner (CSPO)", "Product Management Certificate — Product School"],
};

/**
 * Engineering + Construction & Real Estate + Oil & Gas/Energy persona — a
 * site engineer moving between EPC (engineering-procurement-construction)
 * contractors on civil works, pipeline construction and plant
 * commissioning, the largest of the two groupings covered in this pass (10
 * catalog templates: blueprint, site-report, specification, schematic,
 * site-plan, foundation, property-portfolio, rig-report, offshore,
 * wellhead). A real, common Nigerian career path — the same EPC contractor
 * bids civil, real-estate and energy-infrastructure work, so an engineer's
 * CV genuinely spans all three categories rather than needing three
 * separate personas.
 *
 * Certifications are deliberately real, internationally-recognized SAFETY
 * credentials (NEBOSH, OSHA) rather than a country-specific chartering body
 * (COREN) — see this file's top-of-file header and
 * tests/resume-builder/catalog-configs-labels.test.ts for exactly why a
 * chartering-body name is the wrong kind of claim for demo content to make.
 * A safety certificate is a real, common, and genuinely portable credential
 * for this career, and every "certifications" sectionLabel this persona
 * feeds ("Safety & HSE Certifications", "Safety & Trade Certifications",
 * "Safety Certifications", "Professional Certifications") is accurate for it.
 */
export const EPC_SITE_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "Tunde Balogun",
    email: "tunde.balogun@fieldmail.com",
    phone: "+234 812 355 7204",
    location: "Port Harcourt, Nigeria",
  },
  summary:
    "Site engineer with eight years delivering construction and energy-infrastructure projects for EPC contractors across Nigeria, moving between civil works, pipeline construction and plant commissioning with a clean safety record.",
  experience: [
    {
      title: "Senior Site Engineer",
      company: "Nordbridge Engineering Ltd",
      location: "Port Harcourt, Nigeria",
      startDate: "2023",
      endDate: "Present",
      description:
        "Lead civil and structural works on a $40M gas-processing plant expansion, coordinating 60+ field personnel across three subcontractors. Introduced a daily QA/QC checklist that cut structural rework incidents by 45%, and delivered the foundation and steelwork phase two weeks ahead of schedule.",
    },
    {
      title: "Site Engineer",
      company: "Nordbridge Engineering Ltd",
      location: "Warri, Nigeria",
      startDate: "2020",
      endDate: "2023",
      description:
        "Supervised a 12km access-road and drainage construction package for a client refinery, tracking BOQ variance against 14 subcontractor line items. Tightened concrete-pour scheduling to cut material wastage 22%, and closed out the package across 180,000 work-hours with zero lost-time injuries.",
    },
    {
      title: "Graduate Site Engineer",
      company: "Terrafirma Construction Ltd",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2020",
      description:
        "Supported structural setting-out and quality inspection on an 18-month mixed-use development, maintaining as-built drawings and RFI logs. Helped the site pass four consecutive quarterly HSE audits with zero non-conformances.",
    },
  ],
  education: [
    { school: "University of Nigeria, Nsukka", degree: "B.Eng.", field: "Civil Engineering", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "site supervision",
    "structural quality control",
    "hse compliance",
    "autocad",
    "primavera p6",
    "boq & cost tracking",
    "subcontractor coordination",
    "pipeline construction",
    "concrete works",
    "progress reporting",
  ],
  projects: [
    "Gas-processing plant foundation & steelwork — delivered two weeks ahead of schedule",
    "12km access road & drainage package — zero lost-time injuries across 180,000 work-hours",
    "Mixed-use development QA programme — zero HSE non-conformances across four audits",
  ],
  certifications: [
    "NEBOSH International General Certificate in Occupational Health and Safety",
    "OSHA 30-Hour Construction Safety Certificate",
  ],
};

/**
 * NGO & Development + Agriculture & Agribusiness persona — a donor-funded
 * development programme officer whose portfolio is agriculture/food
 * security, the second grouping covered in this pass (6 catalog templates:
 * field-mission, impact-report, grant-proposal, harvest, field-season,
 * value-chain). Chosen over Administration + Customer Success (the other
 * eligible 6-template grouping) specifically because it proves the
 * mechanism against a meaningfully DIFFERENT register from both the kept PM
 * persona and the new EPC engineer above — mission/impact framing, a
 * `volunteering` section neither other persona populates, and donor-language
 * fluency (`languages`) — rather than another corporate-professional voice,
 * which would exercise the same rendering paths the other two personas
 * already do.
 *
 * Certifications are real, sector-standard credentials (PMD Pro is the
 * PM4NGOs/APMG "Project Management for Development Professionals"
 * qualification; a MEAL certificate is the standard monitoring/evaluation
 * credential in this sector) — not a claim to any regulatory body.
 */
export const DEVELOPMENT_PROGRAMME_OFFICER_RESUME: StructuredResume = {
  contact: {
    name: "Ngozi Umeh",
    email: "ngozi.umeh@harvestlink.org",
    phone: "+234 706 442 1189",
    location: "Kano, Nigeria",
  },
  summary:
    "Development programme officer with six years managing donor-funded food-security and livelihoods programmes across northern Nigeria, from proposal design through monitoring and evaluation for a reach of 50,000+ smallholder farmers.",
  experience: [
    {
      title: "Programme Officer",
      company: "Sahel Resilience Initiative",
      location: "Kano, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Manage a $2.1M USAID-funded food-security programme across four northern states, supervising a team of 12 field officers. Redesigned the farmer-training curriculum with the M&E unit, lifting input-adoption rates among 18,000 smallholder farmers from 41% to 68% over two planting seasons.",
    },
    {
      title: "Field Coordinator",
      company: "Sahel Resilience Initiative",
      location: "Kano, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description:
        "Coordinated last-mile distribution of certified seed and fertiliser to 12,000 smallholder households across 60 communities, and built the beneficiary-verification process that cut duplicate-registration errors by 90%.",
    },
    {
      title: "Monitoring & Evaluation Assistant",
      company: "Greenbelt Development Trust",
      location: "Kaduna, Nigeria",
      startDate: "2018",
      endDate: "2020",
      description:
        "Ran quarterly household surveys and data-quality audits for a livelihoods programme reaching 8,000 beneficiaries, and produced the donor reporting dashboards used in every quarterly review.",
    },
  ],
  education: [
    { school: "Bayero University Kano", degree: "B.Sc.", field: "Agricultural Economics", startDate: "2014", endDate: "2018" },
  ],
  skills: [
    "programme management",
    "monitoring & evaluation",
    "donor reporting",
    "grant writing",
    "food security programming",
    "stakeholder engagement",
    "beneficiary data management",
    "budget tracking",
    "community mobilization",
    "kobo toolbox / odk",
  ],
  projects: [
    "Smallholder input-adoption programme — lifted adoption from 41% to 68% across 18,000 farmers",
    "Beneficiary verification system — cut duplicate registrations 90% across 60 communities",
    "Quarterly donor reporting dashboard — adopted programme-wide for USAID reviews",
  ],
  certifications: [
    "PMD Pro Level 1 (Project Management for Development Professionals, PM4NGOs)",
    "Certificate in Monitoring, Evaluation, Accountability and Learning (MEAL)",
  ],
  volunteering: [
    {
      role: "Community Health Volunteer",
      organisation: "Kano State Primary Healthcare Board",
      startDate: "2016",
      endDate: "2018",
      description: "Supported nutrition-screening outreach in rural wards alongside primary healthcare workers.",
    },
  ],
  languages: [
    { name: "English", level: "Fluent" },
    { name: "Hausa", level: "Native" },
    { name: "Igbo", level: "Conversational" },
  ],
};

/**
 * The registry every consumer now matches against — see this file's
 * top-of-file header. Order is not meaningful for matching (every
 * comparison in example-guard.ts is `.some(...)` across the whole array),
 * but PREVIEW_SAMPLE_RESUME stays first because it is also the FALLBACK
 * persona-for-category.ts returns for every category without a dedicated
 * entry — the pre-existing, already-shipped behavior for those categories.
 */
export const EXAMPLE_PERSONAS: readonly StructuredResume[] = [
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
];
