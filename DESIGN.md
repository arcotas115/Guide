# DESIGN.md — the visual system

Read this every session alongside `BUILD_RULES.md` and `SPEC.md`. `SPEC.md` says what a
screen does; this file says what it looks like. A screen that works but does not match
this file is not finished — the entire competitive premise of this product is that it is
calm and pleasant to use, so the visual layer is a requirement, not a polish pass.

If a value you need is not here, ask before inventing one.

---

## 1. Surfaces

| Token | Value | Use |
|---|---|---|
| page | `#F1EFEA` | the outermost background, behind the canvas |
| canvas | `#FAFAF8` | the app surface content sits on |
| card | `#FFFDF8` | cards and rows on the canvas |
| card border | `#EAE7DF` | 1px card and row borders |
| chevron | `#C0C4BF` | the disclosure chevron on tappable rows |
| input border | `#D5D2C8` | the outline of anything you interact with |

`card-border` is deliberately too pale to outline a control. A switch, input or
selectable chip uses `input border` instead — that contrast is what makes an interactive
element look interactive.

### Ink ramp

| Token | Value | Use |
|---|---|---|
| ink | `#14171A` | primary text, headings |
| ink-strong | `#303531` | emphasised body |
| ink-muted | `#55605A` | secondary lines, subtitles |
| ink-soft | `#7A7E79` | metadata, timestamps |
| ink-faint | `#9A9E98` | disabled and not-yet-available |

Never plain `#FFFFFF` as a page background and never plain `#000000` as body text. The
warmth is the point; pure white and pure black read as clinical, which is the exact
feeling this product exists to avoid.

## 2. Type

- **Instrument Sans** for everything except metadata.
- **IBM Plex Mono** for metadata only: course codes, column labels, small caps eyebrows
  (`ABOUT THIS COURSE`, `WHAT TO DO`, `ATTACHED BY THE PROFESSOR`, `MARKS AND DATES`).
  Mono metadata at ~10px, letter-spacing `.13em`, uppercase.
- Course name / primary row title: 17.5px, weight 600, letter-spacing `-.026em`.
- Screen title (`Assignments`, `Grades`, `More`): large, weight 700, tight tracking.
- Body: 15–16px, generous line-height (~1.55). These screens are read, not scanned.

## 3. Spacing, radius, layout

- 4px spacing scale. Every gap, pad and margin is a multiple of 4.
- Card radius 12. Mobile device frame radius 42.
- **Adjacent text spans always get an explicit gap.** A heading and its count, a title
  and its marks, a code and its name are separate elements and must never render as
  `WAITING ON YOU4` or `Page replacement15 marks`.
- **Student screens: design at 390px first.** Frame 390×844.
- **Faculty and admin: desktop, and content must sit in a max-width container that is
  centred.** Never let content run flush to the edge of a wide monitor. Left sidebar
  is a fixed narrow column (~12% of frame width); the content column is what centres.

## 4. Course identity colour

Every course carries **four** tokens, stored in the database, never hardcoded:

| Course | color | tint | wash | washBorder |
|---|---|---|---|---|
| CS301 | `#4C5BD4` | `#EEF0FD` | `#F5F6FE` | `#E6E9FA` |
| CS302 | `#0E7C86` | — | — | — |
| CS305 | `#A8690E` | — | — | — |
| MA204 | `#7E4A8E` | — | — | — |
| HS201 | `#3F7A4B` | — | — | — |
| OE310 | `#8A6A55` | — | — | — |

**Only `color` is stored.** `courses.color` is the single source of truth; `tint`, `wash`
and `washBorder` are DERIVED from it at render time by mixing toward the canvas
(approximately 9% / 5% / 14%). Do not add columns for them — one colour per course is all
an administrator should ever have to choose, and three stored derivatives are three
values that can drift out of sync with the fourth.

The derived results land within a point or two per channel of the values recorded during
design. That difference is below what anyone can perceive on a flat tint, and the
consistency of having one source is worth more than an exact match.

Where each token goes:
- **color** — the course card's left spine, the course code text, the course hub header
  background, the dot beside a course code.
- **tint** — to-do rows, chips, calendar blocks, the small colour behind a chevron.
- **wash + washBorder** — the light tinted header band on a course subsection screen.
  This tinting is a deliberate "you are inside this course" system; it is not decoration.

Course hub header = `background-color: course.color` plus a sheen overlay:
`linear-gradient(165deg, rgba(255,255,255,.12), rgba(0,0,0,.14))`.

## 5. Rust — the attention colour

`#B4552B` on `#FBEEE6`.

Reserved **strictly** for: overdue assignments, attendance below the institution's
threshold, and incomplete admin setup. Nothing else on any screen is rust. If a third
thing starts using it, the signal is gone. Everything that is not demanding action is
calm.

**Settled case: the late-penalty badge is NOT rust.** A penalty rule is a property of a
perfectly healthy assignment, and a normal course has it on many rows at once — rendering
those in rust puts the attention colour on half a table where nothing needs attention.
It renders neutral. (The prototype shows it in rust; the prototype is wrong here, and
this rule wins.)

## 6. Components

**Course card (student home).** White card, 12 radius, with a **15px full-height colour
spine** on the left edge. Not a full-colour block, not a monogram tile — this decision
was made deliberately during design. Contents: course code in mono in the course colour,
course name 17.5/600, professor name muted. Chevron right. No due counts — the card is
identity only.

**Section row (course detail).** Title, a one-line muted subtitle carrying live state
("1 overdue · 1 open", "82% · above the line", "Not in a team yet"), and a chevron in a
tinted rounded square. Rust for the subtitle only when the state warrants it.

**Filter chips.** Rounded, bordered, with a count beside the label, and an unmistakable
active state (filled dark, white text). A chip row with no counts and no active state is
not done.

**Tables (faculty).** Mono uppercase column labels. Group headers with a count and a
one-line explanation beneath. Body rows must align to the header columns — a header at
one set of positions and cells at another is the most visible possible defect.

**Toggles.** A toggle is a visible control with a readable on/off state, plus its
explanatory line beneath. A label with no control is not a toggle.

**Buttons.** Primary is near-black, white text, generous vertical padding, full-width on
mobile. Secondary is bordered on the card colour. Disabled states say what is missing
("Add something to submit"), never just grey out.

**Empty states.** Always designed, never blank, and never nagging. "All caught up.
Nothing pending." Do not tease the next upcoming item in a rest state.

## 7. Copy

Warm and human, sentence case, plain language. Contextual back buttons always name the
destination ("← Operating Systems"), never "Back". Dates render in the institution's
timezone. Explanatory lines under form fields are part of the design, not filler.

Never render a promise the app cannot keep — if publishing does not yet post an
announcement, do not print that it does.

## 8. What "calm" rules out

No metric-card dashboards as a landing page. No workload tallies aimed at professors.
No student ranking, ever — anonymous class average and median only. The one permitted
checklist landing is the admin Overview, because completing setup genuinely is the
admin's job.
