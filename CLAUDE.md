# CLAUDE.md — Read this first, every session

You are helping build **Campus** (working name), a mobile-first campus platform for
Indian colleges. Students use it on their phones; professors and admins use it on
laptops. It is deliberately calm, warm, and premium — the opposite of legacy Indian
college ERP software (JUNO, etc.). The whole competitive edge is that it is *good to
use*, so quality of experience and reliability are the point, not feature count.

Read `SPEC.md` in this repo for the full product spec, data model, and build order.
Read it before writing code. This file is the operating rules.

---

## The stack (do not deviate without asking)

- **Language:** TypeScript everywhere. Strict mode on. No plain JS files.
- **Framework:** Next.js (App Router, latest stable). Frontend + backend in one app.
- **Database / Auth / Storage:** Supabase (Postgres). Use the `@supabase/ssr` package
  for Next.js integration (browser client + server client). Auth via Supabase Auth.
- **Styling / UI:** Tailwind CSS + shadcn/ui components. Framer Motion for subtle
  motion only (later, not in the core build).
- **Data fetching (client):** TanStack Query (React Query).
- **Forms + validation:** react-hook-form + zod. Zod schemas validate on BOTH client
  and server — reuse the same schema.
- **Hosting:** Vercel.
- **Delivery to students:** responsive web app installable as a PWA (add-to-home-screen),
  with push notifications. NOT a native app in v1.
- **Error tracking:** Sentry (free tier) once past the first slice.

## Golden rules (non-negotiable)

1. **RLS on EVERY table.** Supabase exposes the DB directly to the client via the anon
   key; Row Level Security is the ONLY thing protecting data. Every table must have
   RLS enabled and explicit policies. Default-deny. Key policies off `auth.uid()`.
   Index every column used in a policy comparison (e.g. student_id, institution_id).
   NEVER expose the `service_role` key in client code.
2. **Multi-tenant from day one.** Every domain table carries `institution_id`. Even
   though there is one institution now, this is what makes a second college a config
   entry instead of a rewrite. RLS scopes rows to the user's institution.
3. **Don't ship code you can't explain.** If you generate something the human wouldn't
   be able to explain out loud, stop and explain it in the response. This is how the
   human (a solo CS founder) stays in control of their own codebase.
4. **One feature per session, commit often.** Build a thing, test it, commit, move on.
   Do NOT attempt "build the whole app" in one shot. Small verified steps.
5. **Validate at the door.** Every write path validates input with zod on the server
   before it touches the DB. The DB constraints are the last line, not the only line.
6. **Test the ugly paths.** Wrong file type, double submission, expired session,
   permission mismatch, empty states. Not just the happy path.
7. **Mobile-first for student screens; desktop-first for professor/admin screens.**
   Design student screens at ~390px first. Professor and admin use wide layouts
   (sidebars, tables).

## Design language (match the existing prototype)

- Warm off-white background, one clean sans-serif (Inter-like), generous whitespace,
  consistent corner radius and 4px spacing scale.
- **Color-as-identity:** every course has an identity color. That color carries across
  the course card, its calendar blocks, its to-do rows, its grades, and (in course
  detail screens) a light-tinted header band.
- **Accent/urgent color (rust) ONLY for things needing action or attention** (overdue,
  attendance below threshold, unassigned/incomplete setup). Everything else is calm.
- **Calm over dense.** No metric-card dashboards as landing pages. "What needs you"
  is expressed through subtle badges and quiet one-line summaries, not walls of stats.
  (Exception: the ADMIN overview is a genuine setup checklist — that's fine, because
  completing setup IS the admin's job.)
- Warm, human copy everywhere. Designed empty states (calm/rewarding, never blank).

## What NOT to build (v1 scope fence)

- No fees / payments / money handling.
- No document/certificate requests, no leave/approval workflows.
- No chat / messaging / real-time collaboration (avoid the WhatsApp swamp).
- No in-document PDF annotation (grading feedback is a text box in v1).
- No grading rubrics (marks + feedback only).
- No native mobile app (PWA only).
- No schools mode yet (architect the role system so it's possible later, but don't build it).
- No ranking of students (grades show anonymous class average/median only — never ranks).

## How to work

- Before touching a file that produces output or runs code, read the relevant spec
  section in SPEC.md.
- Keep the data model in SPEC.md authoritative. If you need a schema change, update
  SPEC.md too and flag it.
- Prefer boring, well-known patterns over clever ones. This is infrastructure a solo
  founder maintains and a future team inherits — legibility beats elegance.
