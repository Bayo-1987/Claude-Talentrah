import type { StructuredResume } from "@/lib/resume/types";

/**
 * THE MULTI-PERSONA REWORK, continued (batch 2 of the persona rollout).
 * Before the first pass, every one of the 65 catalog templates previewed
 * against — and every "Start from an example" seeded — the same single PM
 * resume below. That produced a real mismatch: a template whose section
 * labels reference something category-specific (an engineering "Safety &
 * HSE Certifications" section, an NGO "Volunteer & Community Work" section)
 * rendered a PM's CSPO certificate and payments-dashboard bullets underneath
 * it — content that reads as wrong, not generic, to anyone in that field.
 * `blueprint`'s old "Professional Certifications (COREN)" label was the
 * first instance of this found and fixed as a one-off (see
 * catalog-configs.ts and tests/resume-builder/catalog-configs-labels.test.ts);
 * the first pass generalized that fix to two whole category groupings
 * sharing one persona apiece.
 *
 * THIS PASS DROPS THE CATEGORY-SHARING SHORTCUT for one of those two
 * groupings: every template now gets its OWN persona, resolved by literal
 * template `slug` rather than by `industry_category` — see
 * `src/lib/resume-builder/persona-for-slug.ts` (renamed from
 * `persona-for-category.ts`, which no longer exists) for the
 * `SLUG_PERSONA_MAP` this drives. The Engineering + Construction & Real
 * Estate + Oil & Gas/Energy grouping's 10 slugs now resolve to 10 distinct
 * personas (`blueprint` keeps `EPC_SITE_ENGINEER_RESUME`; the other 9 are
 * new, defined below). The NGO & Development + Agriculture & Agribusiness
 * grouping's 6 slugs are UNCHANGED in outcome — all 6 still resolve to
 * `DEVELOPMENT_PROGRAMME_OFFICER_RESUME` — only the mechanism changed, from
 * one category-keyed map entry to 6 explicit slug-keyed ones, so that
 * grouping keeps a single shared persona for now, on purpose, pending a
 * later batch. Every other slug still falls back to `PREVIEW_SAMPLE_RESUME`,
 * unchanged.
 *
 * `EXAMPLE_PERSONAS` below is now the source of truth — `PREVIEW_SAMPLE_RESUME`
 * stays exported, UNCHANGED, as one entry in that array (see its own doc
 * comment for why it was kept rather than retired). Every consumer that used
 * to compare against "the one example" now compares against "any persona in
 * the registry": example-guard.ts's flagging logic, and the two seeding call
 * sites (createResumeAction's "example" start state, template-thumbnail.tsx's
 * gallery preview) resolve WHICH persona via
 * `src/lib/resume-builder/persona-for-slug.ts`, keyed off the template's own
 * `slug`. A slug with no dedicated entry falls back to `PREVIEW_SAMPLE_RESUME`
 * — see that file's own header for the full mapping and the fallback rule.
 *
 * The original header below, describing `PREVIEW_SAMPLE_RESUME` itself,
 * still applies verbatim to that one constant.
 *
 * BATCH 2 (this pass) does two things. First, it finishes the NGO &
 * Development / Agriculture & Agribusiness grouping batch 1 deliberately
 * left shared: of that grouping's 6 slugs, `field-mission` keeps
 * `DEVELOPMENT_PROGRAMME_OFFICER_RESUME` (Ngozi Umeh) unchanged — its
 * `structure_schema` already has a `volunteering` section matching content
 * she already has, and "Programme Experience" matches her summary/title
 * closely — while the other 5 (`impact-report`, `grant-proposal`,
 * `harvest`, `field-season`, `value-chain`) each get their own new,
 * register-distinct persona below, matched to that slug's own
 * `structure_schema` in catalog-configs.ts the same way batch 1 matched EPC
 * content to layout. Second, it rounds the batch out with 5 more personas
 * on standalone-category slugs still entirely on the `PREVIEW_SAMPLE_RESUME`
 * fallback — one slug each from Technology, Banking & Finance, Healthcare,
 * Legal and Business, chosen from 5 DIFFERENT categories for the same
 * reason batch 1 picked a whole grouping (Engineering + Construction + Oil
 * & Gas) rather than one slug each from unrelated categories: proving the
 * mechanism against as many distinct professional registers as possible in
 * one pass.
 *
 * `SLUG_PERSONA_MAP` in `persona-for-slug.ts` picks up every new persona
 * below by literal slug, same mechanism as batch 1.
 *
 * BATCH 3A (this pass, first of three sequential batches closing the
 * remaining 44 fallback slugs). Covers 14 slugs across 5 categories, chosen
 * because 5 of them (`structured-admin`, `clean-professional`,
 * `curriculum-vitae`, `funnel`, `terminal`) sit in the app's 9-slug free
 * tier — the highest-traffic templates in the catalog — and this batch
 * takes the rest of each of THEIR categories along too, so no category ends
 * up split across batches: Administration (`structured-admin`,
 * `front-office`, `filing-system` — all 3, category now complete), Business
 * (`clean-professional`, `business-boardroom` — joining `business-memo`
 * from batch 2, category now complete), Technology (`terminal`,
 * `stack-trace` — joining `product-tech` from batch 2, category now
 * complete), Sales & Marketing (`funnel`, `pipeline`, `pitch-deck` — all 3,
 * new category, now complete) and Education & Academia (`curriculum-vitae`,
 * `lecture-notes`, `faculty-profile`, `research-record` — all 4, new
 * category, now complete). After this batch, EVERY slug in the free tier
 * has a dedicated persona — `clean-professional` and `terminal` were the
 * last two free slugs still on the fallback, and both tests that used to
 * prove "a free slug can still fall back to PREVIEW_SAMPLE_RESUME" using
 * exactly those two slugs (`create-resume-action.test.ts`) had to move to
 * two different, still-unmapped premium slugs instead.
 *
 * `clean-professional` is a special case worth calling out: it is not just
 * "the Business category's free slug", it is `getTemplateComponent`'s own
 * fallback component AND (per `persona-for-slug.ts`) was, until this batch,
 * indistinguishable in outcome from an unmapped slug — both roads led to
 * `PREVIEW_SAMPLE_RESUME`. Giving it its own persona (`BUSINESS_GENERALIST_
 * RESUME`, below) meant that persona had to earn the word "generalist" for
 * real: a career that reads as broad competence across functions (ops,
 * admin, project coordination) rather than one narrow specialism, since
 * this is the template a user lands on when nothing more specific matched.
 *
 * Every new persona below was matched to its slug's own `structure_schema`
 * in `catalog-configs.ts` the same way earlier batches did — `pipeline` is
 * the one exception with no skeleton config at all (`structure_schema: {}`
 * in `catalog.ts`, one of the pre-PR2 bespoke-component slugs), so that
 * persona was matched against `PipelineTemplate` (`templates/pipeline.tsx`)
 * directly instead: its skills line and "Track Record"/"Campaigns &
 * Accounts" labels are hardcoded in the component, not config-driven.
 *
 * Real, portable, non-statutory credentials only, same rule as every batch
 * before this one (see `tests/resume-builder/catalog-configs-labels.test.ts`
 * for the reasoning) — none of these 14 personas' certifications name a
 * licensing/chartering/regulatory body (Nigerian or otherwise); every one is
 * a vendor certification, an international voluntary professional body, or
 * a training-programme certificate.
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
 * `blueprint` ONLY, as of this pass. Originally covered all 10 templates in
 * the Engineering + Construction & Real Estate + Oil & Gas/Energy grouping
 * (see git history / the first persona PR, #275); this pass split that
 * grouping into 10 distinct personas, one per slug, and `blueprint` is the
 * one slug that keeps this persona unchanged (see
 * `src/lib/resume-builder/persona-for-slug.ts`'s `SLUG_PERSONA_MAP`, and the
 * 9 new persona constants below for the rest of the grouping).
 *
 * A site engineer moving between EPC (engineering-procurement-construction)
 * contractors on civil works, pipeline construction and plant
 * commissioning — a real, common Nigerian career path.
 *
 * Certifications are deliberately real, internationally-recognized SAFETY
 * credentials (NEBOSH, OSHA) rather than a country-specific chartering body
 * (COREN) — see this file's top-of-file header and
 * tests/resume-builder/catalog-configs-labels.test.ts for exactly why a
 * chartering-body name is the wrong kind of claim for demo content to make.
 * A safety certificate is a real, common, and genuinely portable credential
 * for this career, and the "Professional Certifications" sectionLabel this
 * persona feeds on `blueprint` is accurate for it. The other 9 personas
 * below follow the same rule for their own sectionLabels.
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
 * `site-report` persona — a construction site foreman on residential and
 * commercial builds. Deliberately a BUILDINGS register (crews, snag lists,
 * handover), not `blueprint`'s EPC/industrial-plant register, even though
 * both sit in "Engineering" — a foreman and a plant site engineer are
 * genuinely different jobs.
 */
export const CONSTRUCTION_FOREMAN_RESUME: StructuredResume = {
  contact: {
    name: "Emeka Chukwu",
    email: "emeka.chukwu@buildcraftng.com",
    phone: "+234 802 771 3345",
    location: "Abuja, Nigeria",
  },
  summary:
    "Construction site foreman with nine years supervising residential and commercial builds across Abuja and Lagos, delivering projects on schedule while holding strict safety and quality standards on site.",
  experience: [
    {
      title: "Senior Site Foreman",
      company: "Buildcraft Nigeria Ltd",
      location: "Abuja, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Supervise daily site operations for a 120-unit residential estate, coordinating 8 subcontractor crews and 90+ labourers. Cut weekly material-wastage reports by 30% after introducing a daily site-briefing and stock-reconciliation routine, and kept the project on schedule across 14 months of works.",
    },
    {
      title: "Site Foreman",
      company: "Buildcraft Nigeria Ltd",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Managed formwork, masonry and finishing crews on a 6-storey commercial office block, running a 25-person workforce across two shifts. Reduced snag-list items at handover by 50% by introducing a weekly self-inspection checklist ahead of client walkthroughs.",
    },
    {
      title: "Assistant Site Supervisor",
      company: "Horizon Builders Ltd",
      location: "Abuja, Nigeria",
      startDate: "2016",
      endDate: "2019",
      description:
        "Assisted in setting out and inspecting block work and roofing on a 40-unit housing scheme, tracking daily labour attendance and material deliveries. Helped the site record zero reportable safety incidents across 30 months of construction.",
    },
  ],
  education: [
    { school: "Yaba College of Technology", degree: "HND", field: "Building Technology", startDate: "2013", endDate: "2016" },
  ],
  skills: [
    "site supervision",
    "construction scheduling",
    "quality control",
    "subcontractor management",
    "materials management",
    "health & safety compliance",
    "blueprint reading",
    "labour force coordination",
    "snag-list management",
    "cost tracking",
  ],
  projects: [
    "120-unit residential estate — cut material wastage 30% via daily stock reconciliation",
    "6-storey commercial office block finish-out — reduced handover snags by 50%",
  ],
  certifications: [
    "NEBOSH National General Certificate in Occupational Health and Safety",
    "OSHA 30-Hour Construction Safety Certificate",
  ],
};

/**
 * `specification` persona — a structural design engineer who authors
 * technical specifications from a design office, not a field role. Distinct
 * register from every other Engineering-group persona: drafting/review work,
 * not site supervision.
 */
export const STRUCTURAL_DESIGN_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "Chinedu Okafor",
    email: "chinedu.okafor@designforge.ng",
    phone: "+234 815 662 9012",
    location: "Lagos, Nigeria",
  },
  summary:
    "Structural design engineer with seven years producing technical specifications and design documentation for commercial and industrial building projects across Lagos, translating architectural intent into buildable, standards-compliant detail.",
  experience: [
    {
      title: "Senior Structural Design Engineer",
      company: "Designforge Engineering Consultants",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Author structural specifications and design calculations for a portfolio of commercial developments valued at over ₦8B, reviewing 3D structural models against loading codes. Standardised the firm's specification templates, cutting document review cycles by 35%.",
    },
    {
      title: "Structural Design Engineer",
      company: "Designforge Engineering Consultants",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Produced detailed structural specifications and rebar schedules for a 12-storey mixed-use tower, coordinating with architectural and MEP teams to resolve 200+ design clashes before construction start.",
    },
    {
      title: "Graduate Design Engineer",
      company: "Bluewater Structures Ltd",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Supported senior engineers in drafting structural specifications and material schedules for warehouse and light-industrial projects, maintaining the design-change log across a 9-month build programme.",
    },
  ],
  education: [
    { school: "University of Benin", degree: "B.Eng.", field: "Civil Engineering", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "structural design",
    "technical specification writing",
    "autocad",
    "revit",
    "staad pro",
    "building codes & standards",
    "rebar detailing",
    "material take-off",
    "design coordination",
    "quality documentation",
  ],
  projects: [
    "12-storey mixed-use tower structural specifications — resolved 200+ design clashes pre-construction",
    "Firm-wide specification template standardisation — cut review cycles 35%",
  ],
  certifications: ["Certified SolidWorks Professional (CSWP)", "ISO 9001:2015 Lead Auditor Certificate"],
};

/**
 * `schematic` persona — an electrical/instrumentation design engineer.
 * `schematic`'s layout is projects-first, so this persona's `projects` list
 * carries extra weight and is written to stand on its own.
 */
export const ELECTRICAL_DESIGN_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "Amara Eze",
    email: "amara.eze@circuitworks.ng",
    phone: "+234 703 118 4456",
    location: "Lagos, Nigeria",
  },
  summary:
    "Electrical and instrumentation design engineer with six years producing schematics and control-system documentation for industrial and energy projects across Lagos and Port Harcourt.",
  experience: [
    {
      title: "Senior E&I Design Engineer",
      company: "Circuitworks Engineering Ltd",
      location: "Lagos, Nigeria",
      startDate: "2023",
      endDate: "Present",
      description:
        "Lead schematic design for electrical distribution and instrumentation control loops on a 15MW captive power project, producing single-line diagrams and loop drawings reviewed by three client engineering teams. Cut schematic revision turnaround from 10 days to 6.",
    },
    {
      title: "E&I Design Engineer",
      company: "Circuitworks Engineering Ltd",
      location: "Port Harcourt, Nigeria",
      startDate: "2020",
      endDate: "2023",
      description:
        "Developed P&ID-aligned instrumentation schematics for a gas-metering skid retrofit, coordinating with process engineers to close out 40+ design queries. Delivered the schematic package two weeks ahead of the client's fabrication deadline.",
    },
    {
      title: "Junior Design Engineer",
      company: "Voltage Systems Nigeria",
      location: "Lagos, Nigeria",
      startDate: "2018",
      endDate: "2020",
      description:
        "Drafted electrical schematics and cable-routing diagrams for low-voltage distribution panels on commercial building fit-outs, supporting four concurrent site projects.",
    },
  ],
  education: [
    { school: "Obafemi Awolowo University", degree: "B.Eng.", field: "Electrical/Electronics Engineering", startDate: "2014", endDate: "2018" },
  ],
  skills: [
    "electrical schematic design",
    "instrumentation & controls",
    "autocad electrical",
    "single-line diagrams",
    "p&id interpretation",
    "plc fundamentals",
    "cable sizing & routing",
    "loop drawing development",
    "design quality review",
  ],
  projects: [
    "15MW captive power project schematics — cut revision turnaround from 10 to 6 days",
    "Gas-metering skid retrofit instrumentation package — delivered two weeks early",
  ],
  certifications: [
    "Autodesk Certified Professional — AutoCAD Electrical",
    "TÜV-Certified Functional Safety Engineer (IEC 61511)",
  ],
};

/**
 * `site-plan` persona — a land surveyor / construction project engineer who
 * produces site plans, distinct from `site-report`'s builder-foreman
 * register and `foundation`'s geotechnical register.
 */
export const LAND_SURVEYOR_RESUME: StructuredResume = {
  contact: {
    name: "Yakubu Danladi",
    email: "yakubu.danladi@terraline.ng",
    phone: "+234 806 240 7781",
    location: "Abuja, Nigeria",
  },
  summary:
    "Land surveyor and construction project engineer with eight years producing site plans and managing project engineering for infrastructure and land-development works across northern Nigeria.",
  experience: [
    {
      title: "Senior Project Engineer & Surveyor",
      company: "Terraline Surveys & Projects",
      location: "Abuja, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Lead topographic surveys and site-plan production for a 200-hectare mixed-use land development, managing a 6-person survey crew and coordinating setting-out with three construction contractors. Cut survey-to-approval turnaround from 6 weeks to 3.",
    },
    {
      title: "Land Surveyor",
      company: "Terraline Surveys & Projects",
      location: "Kaduna, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Conducted cadastral and engineering surveys for a 40km rural-access-road upgrade, producing site plans used for right-of-way acquisition across 12 communities. Resolved boundary disputes on 90% of contested parcels without litigation.",
    },
    {
      title: "Assistant Surveyor",
      company: "Northgate Engineering Services",
      location: "Abuja, Nigeria",
      startDate: "2016",
      endDate: "2019",
      description:
        "Assisted with GPS and total-station surveys for residential layout plans, maintaining survey control points and as-built drawings across five subdivisions.",
    },
  ],
  education: [
    { school: "Ahmadu Bello University", degree: "B.Sc.", field: "Surveying and Geoinformatics", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "land surveying",
    "gnss/gps surveying",
    "site-plan production",
    "total station operation",
    "autocad civil 3d",
    "right-of-way management",
    "boundary resolution",
    "project engineering",
    "stakeholder liaison",
  ],
  projects: [
    "200-hectare mixed-use land development site plan — cut approval turnaround from 6 weeks to 3",
    "40km rural access-road survey — resolved 90% of boundary disputes without litigation",
  ],
  certifications: ["Trimble Certified GNSS Survey Technician", "OSHA 30-Hour Construction Safety Certificate"],
};

/**
 * `foundation` persona — a geotechnical engineer (soils/foundations).
 */
export const GEOTECHNICAL_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "Halima Bello",
    email: "halima.bello@groundworksng.com",
    phone: "+234 812 903 5567",
    location: "Kaduna, Nigeria",
  },
  summary:
    "Geotechnical engineer with seven years investigating soil and foundation conditions for commercial and industrial developments across northern and central Nigeria.",
  experience: [
    {
      title: "Senior Geotechnical Engineer",
      company: "Groundworks Geotechnical Services",
      location: "Kaduna, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Lead geotechnical investigations and foundation-design recommendations for a portfolio of commercial developments, supervising borehole and CPT campaigns across 15 sites. Identified a soft-soil risk that saved a client an estimated ₦120M in redesign costs.",
    },
    {
      title: "Geotechnical Engineer",
      company: "Groundworks Geotechnical Services",
      location: "Abuja, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Ran soil-bearing capacity analyses and settlement predictions for a 10-building industrial park, producing foundation-design reports reviewed by three structural consultants. Cut report turnaround time by 25% with a standardised analysis template.",
    },
    {
      title: "Field Geotechnical Engineer",
      company: "Terrafirm Soils Ltd",
      location: "Kano, Nigeria",
      startDate: "2016",
      endDate: "2019",
      description:
        "Supervised field soil-testing crews on road and building foundation projects, logging over 300 boreholes and coordinating laboratory testing schedules.",
    },
  ],
  education: [
    { school: "Federal University of Technology, Minna", degree: "B.Eng.", field: "Civil Engineering", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "geotechnical investigation",
    "soil mechanics",
    "foundation design",
    "borehole logging",
    "settlement analysis",
    "cpt/spt testing",
    "laboratory soil testing",
    "technical reporting",
    "site supervision",
  ],
  projects: [
    "Soft-soil risk identification — saved client an estimated ₦120M in redesign costs",
    "10-building industrial park foundation design — cut report turnaround 25%",
  ],
  certifications: [
    "NEBOSH International General Certificate in Occupational Health and Safety",
    "ISO/IEC 17025 Laboratory Quality Management Certificate",
  ],
};

/**
 * `property-portfolio` persona — a real estate development manager
 * overseeing a portfolio of building developments, a Construction & Real
 * Estate register rather than an engineering one. `property-portfolio`'s
 * layout is projects-first, so `projects` names actual developments.
 */
export const REAL_ESTATE_DEVELOPMENT_MANAGER_RESUME: StructuredResume = {
  contact: {
    name: "Folake Adigun",
    email: "folake.adigun@primeacres.ng",
    phone: "+234 701 556 2298",
    location: "Lagos, Nigeria",
  },
  summary:
    "Real estate development manager with nine years overseeing residential and mixed-use developments across Lagos, from land acquisition and feasibility through construction delivery and lease-up.",
  experience: [
    {
      title: "Senior Development Manager",
      company: "Prime Acres Development Ltd",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Oversee a portfolio of four residential and mixed-use developments worth over ₦15B, managing feasibility studies, contractor selection and delivery timelines. Improved average construction-to-handover time by 20% across the portfolio.",
    },
    {
      title: "Development Manager",
      company: "Prime Acres Development Ltd",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Managed the ₦4.2B development of a 180-unit gated residential estate from land acquisition through handover, coordinating architects, contractors and financiers. Achieved 95% pre-sale of units before project completion.",
    },
    {
      title: "Development Analyst",
      company: "Lakeshore Properties",
      location: "Lagos, Nigeria",
      startDate: "2016",
      endDate: "2019",
      description:
        "Supported feasibility and financial modelling for three residential development proposals, and tracked construction budgets against forecast on a 60-unit apartment scheme.",
    },
  ],
  education: [
    { school: "Obafemi Awolowo University", degree: "B.Sc.", field: "Estate Management", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "real estate development",
    "feasibility analysis",
    "project financing",
    "contractor management",
    "construction oversight",
    "market analysis",
    "lease-up strategy",
    "stakeholder management",
    "budget tracking",
  ],
  projects: [
    "180-unit gated residential estate — achieved 95% pre-sale before completion",
    "Four-development portfolio — improved construction-to-handover time by 20%",
  ],
  certifications: ["LEED Green Associate", "Project Management Professional (PMP)"],
};

/**
 * `rig-report` persona — an offshore drilling rig supervisor/driller.
 * Distinct from `offshore`'s platform-based process engineer below: this is
 * the rig itself, not the production platform.
 */
export const DRILLING_RIG_SUPERVISOR_RESUME: StructuredResume = {
  contact: {
    name: "Godwin Etuk",
    email: "godwin.etuk@deepridge-drilling.com",
    phone: "+234 803 447 6612",
    location: "Port Harcourt, Nigeria",
  },
  summary:
    "Offshore drilling rig supervisor with ten years running drilling operations on jack-up and semi-submersible rigs across the Niger Delta, with a strong safety record and deep well-control experience.",
  experience: [
    {
      title: "Rig Supervisor",
      company: "Deepridge Drilling Services",
      location: "Offshore Niger Delta",
      startDate: "2021",
      endDate: "Present",
      description:
        "Supervise 24-hour drilling operations on a jack-up rig drilling to 4,200m TVD, leading a 45-person rig crew across two shifts. Cut non-productive time by 18% by tightening the pre-tour safety-briefing and equipment-check process.",
    },
    {
      title: "Assistant Rig Supervisor",
      company: "Deepridge Drilling Services",
      location: "Offshore Niger Delta",
      startDate: "2017",
      endDate: "2021",
      description:
        "Coordinated drilling and well-control operations across three exploration wells, supervising the driller and derrickman teams. Maintained a zero-lost-time-incident record across 900,000 crew-hours.",
    },
    {
      title: "Driller",
      company: "Northsea Offshore Contractors",
      location: "Offshore Bonny, Nigeria",
      startDate: "2013",
      endDate: "2017",
      description:
        "Operated the drilling console for directional and vertical wells on a semi-submersible rig, managing mud-weight and pressure control during a 14-well drilling campaign.",
    },
  ],
  education: [
    { school: "Rivers State University", degree: "B.Eng.", field: "Petroleum Engineering", startDate: "2009", endDate: "2013" },
  ],
  skills: [
    "drilling operations management",
    "well control",
    "rig crew supervision",
    "hse leadership",
    "blowout preventer (bop) operations",
    "mud systems management",
    "permit-to-work systems",
    "incident investigation",
    "drilling reporting",
  ],
  projects: [
    "Jack-up rig drilling programme — cut non-productive time 18%",
    "Three-well exploration campaign — zero lost-time incidents across 900,000 crew-hours",
  ],
  certifications: [
    "IWCF Well Control Certificate — Surface Stack, Level 3",
    "OPITO BOSIET (Basic Offshore Safety Induction and Emergency Training)",
  ],
};

/**
 * `offshore` persona — a platform-based process/operations engineer,
 * distinct from `rig-report`'s driller above: production operations, not
 * drilling.
 */
export const OFFSHORE_PROCESS_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "Chiamaka Obi",
    email: "chiamaka.obi@atlanticplatforms.com",
    phone: "+234 816 229 8834",
    location: "Port Harcourt, Nigeria",
  },
  summary:
    "Offshore process and operations engineer with eight years running production operations on fixed and floating platforms across the Niger Delta, focused on process safety and uptime.",
  experience: [
    {
      title: "Senior Process Operations Engineer",
      company: "Atlantic Platforms Nigeria Ltd",
      location: "Offshore Niger Delta",
      startDate: "2022",
      endDate: "Present",
      description:
        "Oversee process operations on a fixed offshore production platform handling 60,000 bopd, leading a 12-person operations team across rotating shifts. Improved platform uptime from 91% to 97% by redesigning the planned-maintenance schedule.",
    },
    {
      title: "Process Operations Engineer",
      company: "Atlantic Platforms Nigeria Ltd",
      location: "Offshore Niger Delta",
      startDate: "2019",
      endDate: "2022",
      description:
        "Managed separator and gas-compression operations on an FPSO, troubleshooting process upsets and coordinating shutdown/start-up sequences. Reduced unplanned shutdown frequency by 30% over two years.",
    },
    {
      title: "Field Process Engineer",
      company: "Delta Basin Energy",
      location: "Warri, Nigeria",
      startDate: "2016",
      endDate: "2019",
      description:
        "Monitored crude-processing and gas-handling operations at an onshore flow station, supporting root-cause analysis on 20+ process incidents and implementing corrective actions.",
    },
  ],
  education: [
    { school: "University of Port Harcourt", degree: "B.Eng.", field: "Chemical Engineering", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "offshore process operations",
    "production optimisation",
    "process safety management",
    "shutdown/start-up management",
    "separator & compression systems",
    "root-cause analysis",
    "permit-to-work systems",
    "operations reporting",
    "team leadership",
  ],
  projects: [
    "Fixed platform maintenance redesign — lifted uptime from 91% to 97%",
    "FPSO shutdown-sequence improvement — cut unplanned shutdowns 30%",
  ],
  certifications: [
    "OPITO BOSIET (Basic Offshore Safety Induction and Emergency Training)",
    "ISO 45001 Lead Auditor (Occupational Health & Safety Management)",
  ],
};

/**
 * `wellhead` persona — a wellhead/completions engineer. The only slug in
 * this grouping whose `structure_schema` includes a `languages` section
 * (sidebar-left, sectionOrder starts certifications→skills→languages...),
 * so this is the one persona here that actually populates `languages` —
 * plausible given real rotational work with a francophone-Africa operating
 * partner (Chad/Congo JV operations are a common Niger Delta engineer path).
 */
export const WELLHEAD_COMPLETIONS_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "Uche Nnamdi",
    email: "uche.nnamdi@meridianenergy.com",
    phone: "+234 708 331 4470",
    location: "Warri, Nigeria",
  },
  summary:
    "Wellhead and completions engineer with nine years delivering well-completion and wellhead-installation programmes for onshore and offshore operators across Nigeria and Central Africa.",
  experience: [
    {
      title: "Senior Completions Engineer",
      company: "Meridian Energy Services",
      location: "Warri, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Lead wellhead installation and completions design for a 12-well offshore development programme with an international operating partner, coordinating completion-fluid and perforation strategy. Cut average well-completion time from 9 days to 6.",
    },
    {
      title: "Completions Engineer",
      company: "Meridian Energy Services",
      location: "N'Djamena, Chad (rotational)",
      startDate: "2019",
      endDate: "2022",
      description:
        "Managed wellhead and Christmas-tree installation on a joint-venture field with a francophone operating partner, supervising completion crews across six wells. Standardised the completions handover checklist adopted across the JV's other assets.",
    },
    {
      title: "Junior Completions Engineer",
      company: "Delta Basin Energy",
      location: "Warri, Nigeria",
      startDate: "2016",
      endDate: "2019",
      description:
        "Supported completion design and wellhead commissioning on 15 onshore wells, tracking equipment specifications against operator requirements.",
    },
  ],
  education: [
    { school: "University of Ibadan", degree: "B.Eng.", field: "Petroleum Engineering", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "wellhead installation",
    "completions design",
    "christmas tree commissioning",
    "well control",
    "perforation strategy",
    "completion fluids management",
    "jv operations coordination",
    "technical reporting",
    "hse compliance",
  ],
  projects: [
    "12-well offshore completions programme — cut completion time from 9 to 6 days",
    "JV completions handover checklist — adopted across partner's other assets",
  ],
  certifications: [
    "IWCF Well Control Certificate — Subsea, Level 4",
    "OPITO BOSIET (Basic Offshore Safety Induction and Emergency Training)",
  ],
  languages: [
    { name: "English", level: "Fluent" },
    { name: "French", level: "Conversational" },
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
 * `impact-report` persona — a monitoring & evaluation / impact-reporting
 * specialist. Deliberately a DIFFERENT job from `field-mission`'s programme
 * officer (Ngozi): M&E is about measuring and reporting on programmes other
 * people run, not running the programmes directly — a distinction donors
 * and NGO recruiters actually draw. `structure_schema` for this slug
 * includes `volunteering`, populated below to match.
 */
export const IMPACT_REPORTING_OFFICER_RESUME: StructuredResume = {
  contact: {
    name: "Ijeoma Nwafor",
    email: "ijeoma.nwafor@impactline.org",
    phone: "+234 705 288 9931",
    location: "Abuja, Nigeria",
  },
  summary:
    "Monitoring, evaluation and impact-reporting specialist with seven years building donor accountability systems for development programmes across Nigeria, translating field data into evidence donors trust.",
  experience: [
    {
      title: "Senior M&E Officer",
      company: "Bridgepoint Development Partners",
      location: "Abuja, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Designed and run the results-measurement framework for a €3.2M EU-funded livelihoods programme across 5 states, consolidating data from 40 field enumerators into quarterly donor reports. Built a standardized Power BI dashboard that cut report-production time from 6 weeks to 10 days, and caught a data-entry error pattern that corrected an overstated beneficiary count by 12%.",
    },
    {
      title: "M&E Officer",
      company: "Bridgepoint Development Partners",
      location: "Abuja, Nigeria",
      startDate: "2019",
      endDate: "2021",
      description:
        "Led a randomized post-distribution monitoring survey across 6,500 households for a cash-transfer programme, and built the anomaly-detection checks that flagged 3% of transfers for review before disbursement.",
    },
    {
      title: "Data & Reporting Assistant",
      company: "Lakeshore Relief Network",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Compiled quarterly indicator reports for a WASH programme reaching 15,000 beneficiaries, standardizing data-collection templates across 4 partner NGOs.",
    },
  ],
  education: [
    { school: "University of Abuja", degree: "B.Sc.", field: "Statistics", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "monitoring & evaluation",
    "results-based management",
    "power bi",
    "spss",
    "survey design",
    "donor reporting",
    "theory of change / logframe design",
    "data quality assurance",
    "stata",
  ],
  projects: [
    "EU livelihoods programme results dashboard — cut report turnaround from 6 weeks to 10 days",
    "Post-distribution monitoring survey (6,500 households) — flagged 3% of disbursements for review pre-payment",
    "WASH indicator reporting standardization — unified templates across 4 partner NGOs",
  ],
  certifications: [
    "Data Quality Assessment (DQA) Certificate — MEASURE Evaluation Training",
    "Advanced M&E Certificate — International Program for Development Evaluation Training (IPDET)",
  ],
  volunteering: [
    {
      role: "Volunteer Data Analyst",
      organisation: "Abuja Community Health Initiative",
      startDate: "2015",
      endDate: "2017",
      description: "Supported community health surveys and data cleaning for a maternal-health outreach programme.",
    },
  ],
};

/**
 * `grant-proposal` persona — a grants and proposal-development officer,
 * distinct again from Ngozi (field-mission) and Ijeoma (impact-report):
 * this is the person who WINS the funding, not the one running it or
 * measuring it. `structure_schema` for this slug promotes `skills` and
 * `languages` above the narrative (donor-language fluency matters for a
 * proposal writer) and includes `volunteering`, both populated below —
 * French is plausible here for the same reason it is on `wellhead`
 * (WELLHEAD_COMPLETIONS_ENGINEER_RESUME, above): real cross-border work,
 * here with Nigeria's francophone Sahel neighbours (Niger, Chad).
 */
export const GRANTS_PROPOSAL_OFFICER_RESUME: StructuredResume = {
  contact: {
    name: "Musa Aliyu",
    email: "musa.aliyu@sahelgrants.org",
    phone: "+234 812 664 2207",
    location: "Abuja, Nigeria",
  },
  summary:
    "Grants and proposal-development officer with six years winning and managing donor funding for cross-border Sahel programmes, turning complex regional need into competitive, compliant proposals for USAID, EU and UN donors.",
  experience: [
    {
      title: "Senior Grants Officer",
      company: "Sahel Frontier Alliance",
      location: "Abuja, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Lead proposal development for an $8.4M multi-country USAID consortium bid spanning Nigeria, Niger and Chad, coordinating inputs from 5 technical leads and 3 partner organisations on a 21-day turnaround. Won 3 of 5 proposals submitted in the last funding cycle, against a sector average closer to 1 in 5.",
    },
    {
      title: "Grants Officer",
      company: "Sahel Frontier Alliance",
      location: "Abuja, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description:
        "Managed compliance and reporting for a €1.6M EU grant portfolio across 4 active awards, and rebuilt the internal proposal-budget template that cut donor-flagged budget-narrative errors from 40% of submissions to under 10%.",
    },
    {
      title: "Programme Support Officer",
      company: "Niger Basin Partners",
      location: "Kano, Nigeria",
      startDate: "2018",
      endDate: "2020",
      description:
        "Supported concept-note development for regional food-security appeals, drafting first-pass budgets for 12 concept notes in a single funding round.",
    },
  ],
  education: [
    { school: "Usmanu Danfodiyo University, Sokoto", degree: "B.Sc.", field: "Political Science", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "grant & proposal writing",
    "donor compliance (usaid, eu, un)",
    "budget development",
    "consortium & partner coordination",
    "concept note development",
    "grant portfolio management",
    "needs assessment",
    "cost-share & match tracking",
    "cross-border programme design",
  ],
  projects: [
    "$8.4M multi-country USAID consortium bid — won, 3-country Sahel food-security programme",
    "EU grant compliance overhaul — cut donor-flagged budget errors from 40% to under 10%",
    "Regional concept-note sprint — 12 concept notes drafted in one funding round",
  ],
  certifications: [
    "Grant Professional Certified (GPC) — Grant Professionals Certification Institute",
    "Certificate in USAID Rules & Regulations — Humentum Training",
  ],
  volunteering: [
    {
      role: "Volunteer Program Support",
      organisation: "Zamfara Relief Coordination Committee",
      startDate: "2016",
      endDate: "2018",
      description: "Assisted with drought-response needs assessments and community sensitization ahead of a food-security appeal.",
    },
  ],
  languages: [
    { name: "English", level: "Fluent" },
    { name: "Hausa", level: "Native" },
    { name: "French", level: "Professional working proficiency" },
  ],
};

/**
 * `harvest` persona — a commercial agronomist / farm operations manager.
 * `structure_schema` for this slug promotes certifications right under
 * experience with the label "Certifications (GAP, Organic)", so this
 * persona's certifications are chosen specifically to back that up.
 */
export const COMMERCIAL_AGRONOMIST_RESUME: StructuredResume = {
  contact: {
    name: "Bashir Suleiman",
    email: "bashir.suleiman@greenfieldsagritech.com",
    phone: "+234 803 771 4482",
    location: "Kaduna, Nigeria",
  },
  summary:
    "Commercial agronomist with eight years managing large-scale grain and vegetable production for agribusiness outgrower schemes across northern Nigeria, focused on yield optimization and export-grade quality compliance.",
  experience: [
    {
      title: "Farm Operations Manager",
      company: "Greenfields AgriTech Ltd",
      location: "Kaduna, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Manage 1,200 hectares of maize and soybean production across 3 outgrower clusters, supervising 8 field supervisors and 200+ contract farmers. Introduced a soil-testing-led fertiliser programme that lifted average maize yield from 2.4t/ha to 3.6t/ha (a 50% increase) across the 2023 season.",
    },
    {
      title: "Senior Agronomist",
      company: "Greenfields AgriTech Ltd",
      location: "Kaduna, Nigeria",
      startDate: "2018",
      endDate: "2021",
      description:
        "Ran the GlobalG.A.P. certification readiness programme for the company's export vegetable line, closing 90% of audit non-conformances within one growing season and helping secure the farm's first export contract to the EU.",
    },
    {
      title: "Field Agronomist",
      company: "Kaduna Valley Farms",
      location: "Kaduna, Nigeria",
      startDate: "2016",
      endDate: "2018",
      description:
        "Managed integrated pest management for 300 hectares of tomato and pepper, cutting post-harvest losses from 28% to 15% through revised harvest-timing protocols.",
    },
  ],
  education: [
    { school: "Ahmadu Bello University", degree: "B.Agric.", field: "Agronomy", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "crop production management",
    "soil & fertiliser management",
    "globalg.a.p. compliance",
    "yield optimization",
    "outgrower scheme coordination",
    "integrated pest management",
    "farm budgeting",
    "post-harvest handling",
    "agronomic data record-keeping",
  ],
  projects: [
    "Soil-testing-led fertiliser programme — lifted maize yield 50% (2.4t/ha to 3.6t/ha)",
    "GlobalG.A.P. certification readiness — closed 90% of audit non-conformances, won first EU export contract",
    "Integrated pest management overhaul — cut tomato/pepper post-harvest losses from 28% to 15%",
  ],
  certifications: [
    "GlobalG.A.P. Certified Farm Assessor Training Certificate",
    "Organic Agriculture Certificate — Nigerian Organic Agriculture Network (NOAN) Training Programme",
    "Integrated Pest Management Certificate — IITA Training Programme",
  ],
};

/**
 * `field-season` persona — a seasonal field / crop-production supervisor.
 * Deliberately a different register from `harvest`'s agronomist above: this
 * is hands-on seasonal labour and harvest-logistics supervision, not
 * yield-science and certification management.
 */
export const FIELD_PRODUCTION_SUPERVISOR_RESUME: StructuredResume = {
  contact: {
    name: "Grace Okonkwo",
    email: "grace.okonkwo@savannafreshfarms.com",
    phone: "+234 706 553 8821",
    location: "Makurdi, Nigeria",
  },
  summary:
    "Field production supervisor with six seasons managing seasonal cropping cycles and harvest labour for commercial rice and yam operations in Nigeria's Middle Belt.",
  experience: [
    {
      title: "Field Production Supervisor",
      company: "Savanna Fresh Farms",
      location: "Makurdi, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Supervise seasonal planting-to-harvest operations across 450 hectares of rice, coordinating a rotating labour force of up to 150 seasonal workers at peak harvest. Restructured the harvest-labour scheduling system to align with milling capacity, cutting field-to-mill spoilage from 11% to 4% over two seasons.",
    },
    {
      title: "Assistant Field Supervisor",
      company: "Savanna Fresh Farms",
      location: "Makurdi, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description:
        "Ran daily field-scouting and irrigation-timing for 200 hectares of dry-season rice, and trained 40 seasonal workers on transplanting technique, lifting average stand establishment from 78% to 91%.",
    },
    {
      title: "Farm Labour Coordinator",
      company: "Benue Valley Agroservices",
      location: "Makurdi, Nigeria",
      startDate: "2018",
      endDate: "2020",
      description:
        "Coordinated seasonal recruitment and payroll for up to 300 casual farm workers across two planting cycles a year, with zero payroll disputes across 4 consecutive seasons.",
    },
  ],
  education: [
    { school: "Federal University of Agriculture, Makurdi", degree: "B.Agric.", field: "Crop Production", startDate: "2014", endDate: "2018" },
  ],
  skills: [
    "seasonal labour planning",
    "crop scouting",
    "irrigation scheduling",
    "harvest logistics",
    "yield & spoilage tracking",
    "farm payroll coordination",
    "rice production systems",
    "worker training & supervision",
    "agronomic record-keeping",
  ],
  projects: [
    "Harvest-to-mill scheduling overhaul — cut spoilage from 11% to 4% across two seasons",
    "Transplanting technique training programme — lifted stand establishment from 78% to 91%",
    "Seasonal payroll system for 300 casual workers — zero disputes across 4 seasons",
  ],
  certifications: [
    "Good Agricultural Practices (GAP) Training Certificate",
    "Occupational Safety Training for Agricultural Workers — FAO/ILO Training Programme",
  ],
};

/**
 * `value-chain` persona — an agribusiness value-chain / market-access
 * analyst. `structure_schema` for this slug is the only one of the 6
 * NGO & Development / Agriculture & Agribusiness slugs that includes
 * `languages` (verified directly in catalog-configs.ts before writing this
 * — `grant-proposal`'s schema also includes `languages`, so that persona
 * gets one too, above). French is plausible here for the same real reason
 * as `grant-proposal` and `wellhead`: cross-border commodity trade with
 * Nigeria's francophone neighbours (Niger, Benin).
 */
export const VALUE_CHAIN_ANALYST_RESUME: StructuredResume = {
  contact: {
    name: "Fatima Mohammed",
    email: "fatima.mohammed@westafricagriexchange.com",
    phone: "+234 809 442 1156",
    location: "Kano, Nigeria",
  },
  summary:
    "Agribusiness value-chain analyst with seven years mapping market access and cross-border trade routes for grain and livestock value chains between Nigeria and its francophone neighbours.",
  experience: [
    {
      title: "Senior Value Chain Analyst",
      company: "West Africa Agri Exchange",
      location: "Kano, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Lead market-access analysis for a grain-trade corridor linking Kano to Niamey and Maradi, advising 3 exporter clients on tariff and non-tariff barriers across the Nigeria–Niger border. Identified a warehousing bottleneck that, once resolved with a client, cut average dispatch time from 9 days to 4.",
    },
    {
      title: "Value Chain Analyst",
      company: "West Africa Agri Exchange",
      location: "Kano, Nigeria",
      startDate: "2019",
      endDate: "2021",
      description:
        "Built the cost-structure model comparing 4 competing maize export routes through ECOWAS corridors, which the client used to redirect 60% of volume to the lowest-cost route and cut landed cost per tonne by 14%.",
    },
    {
      title: "Trade & Market Research Officer",
      company: "Sahel Commodities Bureau",
      location: "Kano, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Produced weekly cross-border price-monitoring bulletins covering 6 regional markets, cited in 3 donor food-security early-warning reports.",
    },
  ],
  education: [
    { school: "Kano University of Science and Technology, Wudil", degree: "B.Sc.", field: "Economics", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "value chain analysis",
    "market access strategy",
    "cross-border trade compliance",
    "cost-structure modeling",
    "ecowas trade regulations",
    "commodity price monitoring",
    "logistics & warehousing analysis",
    "stakeholder advisory",
    "agribusiness market research",
  ],
  projects: [
    "Kano–Niamey grain corridor market-access study — cut client dispatch time from 9 to 4 days",
    "Multi-route maize export cost model — redirected 60% of volume, cut landed cost 14%",
    "Weekly cross-border price bulletin — cited in 3 donor early-warning reports",
  ],
  certifications: [
    "Value Chain Analysis Certificate — Feed the Future/USAID Training Programme",
    "ECOWAS Trade Liberalisation Scheme (ETLS) Practitioner Certificate",
  ],
  languages: [
    { name: "English", level: "Fluent" },
    { name: "Hausa", level: "Native" },
    { name: "French", level: "Professional working proficiency" },
  ],
};

/**
 * `product-tech` persona — a backend/full-stack software engineer. This
 * slug's `structure_schema` sets `showLinksInHeader: true` (the config the
 * PR2 brief's "links in header used meaningfully" requirement was written
 * for — see catalog-configs.ts), so this is the persona that actually
 * populates `links`.
 */
export const SOFTWARE_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "David Adeyemi",
    email: "david.adeyemi@stackforge.dev",
    phone: "+234 810 225 6693",
    location: "Lagos, Nigeria",
  },
  summary:
    "Backend-leaning full-stack engineer with six years building high-throughput payments and logistics APIs for Nigerian and pan-African startups.",
  experience: [
    {
      title: "Senior Software Engineer",
      company: "StackForge Technologies",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Own the core ledger service processing 2M+ daily transactions for a multi-country payments platform. Migrated the settlement pipeline from synchronous REST calls to an event-driven architecture (Kafka), cutting p95 settlement latency from 4.2s to 800ms and eliminating a recurring double-settlement bug.",
    },
    {
      title: "Software Engineer",
      company: "StackForge Technologies",
      location: "Lagos, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description:
        "Built the fraud-scoring microservice integrated into the checkout flow, reducing confirmed fraud losses by 37% in its first two quarters live.",
    },
    {
      title: "Junior Backend Developer",
      company: "Lagos Freight Systems",
      location: "Lagos, Nigeria",
      startDate: "2018",
      endDate: "2020",
      description:
        "Rebuilt the shipment-tracking API from a monolith into a versioned REST service used by 3 internal apps, cutting average API response time from 900ms to 180ms.",
    },
  ],
  education: [
    { school: "Covenant University, Ota", degree: "B.Sc.", field: "Computer Science", startDate: "2014", endDate: "2018" },
  ],
  skills: [
    "backend engineering",
    "distributed systems",
    "kafka",
    "postgresql",
    "node.js / typescript",
    "api design",
    "system design",
    "ci/cd",
    "fraud detection systems",
  ],
  projects: [
    "Event-driven settlement pipeline migration — cut p95 latency from 4.2s to 800ms",
    "Real-time fraud-scoring microservice — cut confirmed fraud losses 37%",
    "Shipment-tracking API rebuild — cut average response time from 900ms to 180ms",
  ],
  certifications: ["AWS Certified Solutions Architect – Associate", "Certified Kubernetes Administrator (CKA)"],
  links: [
    { label: "GitHub", url: "https://github.com/davideyemi" },
    { label: "Portfolio", url: "https://davidadeyemi.dev" },
  ],
};

/**
 * `ledger` persona — a credit/risk analyst at a Nigerian commercial bank.
 */
export const CREDIT_RISK_ANALYST_RESUME: StructuredResume = {
  contact: {
    name: "Oluwaseun Bakare",
    email: "oluwaseun.bakare@meridiantrustbank.com",
    phone: "+234 802 336 7745",
    location: "Lagos, Nigeria",
  },
  summary:
    "Credit and risk analyst with seven years assessing SME and corporate lending exposure for a Tier-2 Nigerian commercial bank, balancing portfolio growth against default risk.",
  experience: [
    {
      title: "Senior Credit Analyst",
      company: "Meridian Trust Bank",
      location: "Lagos, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Underwrite and monitor a ₦4.6B SME loan portfolio across 220 active accounts, presenting risk recommendations to the credit committee. Rebuilt the early-warning scoring model, cutting the 90-day-past-due rate on new originations from 6.8% to 3.1% within 18 months.",
    },
    {
      title: "Credit Analyst",
      company: "Meridian Trust Bank",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2021",
      description:
        "Conducted financial-statement and cash-flow analysis for 150+ corporate credit applications a year, and built the covenant-tracking dashboard now used bank-wide to flag breaches within 48 hours instead of at quarterly review.",
    },
    {
      title: "Graduate Credit Trainee",
      company: "Coastal Merchant Bank",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Supported due diligence on a ₦1.2B syndicated facility, compiling the sector-risk benchmarking used in the final credit memo.",
    },
  ],
  education: [
    { school: "Lagos State University", degree: "B.Sc.", field: "Economics", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "credit risk analysis",
    "financial statement analysis",
    "cash-flow modeling",
    "loan underwriting",
    "portfolio monitoring",
    "covenant tracking",
    "credit scoring models",
    "ifrs 9 impairment analysis",
    "financial modeling (excel)",
  ],
  projects: [
    "Early-warning credit scoring model rebuild — cut 90-day-past-due rate from 6.8% to 3.1%",
    "Bank-wide covenant-tracking dashboard — flags breaches within 48 hours vs. quarterly review",
    "₦1.2B syndicated facility due diligence — sector-risk benchmarking used in final credit memo",
  ],
  certifications: [
    "Chartered Financial Analyst (CFA) Program — Level I Candidate",
    "Financial Modeling & Valuation Analyst (FMVA) — Corporate Finance Institute",
  ],
};

/**
 * `care-plan` persona — a registered nurse / ward care coordinator.
 * Certifications are real, portable clinical-skills credentials (BLS/ACLS)
 * rather than a claim to the Nigerian medical/nursing licensing body — same
 * rule `blueprint`'s COREN fix established (see this file's top-of-file
 * header and tests/resume-builder/catalog-configs-labels.test.ts).
 */
export const REGISTERED_NURSE_RESUME: StructuredResume = {
  contact: {
    name: "Patience Okoye",
    email: "patience.okoye@lakeviewhealthcare.ng",
    phone: "+234 703 219 8867",
    location: "Enugu, Nigeria",
  },
  summary:
    "Registered nurse with eight years in acute and chronic-care coordination across Nigerian private hospitals, focused on reducing readmissions through structured discharge planning.",
  experience: [
    {
      title: "Senior Staff Nurse / Care Coordinator",
      company: "Lakeview Specialist Hospital",
      location: "Enugu, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Coordinate discharge planning and follow-up for a 40-bed internal medicine ward, managing a caseload of 25-30 patients at a time. Introduced a structured 72-hour post-discharge call-back programme that cut 30-day readmissions on the ward from 18% to 9%.",
    },
    {
      title: "Staff Nurse",
      company: "Lakeview Specialist Hospital",
      location: "Enugu, Nigeria",
      startDate: "2018",
      endDate: "2021",
      description:
        "Delivered direct bedside care on a 20-bed surgical ward, and led the medication-reconciliation audit that cut prescription-error incidents by 60% over one year.",
    },
    {
      title: "Staff Nurse",
      company: "Nsukka General Hospital",
      location: "Nsukka, Nigeria",
      startDate: "2016",
      endDate: "2018",
      description:
        "Rotated across paediatric and maternity wards, and trained 12 newly-onboarded nurses on the hospital's electronic vitals-charting system during its rollout.",
    },
  ],
  education: [
    { school: "University of Nigeria, Nsukka", degree: "B.NSc.", field: "Nursing Science", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "patient care coordination",
    "discharge planning",
    "medication reconciliation",
    "electronic health records",
    "vital signs monitoring",
    "chronic disease management",
    "patient education",
    "ward/caseload management",
    "infection control protocols",
  ],
  projects: [
    "72-hour post-discharge call-back programme — cut 30-day readmissions from 18% to 9%",
    "Medication-reconciliation audit — cut prescription errors 60% in one year",
    "Electronic vitals-charting rollout training — onboarded 12 new nurses",
  ],
  certifications: [
    "Basic Life Support (BLS) Certification — American Heart Association",
    "Advanced Cardiovascular Life Support (ACLS) Certification",
  ],
};

/**
 * `chambers` persona — a corporate & commercial legal associate.
 * Certifications are real, portable professional credentials rather than a
 * claim to the Nigerian Bar Association (same rule as `blueprint`'s COREN
 * fix). `structure_schema` for this slug includes both `languages` and
 * `publications` (verified in catalog-configs.ts before writing this), both
 * populated below — French for real cross-border ECOWAS client work, a
 * publication for a corporate lawyer whose practice includes advisory work
 * genuinely worth writing up.
 */
export const CORPORATE_LEGAL_ASSOCIATE_RESUME: StructuredResume = {
  contact: {
    name: "Aisha Garba",
    email: "aisha.garba@westgatelegalpractice.com",
    phone: "+234 805 671 2298",
    location: "Abuja, Nigeria",
  },
  summary:
    "Corporate and commercial lawyer with six years advising Nigerian and cross-border clients on contracts, regulatory compliance and ECOWAS trade transactions.",
  experience: [
    {
      title: "Senior Associate",
      company: "Westgate Legal Practice",
      location: "Abuja, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Lead contract drafting and negotiation for 30+ commercial transactions a year, including cross-border supply agreements with clients in Benin Republic and Togo. Restructured the firm's standard NDA and distribution-agreement templates, cutting average contract turnaround from 12 days to 5.",
    },
    {
      title: "Associate",
      company: "Westgate Legal Practice",
      location: "Abuja, Nigeria",
      startDate: "2019",
      endDate: "2021",
      description:
        "Advised 15 SME clients on data-protection compliance programmes ahead of the NDPR enforcement deadline, and drafted the firm's internal compliance-audit checklist now used across the corporate practice group.",
    },
    {
      title: "Associate (Litigation & Corporate)",
      company: "Adeyemi Okafor & Co.",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Supported due diligence on 8 commercial disputes and 2 M&A transactions, preparing the disclosure schedules for a ₦900M asset-sale deal.",
    },
  ],
  education: [
    { school: "Nnamdi Azikiwe University, Awka", degree: "LL.B.", field: "Law", startDate: "2011", endDate: "2015" },
    { school: "Nigerian Law School, Bwari Campus", degree: "B.L.", field: "Barrister-at-Law", startDate: "2015", endDate: "2016" },
  ],
  skills: [
    "contract drafting & negotiation",
    "corporate/commercial law",
    "regulatory compliance",
    "cross-border transactions",
    "due diligence",
    "corporate governance",
    "dispute resolution",
    "ecowas trade law",
    "client advisory",
  ],
  projects: [
    "Contract-template overhaul — cut average turnaround from 12 to 5 days",
    "NDPR compliance rollout for 15 SME clients ahead of enforcement deadline",
    "₦900M asset-sale due diligence — full disclosure schedule preparation",
  ],
  certifications: [
    "Chartered Institute of Arbitrators (CIArb) — Introductory Certificate in International Commercial Arbitration",
    "Certified Information Privacy Professional/Europe (CIPP/E) — IAPP",
  ],
  publications: ["Co-authored \"Data Protection Compliance for Nigerian SMEs\" — Lagos Business Law Journal, 2022"],
  languages: [
    { name: "English", level: "Fluent" },
    { name: "Hausa", level: "Native" },
    { name: "French", level: "Professional working proficiency" },
  ],
};

/**
 * `business-memo` persona — a business operations manager.
 */
export const BUSINESS_OPERATIONS_MANAGER_RESUME: StructuredResume = {
  contact: {
    name: "Chukwuemeka Obiora",
    email: "chukwuemeka.obiora@primestreamops.com",
    phone: "+234 807 552 3391",
    location: "Lagos, Nigeria",
  },
  summary:
    "Business operations manager with seven years streamlining process and vendor operations for consumer-goods distribution companies across Lagos and the South-West.",
  experience: [
    {
      title: "Operations Manager",
      company: "PrimeStream Distribution Ltd",
      location: "Lagos, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Run daily operations for a 3-warehouse FMCG distribution network serving 400+ retail outlets. Redesigned the inventory-replenishment process, cutting stockout incidents by 35% while reducing average warehouse holding costs by 18%.",
    },
    {
      title: "Senior Operations Analyst",
      company: "PrimeStream Distribution Ltd",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2021",
      description:
        "Led a vendor-consolidation initiative that cut the active supplier list from 85 to 52 without disrupting fill rates, saving ₦38M annually in procurement overhead.",
    },
    {
      title: "Operations Analyst",
      company: "Lagoon Consumer Goods",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Built the weekly ops-performance reporting pack used by the executive team, standardizing 6 previously inconsistent regional reports into one dashboard.",
    },
  ],
  education: [
    { school: "University of Ilorin", degree: "B.Sc.", field: "Business Administration", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "operations management",
    "inventory & supply chain optimization",
    "vendor management",
    "process improvement",
    "warehouse operations",
    "cost reduction",
    "kpi reporting & dashboards",
    "cross-functional coordination",
    "procurement strategy",
  ],
  projects: [
    "Inventory-replenishment redesign — cut stockouts 35%, warehouse holding costs 18%",
    "Vendor consolidation (85 to 52 suppliers) — saved ₦38M annually with no fill-rate disruption",
    "Unified ops-performance dashboard — replaced 6 inconsistent regional reports",
  ],
  certifications: ["Certified Supply Chain Professional (CSCP) — APICS/ASCM", "Lean Six Sigma Green Belt Certification"],
};

// ---------------------------------------------------------------------------
// BATCH 3A — 14 new personas across 5 categories (Administration, Business,
// Education & Academia, Sales & Marketing, Technology). See this file's
// top-of-file header for why these 5 categories and why now.
// ---------------------------------------------------------------------------

/**
 * `structured-admin` persona — an executive administrative assistant
 * supporting C-suite executives, distinct from `front-office`'s
 * reception/facilities register and `filing-system`'s records/archives
 * register below: this is calendar, travel and board-prep support for
 * senior executives, not front-of-house or document management.
 */
export const EXECUTIVE_ADMINISTRATIVE_ASSISTANT_RESUME: StructuredResume = {
  contact: {
    name: "Comfort Adeyinka",
    email: "comfort.adeyinka@bellcourtholdings.com",
    phone: "+234 802 918 4471",
    location: "Lagos, Nigeria",
  },
  summary:
    "Executive administrative assistant with eight years supporting C-suite executives at a Lagos conglomerate, managing complex scheduling, travel and cross-department coordination with precision.",
  experience: [
    {
      title: "Senior Executive Assistant",
      company: "Bellcourt Holdings Group",
      location: "Lagos, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Support the CEO and two EVPs, managing a shared calendar across 4 time zones for global partner calls and coordinating travel and logistics for 40+ trips a year. Redesigned the board-meeting preparation workflow with the company secretary's office, cutting document turnaround from 3 days to 1.",
    },
    {
      title: "Executive Assistant",
      company: "Bellcourt Holdings Group",
      location: "Lagos, Nigeria",
      startDate: "2018",
      endDate: "2021",
      description:
        "Managed daily operations for the CFO's office, processing expense reconciliation for a 12-person finance leadership team. Reduced expense-report processing time by 45% after introducing a standardized approval template.",
    },
    {
      title: "Administrative Assistant",
      company: "Coastline Trading Company",
      location: "Lagos, Nigeria",
      startDate: "2015",
      endDate: "2018",
      description:
        "Supported a 15-person sales office with correspondence, scheduling and vendor invoicing, cutting payment-approval turnaround from 10 days to 4 by streamlining the invoice-routing process.",
    },
  ],
  education: [
    { school: "Lagos State Polytechnic", degree: "HND", field: "Office Technology and Management", startDate: "2011", endDate: "2014" },
  ],
  skills: [
    "executive calendar management",
    "travel & logistics coordination",
    "board meeting preparation",
    "expense reconciliation",
    "vendor & invoice coordination",
    "cross-department liaison",
    "minute-taking",
    "microsoft 365 / google workspace",
    "confidential correspondence handling",
    "stakeholder scheduling",
  ],
  projects: [
    "Board-meeting preparation workflow redesign — cut document turnaround from 3 days to 1",
    "CFO office expense reconciliation overhaul — cut processing time 45%",
    "Vendor invoice routing streamline — cut payment-approval turnaround from 10 to 4 days",
  ],
  certifications: [
    "Certified Administrative Professional (CAP) — International Association of Administrative Professionals (IAAP)",
    "Microsoft Office Specialist (MOS): Excel Expert",
  ],
};

/**
 * `front-office` persona — a corporate front-office/facilities manager,
 * deliberately NOT a hotel front-desk register (that belongs to Hospitality
 * & Travel's own `front-desk` slug, a different category with its own
 * future persona): this is reception, facilities and vendor coordination
 * for a corporate office campus. `structure_schema` labels `skills` as
 * "Office Software", so this persona's skills lean toward named tools.
 */
export const FRONT_OFFICE_MANAGER_RESUME: StructuredResume = {
  contact: {
    name: "Chinyere Nwankwo",
    email: "chinyere.nwankwo@westbridgecorporate.com",
    phone: "+234 807 331 5528",
    location: "Uyo, Nigeria",
  },
  summary:
    "Front office manager with seven years overseeing reception, facilities coordination and vendor management for corporate office environments across South-South Nigeria.",
  experience: [
    {
      title: "Front Office Manager",
      company: "Westbridge Corporate Services",
      location: "Uyo, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Manage a 4-person front-office and facilities team for a 300-staff corporate campus, overseeing visitor management, meeting-room scheduling and vendor contracts for cleaning and security. Cut average visitor check-in time from 6 minutes to under 90 seconds after digitizing the visitor log, and renegotiated 3 facilities vendor contracts, saving ₦9M annually.",
    },
    {
      title: "Front Office Supervisor",
      company: "Westbridge Corporate Services",
      location: "Uyo, Nigeria",
      startDate: "2018",
      endDate: "2021",
      description:
        "Supervised reception operations across two client sites, standardized the front-office handover checklist adopted company-wide, and cut the missed-call rate at reception from 22% to 6%.",
    },
    {
      title: "Front Desk Officer",
      company: "Delta Business Park",
      location: "Uyo, Nigeria",
      startDate: "2016",
      endDate: "2018",
      description:
        "Managed daily reception duties and visitor logs for a shared office facility with 40 tenant companies, coordinating meeting-room bookings and courier handling.",
    },
  ],
  education: [
    { school: "University of Uyo", degree: "B.Sc.", field: "Office and Information Management", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "visitor management systems (envoy/proxyclick)",
    "microsoft 365 (outlook, excel, teams)",
    "meeting-room booking software",
    "facilities management software",
    "vendor & contract management",
    "front-office operations",
    "team supervision",
    "customer service excellence",
    "health & safety compliance",
  ],
  projects: [
    "Digitized visitor check-in system — cut check-in time from 6 minutes to under 90 seconds",
    "Facilities vendor contract renegotiation — saved ₦9M annually across 3 contracts",
    "Company-wide front-office handover checklist — cut missed-call rate from 22% to 6%",
  ],
  certifications: [
    "IFMA Facility Management Professional (FMP) Foundations Certificate",
    "Certified Customer Service Professional (CCSP)",
  ],
};

/**
 * `filing-system` persona — a records & documentation officer. Distinct
 * from `structured-admin`'s executive-support register and `front-office`'s
 * reception register: this is records-retention compliance and physical/
 * digital archive management.
 */
export const RECORDS_DOCUMENTATION_OFFICER_RESUME: StructuredResume = {
  contact: {
    name: "Yusuf Abdullahi",
    email: "yusuf.abdullahi@falconarchives.com",
    phone: "+234 806 224 7793",
    location: "Sokoto, Nigeria",
  },
  summary:
    "Records and documentation officer with seven years managing physical and digital records-compliance programmes for corporate and public-sector offices across northern Nigeria.",
  experience: [
    {
      title: "Senior Records Officer",
      company: "Falcon Records & Archives Solutions",
      location: "Sokoto, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Manage the records-retention programme for a 200-employee organisation, overseeing digitization of 15 years of physical archives. Cut file-retrieval time from an average of 45 minutes to under 5 by building a barcode-indexed filing system, and closed a compliance audit with zero missing-file findings across 3,000 audited files.",
    },
    {
      title: "Documentation Officer",
      company: "Falcon Records & Archives Solutions",
      location: "Sokoto, Nigeria",
      startDate: "2018",
      endDate: "2021",
      description:
        "Maintained the central filing registry for HR and contracts documents, processing 200+ document requests a month with a same-day turnaround hit 95% of the time.",
    },
    {
      title: "Filing Clerk",
      company: "Northfield Registrars Ltd",
      location: "Kano, Nigeria",
      startDate: "2016",
      endDate: "2018",
      description:
        "Indexed and archived incoming correspondence and contract files for a document-management services client, maintaining a zero-loss record across 18 months.",
    },
  ],
  education: [
    { school: "Umaru Ali Shinkafi Polytechnic", degree: "HND", field: "Records and Information Management", startDate: "2013", endDate: "2016" },
  ],
  skills: [
    "records management",
    "document digitization",
    "filing systems administration",
    "microsoft office suite & sharepoint",
    "compliance auditing",
    "archival best practices",
    "data entry & indexing",
    "confidentiality & data protection",
    "retention scheduling",
  ],
  projects: [
    "Barcode-indexed filing system — cut file-retrieval time from 45 minutes to under 5",
    "15-year physical archive digitization programme — zero missing-file findings across 3,000 audited files",
    "Central HR/contracts filing registry — 95% same-day document-request turnaround",
  ],
  certifications: [
    "Certified Records Manager (CRM) — Institute of Certified Records Managers (ICRM)",
    "Certificate in Information and Records Management — AIIM Training",
  ],
};

/**
 * `clean-professional` persona — a business operations/administration
 * generalist. THE SPECIAL CASE this batch's header calls out: this is the
 * app-wide default fallback template (`getTemplateComponent`'s own
 * fallback component), so this persona had to read as genuine breadth
 * across functions (operations, administration, project coordination
 * across three different employers/industries) rather than one narrow
 * specialism — the opposite instinct from every other persona in this
 * registry, which is written to be AS SPECIFIC as possible to its slug.
 */
export const BUSINESS_GENERALIST_RESUME: StructuredResume = {
  contact: {
    name: "Yetunde Bankole",
    email: "yetunde.bankole@bridgewayconsulting.com",
    phone: "+234 813 445 2207",
    location: "Ibadan, Nigeria",
  },
  summary:
    "Versatile business professional with eight years spanning operations, administration and project coordination across retail, logistics and professional-services employers — equally comfortable running a project, managing a budget or fixing a broken process.",
  experience: [
    {
      title: "Business Operations Coordinator",
      company: "Bridgeway Consulting Group",
      location: "Ibadan, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Coordinate operations, vendor relationships and internal projects for a 35-person professional-services firm spanning HR, IT and facilities needs. Ran the office relocation project from planning to move-in with zero missed client-deliverable days, and cut monthly vendor spend by 15% through contract renegotiation.",
    },
    {
      title: "Administration & Projects Officer",
      company: "Sunrise Retail Group",
      location: "Ibadan, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Managed administrative operations across 6 retail outlets while running two cross-functional projects a year, including a POS-system rollout and a staff-scheduling overhaul that cut scheduling conflicts by 40%.",
    },
    {
      title: "Customer Operations Associate",
      company: "Westline Logistics",
      location: "Ibadan, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Handled customer service, dispatch coordination and reporting for a regional courier operation, and built the first standard operating procedure manual adopted company-wide.",
    },
  ],
  education: [
    { school: "The Polytechnic, Ibadan", degree: "HND", field: "Business Administration", startDate: "2013", endDate: "2016" },
  ],
  skills: [
    "project coordination",
    "operations management",
    "vendor & contract management",
    "process improvement",
    "budget tracking",
    "cross-functional collaboration",
    "customer service",
    "standard operating procedures (sops)",
    "stakeholder communication",
    "microsoft office / google workspace",
  ],
  projects: [
    "Office relocation project — zero missed client-deliverable days",
    "POS-system rollout across 6 retail outlets — cut scheduling conflicts 40%",
    "Company-wide SOP manual — first standardized operating procedures adopted org-wide",
  ],
  certifications: [
    "Certified Associate in Project Management (CAPM) — Project Management Institute",
    "Lean Six Sigma Yellow Belt Certification",
  ],
};

/**
 * `business-boardroom` persona — a C-suite/executive-track operator,
 * distinct from `clean-professional`'s generalist above (breadth without
 * seniority) and from `business-memo`'s mid-level operations manager
 * (BUSINESS_OPERATIONS_MANAGER_RESUME, batch 2): this is P&L ownership and
 * board-facing leadership. `structure_schema` leads with `skills` and
 * `certifications` before the narrative, matching an executive reader who
 * checks credentials first.
 */
export const CHIEF_OPERATING_OFFICER_RESUME: StructuredResume = {
  contact: {
    name: "Temitope Osagie",
    email: "temitope.osagie@stratumholdings.com",
    phone: "+234 803 662 1198",
    location: "Lagos, Nigeria",
  },
  summary:
    "Chief operating officer with twelve years leading business-unit strategy, P&L ownership and organisational transformation for diversified conglomerates across Nigeria's manufacturing and consumer-goods sectors.",
  experience: [
    {
      title: "Chief Operating Officer",
      company: "Stratum Holdings Group",
      location: "Lagos, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Own P&L and operating strategy for a ₦45B-revenue conglomerate spanning manufacturing, distribution and retail, leading a leadership team of 9 direct reports across 4 business units. Drove a company-wide restructuring that improved consolidated EBITDA margin from 11% to 16% within two years while cutting corporate overhead by ₦600M annually.",
    },
    {
      title: "General Manager",
      company: "Bright Path Manufacturing Ltd",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2021",
      description:
        "Ran full operations for a 500-employee manufacturing subsidiary, turning around a loss-making plant to profitability within 18 months by renegotiating supplier contracts and cutting production downtime 30%.",
    },
    {
      title: "Senior Manager, Strategy & Business Development",
      company: "Coastal Consumer Brands",
      location: "Lagos, Nigeria",
      startDate: "2013",
      endDate: "2017",
      description:
        "Led market-entry strategy for 3 new product categories, growing category revenue from ₦0 to ₦2.1B within three years.",
    },
  ],
  education: [
    { school: "Delta State University", degree: "B.Sc.", field: "Business Management", startDate: "2005", endDate: "2009" },
    { school: "Lagos Business School, Pan-Atlantic University", degree: "Executive MBA", field: "General Management", startDate: "2016", endDate: "2018" },
  ],
  skills: [
    "strategic planning",
    "p&l management",
    "business transformation",
    "organisational leadership",
    "stakeholder & board management",
    "mergers & market-entry strategy",
    "operational efficiency",
    "change management",
    "cross-industry general management",
    "budget & financial oversight",
  ],
  certifications: [
    "Advanced Management Program — INSEAD",
    "Certified Professional in Strategic Planning — Association for Strategic Planning (ASP)",
  ],
  projects: [
    "Company-wide restructuring — lifted consolidated EBITDA margin from 11% to 16%, cut overhead ₦600M/yr",
    "Manufacturing subsidiary turnaround — returned to profitability in 18 months, cut downtime 30%",
    "New-category market-entry strategy — grew revenue from ₦0 to ₦2.1B in three years",
  ],
};

/**
 * `curriculum-vitae` persona — an early/mid-career university lecturer.
 * Free tier. Education-first per `structure_schema`, with a `publications`
 * section every academic persona in this batch populates. Real Nigerian
 * universities for the DEGREES SHE HOLDS (matching this file's established
 * convention); the EMPLOYER she teaches at is fictional, same as every
 * company employer elsewhere in this registry.
 */
export const MICROBIOLOGY_LECTURER_RESUME: StructuredResume = {
  contact: {
    name: "Folashade Ogunleye",
    email: "folashade.ogunleye@crestlandsu.edu.ng",
    phone: "+234 705 668 2214",
    location: "Osogbo, Nigeria",
  },
  summary:
    "Microbiology lecturer with six years teaching undergraduate life-sciences courses and running an active research programme in environmental microbiology at a Nigerian state university.",
  experience: [
    {
      title: "Lecturer I, Department of Microbiology",
      company: "Crestland State University",
      location: "Osogbo, Nigeria",
      startDate: "2021",
      endDate: "Present",
      description:
        "Teach four undergraduate courses a semester — Microbial Genetics, Environmental Microbiology, and General Microbiology I & II — to cohorts of 80-150 students, and supervise 6 final-year research projects a year. Redesigned the Environmental Microbiology lab manual, cutting practical-session setup time by 30% and raising average practical-exam scores from 58% to 74%.",
    },
    {
      title: "Assistant Lecturer, Department of Microbiology",
      company: "Crestland State University",
      location: "Osogbo, Nigeria",
      startDate: "2019",
      endDate: "2021",
      description:
        "Delivered tutorials and laboratory sessions for 200+ first- and second-year students, and coordinated the department's annual research symposium for two consecutive years.",
    },
    {
      title: "Graduate Assistant, Department of Microbiology",
      company: "Baywood State University",
      location: "Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Assisted with practical-class supervision and marking for introductory microbiology courses while completing postgraduate studies.",
    },
  ],
  education: [
    { school: "University of Ibadan", degree: "PhD", field: "Microbiology", startDate: "2017", endDate: "2021" },
    { school: "Federal University Oye-Ekiti", degree: "M.Sc.", field: "Microbiology", startDate: "2013", endDate: "2015" },
    { school: "Ekiti State University", degree: "B.Sc.", field: "Microbiology", startDate: "2009", endDate: "2013" },
  ],
  skills: [
    "microbial genetics",
    "environmental microbiology",
    "laboratory techniques & safety",
    "curriculum development",
    "undergraduate teaching",
    "research supervision",
    "scientific writing",
    "data analysis (spss/r)",
    "grant proposal writing",
  ],
  projects: [
    "Environmental Microbiology lab manual redesign — cut setup time 30%, raised practical scores from 58% to 74%",
    "Departmental annual research symposium coordination — two consecutive years",
    "Peri-urban water microbial resistance study — published in a national microbiology journal",
  ],
  certifications: [
    "Associate Fellowship, Higher Education Academy (Advance HE) — University Teaching and Learning",
    "Biosafety and Biosecurity Training Certificate — WHO e-Learning Programme",
  ],
  publications: [
    "Ogunleye, F. et al. (2022). 'Antibiotic Resistance Patterns in Environmental Isolates from Peri-Urban Water Sources in Southwest Nigeria.' Nigerian Journal of Microbiology, 36(2).",
    "Ogunleye, F., & Adisa, T. (2020). 'Microbial Load Assessment of Sachet Water Sold in Osogbo Metropolis.' African Journal of Environmental Science and Technology, 14(4).",
  ],
};

/**
 * `lecture-notes` persona — a senior academic (associate professor) with a
 * long appointment history and funded grants, distinct from
 * `curriculum-vitae`'s early-career lecturer above: dense, many appointments,
 * `awards` populated (labeled "Honours & Grants" by `structure_schema`).
 */
export const ENGINEERING_ASSOCIATE_PROFESSOR_RESUME: StructuredResume = {
  contact: {
    name: "Ikechukwu Madu",
    email: "ikechukwu.madu@crownhillut.edu.ng",
    phone: "+234 807 214 6690",
    location: "Akure, Nigeria",
  },
  summary:
    "Associate professor of mechanical engineering with over fifteen years of academic appointments spanning lecturing, postgraduate supervision and funded research in thermofluids and renewable-energy systems.",
  experience: [
    {
      title: "Associate Professor, Department of Mechanical Engineering",
      company: "Crownhill University of Technology",
      location: "Akure, Nigeria",
      startDate: "2020",
      endDate: "Present",
      description:
        "Lead the Thermofluids Research Group, supervising 5 PhD and 12 MSc students, and teach postgraduate Heat Transfer and Renewable Energy Systems courses. Secured a ₦38M TETFund National Research Fund grant for a solar-thermal drying research programme, the department's largest single grant in a decade.",
    },
    {
      title: "Senior Lecturer, Department of Mechanical Engineering",
      company: "Crownhill University of Technology",
      location: "Akure, Nigeria",
      startDate: "2015",
      endDate: "2020",
      description:
        "Taught undergraduate Thermodynamics and Fluid Mechanics to cohorts of 100+, and established the department's first solar-energy testing laboratory, used by every final-year project since.",
    },
    {
      title: "Lecturer I, Department of Mechanical Engineering",
      company: "Baymount Polytechnic",
      location: "Ondo State, Nigeria",
      startDate: "2010",
      endDate: "2015",
      description:
        "Taught technical drawing and manufacturing processes to ND/HND students, and coordinated final-year industrial-attachment placements for 150+ students across 3 cohorts.",
    },
  ],
  education: [
    { school: "Obafemi Awolowo University", degree: "PhD", field: "Mechanical Engineering", startDate: "2006", endDate: "2010" },
    { school: "Obafemi Awolowo University", degree: "M.Eng.", field: "Mechanical Engineering (Thermofluids)", startDate: "2003", endDate: "2005" },
    { school: "Federal University of Technology, Akure", degree: "B.Eng.", field: "Mechanical Engineering", startDate: "1998", endDate: "2003" },
  ],
  skills: [
    "thermofluids & heat transfer",
    "renewable energy systems",
    "postgraduate supervision",
    "curriculum & course development",
    "research grant management",
    "engineering laboratory development",
    "cad/simulation tools (ansys/solidworks)",
    "technical writing & publication",
    "academic leadership",
  ],
  awards: [
    "₦38M TETFund National Research Fund Grant — Solar-Thermal Drying Research Programme (Principal Investigator), 2021",
    "Faculty Best Postgraduate Supervisor Award — Crownhill University of Technology, 2019",
  ],
  projects: [
    "Solar-thermal drying research programme — secured ₦38M grant, the largest in the department in a decade",
    "Department's first solar-energy testing laboratory — used by every final-year project since founding",
    "PhD/MSc supervision programme — 5 PhD and 12 MSc students under active supervision",
  ],
  certifications: [
    "Six Sigma Black Belt Certification",
    "Certificate in Engineering Education — International Federation of Engineering Education Societies (IFEES)",
  ],
  publications: [
    "Madu, I. et al. (2020). 'Solar-Thermal Drying Kinetics for Tropical Agricultural Produce.' Journal of Renewable Energy Systems (West Africa), 12(3).",
    "Madu, I., & Afolabi, K. (2016). 'Thermofluid Performance Analysis of Low-Cost Solar Collectors.' Nigerian Journal of Mechanical Engineering Research, 9(1).",
  ],
};

/**
 * `faculty-profile` persona — a full professor and faculty dean, the most
 * senior academic in this batch. Sidebar-left: `skills`, `languages` and
 * `certifications` sit in the sidebar (populated below), main column carries
 * education/experience/publications/awards/projects.
 */
export const ECONOMICS_FACULTY_DEAN_RESUME: StructuredResume = {
  contact: {
    name: "Oluwatosin Adebisi",
    email: "oluwatosin.adebisi@ashfordfu.edu.ng",
    phone: "+234 806 774 3315",
    location: "Jos, Nigeria",
  },
  summary:
    "Professor of economics and faculty dean with over twenty years of academic leadership, postgraduate supervision and applied development-economics research across Nigerian universities.",
  experience: [
    {
      title: "Professor & Dean, Faculty of Social Sciences",
      company: "Ashford Federal University",
      location: "Jos, Nigeria",
      startDate: "2019",
      endDate: "Present",
      description:
        "Lead a faculty of 6 departments and 85 academic staff, overseeing curriculum review and postgraduate programme growth. Secured full accreditation renewal for 2 previously-probationary postgraduate programmes, and grew faculty postgraduate enrolment by 40% over three years.",
    },
    {
      title: "Associate Professor, Department of Economics",
      company: "Ashford Federal University",
      location: "Jos, Nigeria",
      startDate: "2013",
      endDate: "2019",
      description:
        "Taught postgraduate Development Economics and supervised 14 PhD students to completion, and led a World Bank-funded research project on rural financial inclusion across 3 northern states reaching 12,000 survey respondents.",
    },
    {
      title: "Senior Lecturer, Department of Economics",
      company: "Ashford Federal University",
      location: "Jos, Nigeria",
      startDate: "2008",
      endDate: "2013",
      description:
        "Published extensively on informal-sector taxation and coordinated the department's undergraduate research-methods course for 6 consecutive years.",
    },
  ],
  education: [
    { school: "University of Leeds", degree: "PhD", field: "Development Economics", startDate: "1998", endDate: "2002" },
    { school: "University of Ibadan", degree: "M.Sc.", field: "Economics", startDate: "1993", endDate: "1995" },
    { school: "University of Jos", degree: "B.Sc.", field: "Economics", startDate: "1988", endDate: "1992" },
  ],
  skills: [
    "development economics",
    "econometrics (stata/eviews)",
    "curriculum & accreditation management",
    "postgraduate supervision",
    "grant & research management",
    "policy analysis",
    "academic leadership",
    "public speaking & keynote presentation",
    "faculty administration",
  ],
  languages: [
    { name: "English", level: "Native" },
    { name: "Hausa", level: "Conversational" },
    { name: "French", level: "Professional working proficiency" },
  ],
  certifications: [
    "Leadership in Higher Education Certificate — Association of African Universities (AAU) Leadership Programme",
    "Certificate in Research Grant Management — INASP/AuthorAID Training",
  ],
  awards: [
    "World Bank Research Grant — Rural Financial Inclusion Study (Principal Investigator), 2015",
    "Best Faculty Researcher Award — Ashford Federal University, 2018",
  ],
  projects: [
    "World Bank rural financial inclusion research project — surveyed 12,000 respondents across 3 states",
    "Postgraduate programme accreditation renewal — 2 programmes brought to full standing",
    "Faculty postgraduate enrolment growth initiative — 40% increase over three years",
  ],
  publications: [
    "Adebisi, O. (2021). 'Rural Financial Inclusion and Informal Credit Markets in Northern Nigeria.' Journal of African Development Economics, 29(1).",
    "Adebisi, O., & Yakassai, H. (2017). 'Taxing the Informal Sector: Evidence from Three Nigerian States.' West African Economic Review, 22(3).",
  ],
};

/**
 * `research-record` persona — a research fellow with a chronological
 * research-institute career (labeled "Research Positions" by
 * `structure_schema`), distinct from the three teaching-track academics
 * above: no classroom teaching, a research institute rather than a
 * university, and no `awards`/`languages` fields (this slug's schema
 * doesn't include them).
 */
export const RENEWABLE_ENERGY_RESEARCH_FELLOW_RESUME: StructuredResume = {
  contact: {
    name: "Chinonso Okeke",
    email: "chinonso.okeke@sunridge-renewables.org",
    phone: "+234 803 219 6647",
    location: "Owerri, Nigeria",
  },
  summary:
    "Research fellow with nine years running applied research on solar mini-grid performance and rural electrification across Nigeria, publishing widely and securing multi-year donor and government research funding.",
  experience: [
    {
      title: "Senior Research Fellow",
      company: "Sunridge Renewable Energy Research Institute",
      location: "Owerri, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Lead a 6-person research team studying solar mini-grid performance degradation across 40 rural installations in the South-East, publishing findings that informed a national rural-electrification funding review. Secured a $650,000 multi-year grant from a bilateral development partner to extend the monitoring programme to 100 sites.",
    },
    {
      title: "Research Fellow",
      company: "Sunridge Renewable Energy Research Institute",
      location: "Owerri, Nigeria",
      startDate: "2018",
      endDate: "2022",
      description:
        "Ran field performance studies on 25 solar mini-grid sites, building the institute's first standardized performance-monitoring protocol, later adopted by 2 partner research institutes.",
    },
    {
      title: "Postdoctoral Research Associate",
      company: "Sunridge Renewable Energy Research Institute",
      location: "Owerri, Nigeria",
      startDate: "2016",
      endDate: "2018",
      description:
        "Conducted laboratory testing of photovoltaic panel degradation under tropical humidity conditions, contributing to 4 peer-reviewed publications.",
    },
  ],
  education: [
    { school: "University of Nigeria, Nsukka", degree: "PhD", field: "Renewable Energy Engineering", startDate: "2012", endDate: "2016" },
    { school: "Imo State University", degree: "M.Sc.", field: "Physics", startDate: "2009", endDate: "2011" },
    { school: "Imo State University", degree: "B.Sc.", field: "Physics", startDate: "2005", endDate: "2009" },
  ],
  skills: [
    "renewable energy systems research",
    "solar mini-grid performance analysis",
    "field data collection & monitoring",
    "grant & donor reporting",
    "statistical analysis (r/python)",
    "photovoltaic testing",
    "scientific writing",
    "research team leadership",
    "rural electrification policy",
  ],
  projects: [
    "40-site solar mini-grid performance study — informed national rural-electrification funding review",
    "Standardized performance-monitoring protocol — adopted by 2 partner research institutes",
    "$650,000 multi-year monitoring-programme grant — extended coverage to 100 sites",
  ],
  certifications: [
    "Certified Energy Manager (CEM) — Association of Energy Engineers (AEE)",
    "Renewable Energy Project Management Certificate — REN21/UNIDO Training Programme",
  ],
  publications: [
    "Okeke, C. et al. (2023). 'Performance Degradation of Solar Mini-Grids in Humid Tropical Climates: A 40-Site Study.' Renewable Energy Journal of West Africa, 8(2).",
    "Okeke, C., & Nnadi, F. (2019). 'Standardizing Field Performance Monitoring for Rural Solar Mini-Grids.' Journal of Sustainable Energy Systems, 11(1).",
  ],
};

/**
 * `funnel` persona — a growth/digital marketing manager running
 * lead-generation funnels, distinct from `pipeline`'s quota-carrying sales
 * executive and `pitch-deck`'s brand-campaign manager below: this is
 * paid-acquisition and conversion-funnel ownership, not account sales or
 * brand campaigns. Free tier. `structure_schema` includes `languages`,
 * populated below.
 */
export const GROWTH_MARKETING_MANAGER_RESUME: StructuredResume = {
  contact: {
    name: "Damilola Ajala",
    email: "damilola.ajala@growthlanegroup.com",
    phone: "+234 810 337 2261",
    location: "Lagos, Nigeria",
  },
  summary:
    "Growth marketing manager with seven years building and optimizing digital lead-generation funnels for consumer fintech and e-commerce brands across Nigeria.",
  experience: [
    {
      title: "Growth Marketing Manager",
      company: "GrowthLane Digital Group",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Own the full-funnel marketing strategy for a fintech app with 300,000+ downloads, managing a ₦80M annual paid-acquisition budget across Meta, Google and TikTok. Rebuilt the onboarding funnel with Product, cutting cost-per-activated-user by 42% while growing monthly activated users from 8,000 to 19,000.",
    },
    {
      title: "Digital Marketing Specialist",
      company: "GrowthLane Digital Group",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Ran acquisition and retargeting campaigns for 5 e-commerce clients, and built the attribution dashboard that reduced wasted ad spend by 25% across the client portfolio.",
    },
    {
      title: "Marketing Executive",
      company: "Palmgrove Retail Ltd",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Managed email and SMS lifecycle campaigns for a multi-store retail chain, lifting repeat-purchase rate from 18% to 27% over one year.",
    },
  ],
  education: [
    { school: "Babcock University", degree: "B.Sc.", field: "Mass Communication", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "full-funnel marketing strategy",
    "paid acquisition (meta/google/tiktok ads)",
    "conversion rate optimization",
    "marketing analytics",
    "lifecycle & retention marketing",
    "seo/sem",
    "a/b testing",
    "budget management",
    "attribution modeling",
  ],
  languages: [
    { name: "English", level: "Fluent" },
    { name: "Yoruba", level: "Native" },
    { name: "French", level: "Basic" },
  ],
  certifications: ["Google Ads Certification", "HubSpot Inbound Marketing Certification"],
  projects: [
    "Fintech app onboarding funnel rebuild — cut cost-per-activated-user 42%, grew monthly activations from 8,000 to 19,000",
    "Cross-client attribution dashboard — cut wasted ad spend 25% across 5 e-commerce clients",
    "Retail lifecycle email/SMS programme — lifted repeat-purchase rate from 18% to 27%",
  ],
};

/**
 * `pipeline` persona — an enterprise B2B account executive carrying a
 * sales quota. `pipeline` is the one slug in this batch with NO skeleton
 * `structure_schema` (it's a pre-PR2 bespoke component, `PipelineTemplate`
 * in `templates/pipeline.tsx`, not a config-driven skeleton) — this persona
 * was matched against that component directly: its hardcoded "Track
 * Record"/"Campaigns & Accounts" labels and top-of-page scannable skills
 * line are why this content leads with quota numbers and named account
 * wins rather than a narrative-first summary.
 */
export const ENTERPRISE_ACCOUNT_EXECUTIVE_RESUME: StructuredResume = {
  contact: {
    name: "Kelechi Nwosu",
    email: "kelechi.nwosu@crestlinebiz.com",
    phone: "+234 802 774 1156",
    location: "Lagos, Nigeria",
  },
  summary:
    "Enterprise B2B sales executive with eight years carrying and consistently exceeding multi-million-naira quotas for SaaS and business-services accounts across Nigeria's mid-market and enterprise segments.",
  experience: [
    {
      title: "Senior Account Executive",
      company: "Crestline Business Solutions",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Own a ₦450M annual quota across 30 enterprise accounts in banking and telecoms, closing 118% of quota in FY2024 and growing the territory's average deal size from ₦8M to ₦14M. Built the account-expansion playbook now used by the entire enterprise sales team.",
    },
    {
      title: "Account Executive",
      company: "Crestline Business Solutions",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Carried a ₦180M quota across a 45-account mid-market book, achieving 105% average quota attainment across three consecutive years and cutting sales-cycle length from 90 to 62 days.",
    },
    {
      title: "Sales Development Representative",
      company: "Vantage Business Systems",
      location: "Lagos, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Generated and qualified outbound pipeline for the enterprise sales team, converting 32% of qualified leads to closed-won deals against a team average of 21%.",
    },
  ],
  education: [
    { school: "Nasarawa State University, Keffi", degree: "B.Sc.", field: "Marketing", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "enterprise account management",
    "quota attainment & forecasting",
    "solution selling",
    "contract negotiation",
    "pipeline management (salesforce/hubspot)",
    "stakeholder & c-suite selling",
    "territory planning",
    "sales-cycle optimization",
  ],
  certifications: ["Salesforce Certified Sales Cloud Consultant", "Miller Heiman Strategic Selling Certification"],
  projects: [
    "Enterprise banking account expansion — grew average deal size from ₦8M to ₦14M",
    "Account-expansion playbook — adopted team-wide across enterprise sales",
    "Outbound qualification programme — lifted lead-to-close conversion from 21% to 32% team average",
  ],
};

/**
 * `pitch-deck` persona — a brand/campaign marketing manager, distinct from
 * `funnel`'s digital-acquisition register and `pipeline`'s account-sales
 * register: this is integrated brand campaigns across traditional and
 * digital media. Header-band with `showLinksInHeader: true`, so this
 * persona populates `links` alongside `product-tech`/`stack-trace`.
 */
export const BRAND_CAMPAIGN_MANAGER_RESUME: StructuredResume = {
  contact: {
    name: "Zainab Lawal",
    email: "zainab.lawal@brandforgestudio.com",
    phone: "+234 815 226 7743",
    location: "Abuja, Nigeria",
  },
  summary:
    "Brand and campaign marketing manager with seven years building integrated marketing campaigns for consumer brands across Nigeria, from concept through paid media and measurable market results.",
  experience: [
    {
      title: "Senior Campaign Manager",
      company: "Brandforge Studio",
      location: "Abuja, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Lead integrated campaign strategy for 4 consumer-goods clients, managing a combined ₦150M annual media budget across TV, radio, digital and OOH. Delivered a national beverage-launch campaign that lifted brand awareness from 12% to 34% in its target market within 6 months.",
    },
    {
      title: "Campaign Manager",
      company: "Brandforge Studio",
      location: "Abuja, Nigeria",
      startDate: "2019",
      endDate: "2022",
      description:
        "Managed end-to-end campaign delivery for 6 mid-size brand clients a year, and built the agency's first post-campaign ROI reporting template, adopted across the account team.",
    },
    {
      title: "Marketing Coordinator",
      company: "Northstar Consumer Brands",
      location: "Abuja, Nigeria",
      startDate: "2017",
      endDate: "2019",
      description:
        "Coordinated regional activation events and influencer partnerships for a personal-care brand, growing social engagement 3x over 18 months.",
    },
  ],
  education: [
    { school: "Baze University, Abuja", degree: "B.Sc.", field: "Mass Communication", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "integrated campaign strategy",
    "media planning & buying",
    "brand positioning",
    "influencer & partnerships marketing",
    "campaign roi analysis",
    "cross-channel marketing (tv/radio/digital/ooh)",
    "stakeholder & client management",
    "creative brief development",
  ],
  certifications: ["Meta Certified Digital Marketing Associate", "Google Analytics Individual Qualification (IQ)"],
  projects: [
    "National beverage-launch campaign — lifted brand awareness from 12% to 34% in 6 months",
    "Post-campaign ROI reporting template — adopted agency-wide",
    "Personal-care brand activation & influencer programme — 3x social engagement growth",
  ],
  links: [
    { label: "Portfolio", url: "https://zainablawal-campaigns.com" },
    { label: "LinkedIn", url: "https://linkedin.com/in/zainablawal" },
  ],
};

/**
 * `terminal` persona — a DevOps/site reliability engineer. Free tier.
 * Distinct from `product-tech`'s backend/full-stack register (batch 2) and
 * `stack-trace`'s mobile-engineer register below: infrastructure, CI/CD and
 * incident response, not application code.
 */
export const DEVOPS_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "Tobenna Igwe",
    email: "tobenna.igwe@ironcladcloud.dev",
    phone: "+234 809 552 3317",
    location: "Lagos, Nigeria",
  },
  summary:
    "DevOps and site reliability engineer with six years running infrastructure and deployment pipelines for high-traffic Nigerian consumer platforms, focused on uptime, automation and incident response.",
  experience: [
    {
      title: "Senior DevOps Engineer",
      company: "Ironclad Cloud Systems",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Own infrastructure and CI/CD for a ride-hailing platform serving 200,000+ daily active riders, managing a Kubernetes cluster across 3 availability zones. Cut deployment failure rate from 8% to under 1% by rebuilding the CI/CD pipeline with automated canary releases, and reduced mean-time-to-recovery from 45 minutes to 9.",
    },
    {
      title: "DevOps Engineer",
      company: "Ironclad Cloud Systems",
      location: "Lagos, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description:
        "Migrated a monolithic deployment process to containerized microservices on AWS, cutting infrastructure costs by 30% through right-sizing and spot-instance adoption.",
    },
    {
      title: "Systems Administrator",
      company: "Nimbus Cloud Hosting",
      location: "Lagos, Nigeria",
      startDate: "2018",
      endDate: "2020",
      description:
        "Managed Linux server infrastructure for 200+ shared-hosting clients, and automated the backup-verification process, eliminating a recurring class of silent backup failures.",
    },
  ],
  education: [
    { school: "Ladoke Akintola University of Technology", degree: "B.Sc.", field: "Computer Science", startDate: "2012", endDate: "2016" },
  ],
  skills: [
    "kubernetes",
    "docker",
    "terraform",
    "aws",
    "ci/cd pipelines (github actions/jenkins)",
    "linux systems administration",
    "prometheus & grafana monitoring",
    "bash/python scripting",
    "incident response",
  ],
  certifications: ["AWS Certified DevOps Engineer – Professional", "Certified Kubernetes Security Specialist (CKS)"],
  projects: [
    "CI/CD pipeline rebuild — cut deployment failure rate from 8% to under 1%, MTTR from 45 to 9 minutes",
    "Monolith-to-microservices migration on AWS — cut infrastructure costs 30%",
    "Automated backup-verification system — eliminated recurring silent backup failures",
  ],
};

/**
 * `stack-trace` persona — a mobile engineer (Android/cross-platform).
 * Grid-modules, projects-first — per this batch's own guidance, a
 * project-first layout needs strong named projects, so this persona's
 * `projects` list carries three specific, named, quantified shipped apps.
 * `showLinksInHeader: true`, so `links` is populated alongside
 * `product-tech`/`pitch-deck`.
 */
export const MOBILE_ENGINEER_RESUME: StructuredResume = {
  contact: {
    name: "Precious Danjuma",
    email: "precious.danjuma@orbitmobileworks.dev",
    phone: "+234 706 118 5527",
    location: "Abuja, Nigeria",
  },
  summary:
    "Mobile engineer with six years shipping consumer Android and cross-platform apps for Nigerian fintech and logistics startups, from zero-to-launch builds to scaling apps past a million installs.",
  experience: [
    {
      title: "Senior Mobile Engineer",
      company: "Orbit Mobile Works",
      location: "Abuja, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Lead Android development for a savings and investment app with 1.2M installs, rebuilding the app's core navigation and state layer in Kotlin/Jetpack Compose. Cut app crash rate from 2.1% to 0.3% and reduced cold-start time from 3.8s to 1.4s.",
    },
    {
      title: "Mobile Engineer",
      company: "Orbit Mobile Works",
      location: "Abuja, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description:
        "Built the initial Android and iOS (React Native) versions of a last-mile delivery-tracking app from scratch, taking it from zero to 80,000 installs in its first year.",
    },
    {
      title: "Junior Android Developer",
      company: "Fastlink Technologies",
      location: "Abuja, Nigeria",
      startDate: "2018",
      endDate: "2020",
      description:
        "Maintained and shipped features for a USSD-to-app migration project, supporting the release of 12 feature updates across 18 months.",
    },
  ],
  education: [
    { school: "Veritas University, Abuja", degree: "B.Sc.", field: "Computer Science", startDate: "2013", endDate: "2017" },
  ],
  skills: [
    "kotlin & jetpack compose",
    "android sdk",
    "react native",
    "swift (ios basics)",
    "rest/graphql api integration",
    "ci/cd for mobile (fastlane/bitrise)",
    "performance profiling & crash analytics",
    "agile/scrum",
  ],
  certifications: ["Associate Android Developer Certification — Google", "Meta React Native Specialist Certificate"],
  projects: [
    "Savings app Android rebuild (Kotlin/Compose) — cut crash rate from 2.1% to 0.3%, cold start from 3.8s to 1.4s",
    "Last-mile delivery-tracking app — built from zero to 80,000 installs in year one",
    "USSD-to-app migration programme — shipped 12 feature releases across 18 months",
  ],
  links: [
    { label: "GitHub", url: "https://github.com/preciousdanjuma" },
    { label: "Play Store", url: "https://play.google.com/store/apps/dev?id=preciousdanjuma" },
  ],
};

/**
 * The registry every consumer now matches against — see this file's
 * top-of-file header. Order is not meaningful for matching (every
 * comparison in example-guard.ts is `.some(...)` across the whole array),
 * but PREVIEW_SAMPLE_RESUME stays first because it is also the FALLBACK
 * persona-for-slug.ts returns for every slug without a dedicated entry —
 * the pre-existing, already-shipped behavior for those slugs. 36 entries as
 * of this pass (batch 3A): the 22 from batches 1-2, plus 14 new personas
 * across 5 categories (Administration, Business, Education & Academia,
 * Sales & Marketing, Technology) — see this file's top-of-file header for
 * why these 5 and why now.
 */
export const EXAMPLE_PERSONAS: readonly StructuredResume[] = [
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  CONSTRUCTION_FOREMAN_RESUME,
  STRUCTURAL_DESIGN_ENGINEER_RESUME,
  ELECTRICAL_DESIGN_ENGINEER_RESUME,
  LAND_SURVEYOR_RESUME,
  GEOTECHNICAL_ENGINEER_RESUME,
  REAL_ESTATE_DEVELOPMENT_MANAGER_RESUME,
  DRILLING_RIG_SUPERVISOR_RESUME,
  OFFSHORE_PROCESS_ENGINEER_RESUME,
  WELLHEAD_COMPLETIONS_ENGINEER_RESUME,
  IMPACT_REPORTING_OFFICER_RESUME,
  GRANTS_PROPOSAL_OFFICER_RESUME,
  COMMERCIAL_AGRONOMIST_RESUME,
  FIELD_PRODUCTION_SUPERVISOR_RESUME,
  VALUE_CHAIN_ANALYST_RESUME,
  SOFTWARE_ENGINEER_RESUME,
  CREDIT_RISK_ANALYST_RESUME,
  REGISTERED_NURSE_RESUME,
  CORPORATE_LEGAL_ASSOCIATE_RESUME,
  BUSINESS_OPERATIONS_MANAGER_RESUME,
  EXECUTIVE_ADMINISTRATIVE_ASSISTANT_RESUME,
  FRONT_OFFICE_MANAGER_RESUME,
  RECORDS_DOCUMENTATION_OFFICER_RESUME,
  BUSINESS_GENERALIST_RESUME,
  CHIEF_OPERATING_OFFICER_RESUME,
  MICROBIOLOGY_LECTURER_RESUME,
  ENGINEERING_ASSOCIATE_PROFESSOR_RESUME,
  ECONOMICS_FACULTY_DEAN_RESUME,
  RENEWABLE_ENERGY_RESEARCH_FELLOW_RESUME,
  GROWTH_MARKETING_MANAGER_RESUME,
  ENTERPRISE_ACCOUNT_EXECUTIVE_RESUME,
  BRAND_CAMPAIGN_MANAGER_RESUME,
  DEVOPS_ENGINEER_RESUME,
  MOBILE_ENGINEER_RESUME,
];
