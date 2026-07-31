# CLAUDE.md — Read this first, every session

You are helping build **Campus** (working name), a mobile-first campus platform for
Indian colleges. Students use it on their phones; professors and admins use it on
laptops. It is deliberately calm, warm, and premium — the opposite of legacy Indian
college ERP software (JUNO, etc.). The whole competitive edge is that it is *good to
use*, so quality of experience and reliability are the point, not feature count.

Read `SPEC.md` in this repo for the full product spec, data model, and build order.
Read it before writing code. This file is the operating rules.

---

## ⚠️ BUILT FOR 1,000+ INSTITUTIONS — LOAD-BEARING RULES (read before every feature)

This product is NOT a small MVP for one or two colleges. The target is 1,000+
institutions across many cities — hundreds of thousands to millions of concurrent users.
The starting stack (Supabase) is the ON-RAMP and will be replaced at scale (dedicated /
sharded / distributed Postgres, S3+CDN storage, caching layers). That evolution is
PAINLESS only if the application is written scale-safe from line one. These rules are how.
Honoring them costs nothing now and is CATASTROPHIC to retrofit onto live data across
hundreds of institutions later. Follow them on EVERY feature, no exceptions.

1. **Absolute tenant isolation.** Every table has `institution_id NOT NULL`. No exceptions,
   ever. There is no such thing as a table without a tenant.
2. **UUIDs for ALL primary keys** (`gen_random_uuid()`). Never auto-increment integers —
   they collide across shards. UUIDs are shard-safe. This is impossible to change later
   with live data, so it is locked from line one.
3. **ZERO cross-tenant queries, ever.** Every query is scoped to exactly one institution
   (WHERE institution_id = the current tenant). This includes admin and analytics queries.
   Never SELECT/JOIN/aggregate across institutions. This single rule is what preserves
   future sharding. If a query would span institutions, STOP — it's a landmine.
4. **No foreign key ever crosses an institution boundary.** Every relationship stays
   within one institution's data (a submission→assignment→offering→course all share the
   same institution_id). This makes each tenant's data self-contained and shardable.
5. **Every feature runs "for one tenant at a time."** The mental frame for every screen and
   action: it operates on ONE institution's data, never across all colleges.
6. **Database-agnostic app / standard SQL.** The core app speaks plain PostgreSQL.
   Supabase's proprietary features are allowed ONLY at the edges (auth, storage) where they
   are swappable. Never weave Supabase-only magic into business logic — it must be possible
   to migrate the database to dedicated/sharded Postgres without changing the app.
7. **Config-as-data for anything institution-specific.** Attendance thresholds, grading
   schemes, term rules, section conventions — all live in config tables keyed by
   institution_id and are READ by the app, never hardcoded. Institution #847 with a
   different rule must be a config row, never a code change. (e.g. institutions.min_attendance_pct.)
8. **Stateless application layer.** No server-side session stickiness. Next.js serverless is
   already stateless — keep it that way so it scales horizontally across many servers.
9. **Index every tenant-scoping column** (institution_id, and the join columns policies use)
   so tenant-scoped queries stay fast as data grows huge.

**DEFER (do NOT build now — building these for zero users is over-engineering):** actual
database sharding, distributed databases, multi-region, Kubernetes, caching layers, load
testing, advanced ops/monitoring. You build the SHARDABILITY (rules 1–9) now; you build the
SHARDS and scale-infra later, funded by growth, WITHOUT rewriting the (correctly-designed)
app. Start on Supabase, proceed with Milestone 0 exactly as planned — the scale-readiness is
in the DISCIPLINE of the code, not in extra infrastructure today.

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
