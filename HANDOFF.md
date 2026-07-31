# CAMPUS — Master Handoff & Continuity Document

This document is the single source of truth for the Campus project. It exists so any new
chat, collaborator, or future-you can pick up with FULL context — nothing lost. Read it
top to bottom once. Companion files: `CLAUDE.md` (build rules) and `SPEC.md` (product +
schema). This file is the "everything else": the story, the decisions, the strategy, the
stack, and exactly what to do next.

If you're starting a fresh Claude chat: paste this file (or add it to a Project) plus
CLAUDE.md and SPEC.md, and the new chat will be as informed as the original.

---

## PART A — WHAT THIS IS AND WHY

### The product in one line
A mobile-first campus platform for Indian colleges — students on phones, professors and
admins on laptops — that is genuinely calm, warm, and pleasant to use, unlike the legacy
Indian college ERPs (JUNO, Camu, etc.) that people tolerate but never love.

### The origin
The founder studied in India (fragmented mess: professors each used Google Forms /
Classroom / Dropbox / WhatsApp, students had to track everything themselves), then did an
MS at UF in the US and saw Canvas — one platform, every course, everything in one place —
and asked "why doesn't India have this?" That question is the whole company.

### The honest market read (internalize this — it's the strategy)
- **It is NOT a novel category.** Campus software for Indian colleges exists, many times
  over (JUNO, Camu, KSSBM, Vidyalaya, CollPoll, Serosoft, MasterSoft, NMIMS's app, etc.).
  Do NOT believe "I'm first." That belief is dangerous.
- **BUT no one has done it WELL.** Every incumbent is an administrator's compliance tool
  that students and teachers endure. None is calm, crafted, student-first, or loved. That
  gap is real and it is the entire opening.
- **Why the incumbents can't fill it:** they were built by enterprise companies selling to
  registrars (wrong builders, wrong customer focus), pushed toward 40-module breadth
  instead of craft, and never attracted the design talent that went to consumer startups.
  The founder — an ex-student and ex-grader building student/teacher-first, solo, in the
  AI era — occupies a vantage point that barely existed until now.
- **This is a "graveyard" market** in the specific sense that many well-funded teams tried
  and most failed. The killing mechanism: the buyer (colleges) is slow and stingy, the
  free alternative (WhatsApp + Google) is unbeatable on price, contracts are small, and
  RETENTION is brutally hard. Funded companies burned cash before the flywheel engaged, or
  landed customers who churned. Teachmint raised $100M+, got a million teachers, and had to
  pivot to survive.
- **Why the founder can win where they died:** (1) near-zero cost via AI tooling + no
  investors demanding hypergrowth = can be patient in a market that punishes impatience;
  (2) student/teacher-first craft = the app gets LOVED = retention, the thing that killed
  others; (3) warm distribution — starts INSIDE Mahindra University with trusting
  professors, in a dense city (Hyderabad) where references travel; (4) discipline —
  retention before scaling; (5) timing — NEP/NAAC digital-records pressure is appearing,
  AI collapsed build cost, and the 2022 funding winter thinned the competition.
- **None of the winning differentiators is a feature.** The feature list is commoditized.
  The edge is patience + being loved + warm distribution + discipline + timing. The product
  being good is necessary but not the moat. Execution and distribution are the moat.

### Realistic outcome and ambition
- This is a "good idea, not a great one" — and that's fine; good-idea-plus-execution is the
  normal path to a real business. It is NOT a unicorn play. Realistic outcome: a patient,
  profitable, unglamorous B2B company (think ₹10–50 Cr/year at scale over 5–8 years), or an
  acquihire. If that outcome sounds good, proceed. If you need it to be the next Zomato,
  recalibrate.
- **Strategy: beachhead, then expand.** Own Hyderabad's colleges completely (founder-led,
  college-by-college), THEN Bangalore, then wider. Later, schools are a second act (different
  buyer, different features, no placements — the role system is architected to allow it, but
  don't build it now). Hold "sell to the whole country" as the motivating dream; let "own my
  city, one retained college at a time" be the daily plan.
- **Money/pricing (for later, not now):** Enter cheap. A JUNO contract at REVA University
  (13,000 students, 2020) was ₹1.28 crore upfront + ~₹26 lakh/year AMC — real evidence that
  colleges DO spend. Canvas is ~₹25–60 lakh/year for a similar-size school (2–3x JUNO). So
  the founder's instinct to price affordably while the market spends real money is sound.
  Model: per-student/year, SaaS (not perpetual license), start low (₹3–5L/college) to ease
  adoption and drive references, grow accounts to ₹10–15L over years by stacking modules and
  proving outcomes. Anchor against Canvas's price at elite institutions ("the global standard
  is ₹40L+/year; we're a fraction of that, built for India"). Near-zero serving cost means
  the economics work at every scale. Do NOT hire ahead of revenue — headcount follows signed
  contracts. The graveyard died of cash burn; the founder's lack of funding is the
  loss-prevention system.

### The metric that decides everything
**Week-12 retention at the Mahindra pilot** — are students and professors still using it
without being nagged? Not signups. Everything (pricing, scale, schools, the whole thesis)
is theory until this is proven. A huge market you can't retain customers in is worth zero.

### Legal note (settled)
Building a Canvas-LIKE product is fine. Don't use their name/logo/trademarks, don't copy
their code (Canvas is AGPL open-source — never look at or copy it, or your product must be
open-sourced too), don't pixel-clone their exact design. Own name, own code, own design =
clear. Functional patterns (bottom bars, tabs, courses-with-assignments) are not
protectable. Drop the "Canvas for India" phrasing from public marketing once there's a
brand name. Instructure has zero incentive to notice a student LMS pilot in India.

---

## PART B — THE PRODUCT (fully designed, three roles)

The full spec + schema is in SPEC.md. This is the summary so the story is complete here.

### Three roles
- **student** — mobile-first PWA. Sees only their own data.
- **faculty (professor)** — desktop. Manages the courses (offerings) they teach.
- **admin** — desktop. Sets up the whole institution.
- (placement_officer — later; admin covers placements for now.)

### The core structural model (the thing to get right)
institution → departments, terms, courses (catalog), people (profiles).
A **course** ("CS301 Operating Systems") is a catalog entry.
A **course offering** = that course running in a specific term + section (CS301 · Monsoon
2026 · Section A). The offering is the unit with a professor, enrolled students, timetable,
assignments, attendance, teams. EVERYTHING hangs off the offering, never the bare course.
This course-vs-offering split is critical — skipping it breaks history when a 2nd term starts.

### STUDENT side (mobile)
- Bottom bar: **Home · Calendar · To-Do · Notifications · More**
- **Home** = scroll of course cards (code, name, professor, identity color as a left accent
  bar + colored code). Identity-only, no due counts. Design went through iterations; the
  winner was minimal white cards with a color-edge accent (NOT full-color blocks, NOT
  monogram tiles).
- **Calendar** = week-view Indian-style timetable, classes as hour blocks tinted by course
  color, room shown, "now" line. Tap a class → its course.
- **To-Do** = deadlines aggregated across courses, TIME-BUCKETED (Overdue / Today / This
  Week / Later). Only unfinished items. Warm empty state ("All caught up. Nothing pending" —
  do NOT tease the next upcoming assignment; keep it restful).
- **Notifications** = aggregated professor announcements, newest first, unread dot, read
  items quieter. Tap → course.
- **More** = profile, Attendance (aggregate), Placements, settings. NO fees.
- **Course detail** = tap a course → course-color-tinted header + VERTICAL LIST of sections
  (Canvas-mobile style, NOT top tabs): Info · Assignments · Announcements · Grades · Files ·
  Attendance · Teams. Each opens with a light course-color-tinted header (this tinting is an
  intentional "you're in a subsection" system) and a contextual back button ("← Operating
  Systems", never "Back").
  - Info: description, prof, office hours, credits, days/room, mark-split. Read-only.
  - Assignments: list with per-assignment state; tap → detail + submit.
  - Announcements: prof's posts.
  - Grades: own marks + anonymous class average & median per assessment. NO RANKING EVER.
    Only shows PUBLISHED grades.
  - Files: prof's materials (any type) + links, downloadable.
  - Attendance: this course's % + plain-language projection ("You can miss 3 more" / "Short
    by 2 — attend the next 5").
  - Teams: this course's team sets + join/leave.
- **Persistent submitted ✓**: after submitting, a quiet green ✓ persists everywhere that
  assignment appears (kills "did it go through?" anxiety).
- **Placements** (final-years, in More): browse drives (company, role, CTC, location,
  eligibility, deadline), auto-checked eligibility, Apply (opens company's external page),
  My Applications tracker (Applied → Shortlisted → Interview → Offer).

### PROFESSOR side (desktop)
- **Home**: warm greeting (NO workload tally like "22 submissions waiting on you"),
  color-coded course cards with actionable hints ("16 submissions to grade"), "Your Day"
  schedule with contextual actions. NO stat boxes.
- Tap a course → workspace with calm LEFT SIDEBAR (rust badge = needs attention, gray badge
  = neutral count). Sections: Course info · Assignments · Submissions · Announcements ·
  Files · Attendance · Teams · Roster. Lands on Assignments. NO "Overview" dashboard (that
  was designed then deliberately removed — metric dashboards clash with the calm feel).
- **Course info**: edit form; mark-split with live "= 100%".
- **Assignments**: table with state / submitted progress / grading status. Create/edit
  (see assignment object below). Extending a deadline auto-posts an announcement.
- **Submissions → SpeedGrader**: click a student → focused split screen. Left = submission
  rendered INLINE (PDF/image/text/link inline; zip/code → download). Right = marks +
  feedback + Save + Next/Previous (grade in a rhythm) + progress ("12 of 38 graded").
  Autosave ("saved · not published"). Keyboard shortcuts (arrows = next/prev, Enter = save).
  Team assignment → grade PER TEAM (one grade to all members).
- **Grade publishing**: grades are PRIVATE until released. States: Not graded → Graded
  (unpublished) → Published. "Publish all grades" releases all at once (so students find out
  together and the class avg/median is complete). Post-publish individual corrections go live
  immediately. (Rationale: prof grades over days, can adjust before anyone sees.)
- **Announcements**: posted list + compose. Appears instantly on student phones.
- **Files**: upload (any type) or add link; list + remove.
- **Attendance**: START A SESSION → rotating 6-digit code + QR to project (rotates ~60s,
  anti-proxy). Students enter/scan → auto-marked present; live roster fills. MANUAL OVERRIDE:
  prof can tap any student to mark present/absent (dead phone etc.) and toggle while session
  is open. End session locks it (unmarked = absent). Past sessions editable.
- **Teams**: manage MULTIPLE TEAM SETS per course (see below).
- **Roster**: enrolled students with attendance % + submission counts, read-only.

### TEAMS (multiple team sets per course) — important
A course can have multiple independent team sets, each for a different purpose ("Lab pairs"
size 2, "Term project" size 5, "Seminar groups" size 3).
- Each team set: name, min size, max size, own teams, own locked state, on/off visibility.
- Professor: create a set (name + min/max), view teams (Full / Under-minimum flags), Lock.
  At lock, if teams are under-min or students unassigned, show a SOFT warning naming them but
  ALLOW locking anyway (never hard-block — professor decides, app only flags).
- Student: per set, Create a team (creator does NOT auto-join), Join any non-full team, or
  Leave. In only ONE team per set (but different teams across different sets). Locked = view-only.
- Team assignments link to ONE team set; grade entered once per team → all members.

### ASSIGNMENT (core object) — states are DERIVED, not stored
From student's view: Upcoming (opens later) / Open (submittable) / Submitted (awaiting
grade) / Graded (has grade AND grades released) / Overdue (past due, no submission — the
only state with rust accent; shows "accepted till [date]" if late allowed). Draft
assignments invisible to students.
Properties (prof sets): title, instructions, attached files, marks, open date, due date,
late-allowed toggle, submission types accepted (files/link/text, all by default), is-team
(+ which team set). Multiple attempts; newest is graded. Same object appears in course
Assignments AND (if open/overdue) in To-Do; submitting removes from To-Do + sets ✓.

### ADMIN side (desktop) — setup plumbing
Left sidebar: INSTITUTION (Overview, Term, Departments) · ACADEMICS (Courses, Offerings,
Timetable) · PEOPLE (Students, Faculty, Enrolment).
- **Overview**: a genuine SETUP CHECKLIST (offerings with no professor / not scheduled /
  nobody enrolled). A checklist here IS correct because completing setup is the admin's job
  (this is the ONE place a metric/checklist landing is right — unlike the professor side).
- **Term**: name + first/last day of class (drives attendance projection); shows derived weeks.
- **Departments**: list + add.
- **Courses**: catalog (code, title, dept, credits) + New course; shows sections running / "+ offer it".
- **Offerings**: course running this term + professor(s) + enrolment + timetable slot. Create
  offering. Rust flags for "Nobody assigned" / "Not scheduled".
- **Timetable**: set days/times/rooms per offering (week grid + per-offering list). Feeds
  student Calendar AND attendance projection.
- **Students**: list + department filters + BULK IMPORT ("Bring in a list" / CSV). Add/edit.
- **Faculty**: list + add.
- **Enrolment**: assign students to offerings; two-panel (not-enrolled → enrolled),
  multi-select, batch enrol, filters.
NOTE: The founder was unsure about the admin design because they've never seen/used an admin
side (no lived reference). Verdict: it's functionally complete and fine; the unease is
unfamiliarity, not a flaw. Get a REAL administrator (Mahindra academic office) to judge it
during the pilot — they have the lived reference. Don't redo it based on a feeling.

### Design language (across all three roles)
Warm off-white background, one clean sans-serif (Inter-like), generous whitespace,
consistent corner radius + 4px spacing. COLOR-AS-IDENTITY: each course has a color carried
across its card, calendar blocks, to-do rows, grades, and a light-tinted header band in
course-detail screens. ACCENT/RUST only for things needing action/attention (overdue,
attendance below threshold, incomplete setup) — everything else calm. CALM over dense: no
metric-card dashboards as landing pages (except admin Overview); "what needs you" via subtle
badges + quiet one-line summaries. Warm human copy. Designed empty states everywhere.

### v1 SCOPE FENCE — do NOT build
No fees/payments. No document/certificate requests, no leave/approval workflows. No chat/
messaging/real-time (avoid the WhatsApp swamp). No in-document PDF annotation (feedback =
text box). No grading rubrics (marks + feedback only). No native app (PWA only). No schools
mode (architect roles to allow it later, don't build). No student ranking (anonymous class
avg/median only).

### Small "soul" touches to build (cheap, high-value, from being a student/grader)
Persistent submitted ✓ everywhere; dual deadline display (relative + absolute); copy-to-
clipboard on room numbers/links; SpeedGrader keyboard shortcuts + autosave. (A longer
brainstorm of tiny features was done and mostly CUT — the conclusion was the core is complete
and more features should come from real pilot users, not invented. Don't over-add.)

---

## PART C — THE TECH STACK (locked)

- **Language:** TypeScript everywhere, strict mode. No plain JS.
- **Framework:** Next.js (App Router, latest stable). Frontend + backend in one app.
- **Database / Auth / Storage:** Supabase (Postgres). Use `@supabase/ssr` (browser +
  server clients). Auth via Supabase Auth.
- **UI:** Tailwind CSS + shadcn/ui. Framer Motion for subtle motion (later).
- **Client data fetching:** TanStack Query (React Query).
- **Forms + validation:** react-hook-form + zod (same zod schema validates client AND server).
- **Hosting:** Vercel.
- **Student delivery:** responsive web app as a PWA (add-to-home-screen) + push
  notifications. NOT native in v1.
- **Error tracking:** Sentry (free tier) after the first slice.
- **Editor:** VS Code, with Claude Code (see Part E).

### Why this stack (so it's not re-litigated)
Solo founder → minimize moving parts (Next.js = frontend + backend + one deploy).
Heavy AI-assisted build → use the ecosystem where AI output is strongest (TS/Next is #1).
Data is deeply relational + sensitive → Postgres with Row Level Security (NOT MongoDB).
Future hires must be easy → mainstream, not exotic. No lock-in at the data layer (plain
Postgres — can export/self-host if ever needed).

### The golden build rules (from CLAUDE.md — non-negotiable)
1. RLS on EVERY table (Supabase exposes the DB to the client via the anon key; RLS is the
   ONLY protection). Default-deny. Policies keyed off `auth.uid()`. Index every column a
   policy compares. NEVER expose the service_role key in client code.
2. Multi-tenant from day one — every domain table has `institution_id`.
3. Don't ship code you can't explain out loud (stay in control of your own codebase).
4. One feature per session, commit often. No "build the whole app" prompts.
5. Validate at the door with zod on the server before writing.
6. Test the ugly paths (wrong file type, double submission, expired session, permission
   mismatch, empty states) — not just the happy path.
7. Mobile-first for student screens; desktop-first for professor/admin.

---

## PART D — WHAT EXISTS RIGHT NOW

- **Full design** of all three roles, done in Claude's design tool as an interactive
  prototype (the founder has the screens as screenshots and a working HTML prototype).
- **CLAUDE.md** — the build operating rules (this repo / outputs).
- **SPEC.md** — the complete product spec + full Postgres schema (with RLS guidance) + the
  vertical-slice build order. Already reviewed and corrected once (fixed: the grade-publish
  field contradiction, the submissions model ambiguity, the rotating-code modeling, the
  one-team-per-set DB guard, plus added email/attendance-threshold/bootstrapping/storage
  notes). SPEC.md is authoritative for anything to do with data or features.
- **HANDOFF.md** — this file.
- **NO code written yet.** No repo yet.

---

## PART E — EXACT NEXT STEPS (do these in order)

### Step 0 — Set up the workspace (you, ~15 min)
1. Install prerequisites if not present: Node.js (LTS), Git, VS Code.
2. Install the **Claude Code** extension in VS Code (or use the Claude Code CLI). Claude
   Code is the agentic coding tool that will write the app for you inside your editor.
3. Create a **GitHub repo**: New → private → name it (e.g. `campus`) → add a README → create.
4. Clone it locally and open the folder in VS Code.
5. Put `CLAUDE.md` at the repo ROOT (Claude Code auto-reads it every session). Put `SPEC.md`
   and `HANDOFF.md` at the root too (or in a `/docs` folder). Commit and push.

### Step 1 — Create the Supabase project (you, ~15 min)
1. Sign up at supabase.com, create a new project (free tier). Save the project URL and the
   anon key and service_role key.
2. In VS Code, create a `.env.local` (gitignored!) with:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. You'll load the schema (from SPEC.md Part 4) into Supabase in Milestone 0 — Claude Code
   can generate the SQL migration from the schema in SPEC.md.

### Step 2 — Milestone 0: the skeleton (Claude Code, one focused session)
Open Claude Code and tell it to read CLAUDE.md and SPEC.md, then do Milestone 0 ONLY:
- Scaffold Next.js + TypeScript + Tailwind + shadcn.
- Wire Supabase (`@supabase/ssr` browser + server clients).
- Generate the schema SQL from SPEC.md Part 4 and apply it (with RLS enabled on every table).
- Auth + login. Middleware route guard. Role-based redirect (student→mobile home,
  faculty→prof home, admin→admin).
- Deploy to Vercel.
- Success = two seeded test users (a student, a professor) can log in and land on the right
  home. Nothing else. Commit.
DO NOT let it build features yet. Skeleton only.

### Step 3 — Milestone 1: the end-to-end assignment slice (Claude Code, one session)
This single loop proves the whole system (auth, roles, RLS, storage, the core cycle):
1. Seed/admin: institution, term, department, a course + offering, one professor assigned,
   a few students enrolled.
2. Professor: create an assignment.
3. Student: see it in the course + To-Do, submit a file.
4. Professor: see submissions, grade in SpeedGrader (unpublished), Publish all.
5. Student: see the published grade + class average.
Get this SOLID before anything else. Verify RLS actually works (a student truly cannot read
another student's data via the API).

### Step 4 — Expand, ONE feature per Claude Code session (reusing the proven pattern)
In roughly this order (from SPEC.md build order): Announcements → Files → Course info →
Attendance (sessions + code + manual override + projection) → Timetable → Teams/team sets →
Placements → full Admin surfaces (departments, courses, offerings, people, enrolment, bulk
import) → Polish (persistent ✓, dual deadline, copy-to-clipboard, SpeedGrader shortcuts +
autosave, PWA + push, Sentry, backups). Commit after each. Match the prototype screens for
each surface (feed Claude Code the relevant screenshot as a visual reference).

### Step 5 — Quality gate before calling anything "done"
For every feature: RLS verified, input validated with zod, empty/error states handled, ugly
paths tested. Never lose a submission or a grade — those are the trust-makers.

### IN PARALLEL (the physical world — do NOT skip; this is the actual moat)
- **Visit Mahindra's IT/academic office**: what LMS/ERP does Mahindra currently license,
  what does it cost, and WHY does nobody use it? (This single answer reshapes the pitch — is
  the problem no-platform or no-enforcement? Also: does Mahindra run JUNO, and why, when
  Camu/others exist? This tells you if incumbents are beatable on the ground.)
- **Visit the placement office**: how do they run a placement season, what tools, what's the
  most painful part, do they pay for anything (Superset etc.)?
- **Line up a professor champion**: find a young, tech-friendly, frustrated-with-the-current-
  mess professor and get them to agree to pilot ONE course (or a few courses) next semester.
  You need exactly one yes to start.
- **Warm up the HOD** informally for a possible CSE-department-wide rollout after the pilot
  proves out (get a soft pre-commitment: "if week-12 retention holds, will you back a
  department rollout?").
- Use the Mahindra E-cell/incubation for legitimacy and warm intros. Save any big
  amplification (press, a notable tweet) for AFTER you have real traction — it amplifies
  proof, not a pretty app.

### Rollout plan (after Mahindra works)
Own Hyderabad college-by-college, founder-led, using the Mahindra case study + references.
Then Bangalore. Retention before expansion — never sign college #6 while college #2 is
unhappy (bad references spread as fast as good ones in this herd-driven market). Price cheap
to enter (₹3–5L), grow accounts over years.

---

## PART F — HOW TO KEEP A NEW CHAT FULLY INFORMED

To start a fresh chat with full context:
1. Start a Claude **Project** (best) OR a normal chat.
2. Add these three files as knowledge / paste them: **HANDOFF.md** (this file), **CLAUDE.md**,
   **SPEC.md**. Also attach the design screenshots if discussing design.
3. Tell the new chat: "This is my project. Read HANDOFF.md for the full context, SPEC.md for
   the product spec and schema, and CLAUDE.md for build rules. I'm at [current step]."
4. That's it — the new chat will be as informed as the original.

### Living-document discipline
These docs are the source of truth, but they're LIVING. When the build reveals something the
spec got wrong or didn't foresee, UPDATE the doc and keep going. Re-read your own spec
against your code every so often and reconcile — the map drifts from the territory otherwise.
The first review of SPEC.md already caught several real contradictions; do that periodically.

---

## PART G — THE MINDSET (so the founder stays calibrated)

- The idea is GOOD (not great), the product is genuinely BETTER than the incumbents, there's a
  REAL gap, and the founder is well-positioned. The odds are real. This is worth doing.
- BUT the entire game is EXECUTION and RETENTION — there's no idea-moat; someone could copy the
  app. The defense is out-caring and out-grinding incumbents who were structurally set up not
  to care. That's winnable but it's a knife fight of execution, not a coronation.
- The product being this good is the ACHIEVABLE part (design/code are commoditized now). The
  hard part — the years of college-by-college selling, 11pm support during exam weeks,
  rejection, the retention grind — is what determines success, and it's mostly unglamorous.
- Do the pilot WHILE finishing the MS at UF. It costs a semester of evenings, not your future
  or your fallback. It converts every "will I succeed?" question into DATA (week-12 retention).
  The big commit decision earns itself later, with evidence. Don't seek certainty before the
  pilot — that's the actual mistake.
- Hold the big vision (national scale, real money) as motivation; let the small plan (own my
  city, one retained college) be the daily focus. The founders who died stared at the TAM; the
  ones who won stared at their next three colleges.

END OF HANDOFF.
