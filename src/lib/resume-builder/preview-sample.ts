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
 * The registry every consumer now matches against — see this file's
 * top-of-file header. Order is not meaningful for matching (every
 * comparison in example-guard.ts is `.some(...)` across the whole array),
 * but PREVIEW_SAMPLE_RESUME stays first because it is also the FALLBACK
 * persona-for-slug.ts returns for every slug without a dedicated entry —
 * the pre-existing, already-shipped behavior for those slugs. 12 entries as
 * of this pass: the original 3, plus the 9 new Engineering/Construction/Oil
 * & Gas personas that replaced that grouping's single shared persona.
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
];
