# CAMPUS — FUTURE-PROOFING: handle-now vs defer

Purpose: capture the structural decisions that are CHEAP to make now and CATASTROPHIC to
retrofit onto live data across many institutions later — plus the things that are safe to
DEFER to a future experienced-engineering team. Read alongside BUILD_RULES.md (the
load-bearing scale rules) and PROGRESS.md (current build state).

The governing principle (for a solo non-expert founder):
**Your job now is NOT to solve everything — it is to not make things IMPOSSIBLE to solve
later.** Handle the load-bearing walls (impossible to retrofit with live data). Keep
everything else clean and swappable so a future senior engineer can add it without a
rewrite, funded by revenue, when scale justifies it.

---

## PART 1 — HANDLE NOW (cheap today, awful to retrofit). Bake into the build.

### 1. Soft-deletes + a deliberate deletion / privacy strategy
Why it bites: students/colleges WILL demand data deletion (graduation, a student leaving,
a college offboarding, DPDP Act / "right to be forgotten"). Hard foreign keys everywhere
with no deletion plan = you literally cannot delete a student without breaking submissions,
grades, attendance. India's DPDP Act applies to student personal data — this is legal, not
just technical.
Do now:
- Prefer **soft-delete** (`deleted_at timestamptz null`) over hard delete on core entities
  (profiles, submissions, assignments, etc.). Nothing is truly unrecoverable; deletion
  requests can be honored without breaking referential integrity.
- Decide the cascade/anonymize policy deliberately per relationship: when a student is
  removed, what happens to their submissions/grades/attendance — cascade-delete,
  anonymize (strip PII, keep aggregate), or soft-delete? Write it down.
- Design a path to **export + hard-purge** an institution's or student's data on request
  (needed for offboarding and legal compliance). Doesn't have to be built now, but the
  schema must make it possible (tenant-isolated data + soft-delete make it possible).
- Queries must respect `deleted_at` (a shared helper / default filter), so soft-deleted
  rows don't leak into normal reads. This is itself a place a policy/query bug could show
  deleted data — treat it with the same care as tenancy.

### 2. Audit trail / who-changed-what on sensitive data
Why it bites: grades and attendance generate disputes ("I submitted on time", "my grade
changed", "I was marked absent wrongly") and abuse risk (grade changed after publish,
tampering). Without recorded history you cannot resolve disputes or detect abuse.
Do now:
- `created_at`, `updated_at`, and **who did it** (`updated_by` / `graded_by` etc.) on
  sensitive tables: submissions, submission_grades, attendance_records, assignments.
- For grade changes specifically, consider an **append-only audit log** (grade_history:
  who, old value, new value, when) — grades are the highest-dispute, highest-trust data.
- History you didn't record cannot be reconstructed. Columns are free now.

### 3. Timezones — one clear rule, applied everywhere
Why it bites: THE classic silent killer for a deadline/attendance app, made worse by a
US-based founder building for India-based users and eventual multi-region. Mixing server
time and user time = students marked late who weren't, assignments closing an hour early.
Do now:
- Store ALL timestamps in **UTC** (`timestamptz` already does this — good).
- **Display** in the institution's / user's timezone, always deliberately, never assumed.
- Deadline/late/attendance LOGIC compares in UTC; only presentation converts. One rule,
  everywhere. (Institution timezone is a candidate config-as-data field on `institutions`.)

### 4. Backups you have actually TESTED restoring
Why it bites: an untested backup is a hope, not a backup. Losing grades/submissions is
unrecoverable trust death in this market.
Do now / soon:
- Confirm Supabase automatic backups are ON (paid tiers). 
- **Do one test restore** so you KNOW it works before you need it in a crisis. Re-test
  periodically. This is the step everyone skips and regrets.

### 5. Keep storage swappable + set a per-file size cap (relevant at 1B)
Why it bites: student submissions are NOT all small — handwritten-work photo-batches
(30–80MB, and this is the COMMON case in India), engineering zips (50–500MB), video
(200MB–1GB+). At 1,000 institutions storage becomes a real, compounding cost (thousands
$/month), and retention ("keep everything forever") makes it unbounded.
Do now (in 1B when storage lands):
- Use Supabase Storage for now, but **abstract file storage behind an interface/adapter**
  so an alternative backend (e.g. institution-provided Google Drive / OneDrive) can be
  added later WITHOUT a rewrite. (Bring-your-own-storage is a genuinely strong scale-stage
  move: it pushes the biggest scale cost onto the college's already-paid-for storage AND
  is a trust/compliance selling point — "your data stays in your own Drive.")
- Set a sensible **per-file size cap** (e.g. 50–100MB) so one runaway upload can't wreck
  the storage bill; larger (video courses) becomes a deliberate exception.
Levers for later (note, don't build now): photo compression/resize on upload (an 8MB
handwriting photo is legible at ~1MB — could cut the biggest storage driver ~80%); a
**retention policy** (keep current + previous term hot, archive/expire older) so storage
doesn't grow without bound.

---

## PART 2 — DEFER (buildable later by experienced engineers, no rewrite needed if the
foundation stays clean). Be aware; don't over-engineer now.

- **Rate limiting / abuse & brute-force protection.** Coming as you scale. Don't build now;
  don't build anything that makes it hard to add (stateless endpoints — already the case).
- **Email deliverability at scale.** Supabase default email is fine for pilot. At scale,
  move to a real provider (Resend / SES) with domain SPF/DKIM so mail doesn't hit spam.
- **Monitoring / observability depth.** Get Sentry in reasonably soon (already planned
  after the first slice) so you're not flying blind once real users depend on you. Uptime
  + performance monitoring is a scale-stage add.
- **Sharding / distributed DB / caching / CDN / multi-region.** Already covered by the
  scale rules: build the SHARDABILITY now (tenant isolation, UUIDs, standard SQL,
  stateless), the SHARDS/infra later. Solves the noisy-neighbor problem too.
- **Migration discipline + staging environment.** When engineers are hired, add migration
  review and a staging env so uncontrolled schema changes don't cause live outages.
  You're solo now — defer, but it's a "when the team arrives" must.

---

## THE ONE-LINE SUMMARY
Handle the impossible-to-retrofit walls now: **soft-deletes + deletion strategy, audit /
updated-by columns on sensitive data, UTC-store/local-display timezones, a tested-backup
habit, and swappable storage with a size cap.** Keep everything else clean and stateless
so experienced engineers can build the scale-infrastructure later, funded by revenue,
without a rewrite. The founder's job is to not architect out of a future that good hires
can build — not to build that future today.
