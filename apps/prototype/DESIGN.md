# Zenhyre 2.0 web app: design record

Clickable front-end prototypes for the three stakeholders in the spec
(`docs/superpowers/specs/2026-11-05-zenhyre-2-design.md`): candidates, companies, alumni
associations. One Next.js app, one seat per stakeholder, fixture data, real rules.

## Brief

- **Subject:** Zenhyre 2.0, a three-sided hiring platform for IIT talent (Novare Talent).
- **Audience:** the founder and the first reviewers from each side (a student, a founder who
  hires, an association admin). They need to click through their own seat and believe it.
- **Job:** make the spec visible. Every screen maps to a spec section; every number on screen
  comes from the spec's config defaults (`packages/ops/src/defaults.ts`).
- **Stack:** Next.js App Router + TypeScript (the spec's frontend stack), plain CSS tokens,
  GSAP for the board and the seat transition. No Lenis: these are app screens, native scroll
  is the right feel. No WebGL, no loader: a product earns craft, not theatre.
- **Assumptions:** every person, company and amount in `src/data/fixtures.ts` is invented.
  The API today covers identity only (Slice 1A), so roles, matching and ledger are simulated
  in the browser with the spec's rules. State resets on reload.

## Concepts considered

| | A. The cut line (formal) | B. Twenty-three (place) | C. Notice board (culture) |
|---|---|---|---|
| Idea | Everything is a ranked sheet with a line under row 25 | The platform is a board of the 23 IITs. A role lights the cells it reaches; each side reads the same board from its seat | Screens are placement-cell notices pinned to a board |
| Anchor | shortlist cap 25 and displacement (§8) | 23 campuses in the seed; deposit priced by campus count (§2) | how IIT shortlists get posted |
| Signature | a stronger applicant pushes row 25 under the line | switching campuses on and watching the deposit step 15k, 30k, 60k | sheets pinned and stamped |
| O / F / Fe / P | 4 / 5 / 4 / 2 | 4 / 5 / 5 / 1 | 3 / 4 / 3 / 3 |

**Picked B.** It cannot be moved to another product: it is literally the 23 seeded campuses
and the pricing rule. It gives all three seats one shared object. Stolen from A: the company
shortlist is a ruled sheet with a visible cut line under row 25. The 404 is the 24th cell.

## Concept card

```
Idea:        A board of twenty-three campuses. A role switches on the ones it reaches, and
             candidate, company and association each read that board from their own seat.
Metaphor:    a lamp board / periodic table of the IITs: cells are off or lit, never in between
Signature:   the reach board. Switch campuses on, the tally cell counts, the deposit steps
             through the three tiers. It idles by broadcasting fixture roles.
Emotion:     exact and calm, like a well-run exam hall
Motion verb: switch on. Fills wipe in from the left and latch; rows post into place.
Screenshot:  the 24-cell board, a handful of cells lit yellow, the tally reading 07 of 23
```

## System

**Palette** (yellow is light, never text)

| Role | Hex | Use |
|---|---|---|
| ground | `#EEEFEF` | page |
| sheet | `#FFFFFF` | ruled sheets and panels |
| ink | `#0C0C0D` | text, primary buttons |
| muted | `#56575A` | secondary text (AA on ground and sheet) |
| line | ink at 14% | hairlines, cell borders |
| lit | `#FFD60A` | a switched-on cell, a flooded button, the current stage |
| stop | `#B3261E` | rejections and forfeits only |
| night | `#0C0C0D` | the seat curtain, the footer |

**Type**

- Archivo (variable width + weight, Google OFL). Display: width 62 to 75, weight 800, for
  campus symbols, numerals and headings. Text: width 100, weight 400/500/600.
- DM Mono 400/500 for machine strings only: roll numbers, referral tokens, emails, ledger refs.
- Tabular figures everywhere a number can change.

**Grid and rhythm:** 12 columns, fluid gutter, content hangs from columns 1, 5 and 9.
Seats use a 12-column app grid: 8 for the working list, 4 for the side sheet.

**Shape:** radius 0. Cells are cells. The one exception is the lamp dot in nav (a circle).

**Motion language:** one curve, `cubic-bezier(0.16, 1, 0.3, 1)`. Hover 0.3 s, rows 0.5 s
with 30 ms stagger, board sequences 40 ms per cell, seat curtain 0.55 s each way.

**Treatments, one per role**

| Role | Treatment |
|---|---|
| Buttons and CTAs | flood: a fill wipes in from the left and latches |
| Nav and tabs | lamp: the dot before the label switches on; the current page stays lit |
| Rows (roles, shortlist, queue) | an edge bar switches on and the row steps 6 px right |
| Board cells | the cell floods lit |
| Utility links | underline only |

**Idle:** the hero board broadcasts a different fixture role every few seconds until the
visitor touches it (pause control provided). In the seats, live countdowns tick. Under
reduced motion the board holds one role. Countdowns keep ticking: they are information, not decoration.

**Seat transition:** changing seat plays the board as a curtain: 24 cells switch on in
reading order, the route swaps, they switch off. Moving inside a seat never plays it.

## Composition

```
/  gateway
[ wordmark                         candidates  companies  associations ]
[ H1 (cols 1-5)                  |  BOARD 6 x 4, last cell = tally     ]
[ lede + two CTAs                |  readout: role on the board, deposit ]
[ THREE SEATS: three full-width index rows, flood on hover             ]
[ HOW A ROLE MOVES: 8 lamps on one track, lit by scroll, rule per stop ]
[ THE NUMBERS: six figures from the config defaults                    ]
[ footer on night: giant wordmark, seat links, fixture notice          ]

/candidate /company /association  (seat shell)
[ wordmark  seat switcher                                   persona   ]
[ masthead: the seat's own cell + one display line                    ]
[ tabs (lamp nav). phones: bottom tab bar                             ]
[ working list (8 cols)                    | side sheet (4 cols)      ]
```

## Genericness test

A generic model asked for "hiring platform prototypes" lands on rounded SaaS cards, a blue or
purple gradient, Inter, and three identical dashboards. Changed: the dashboards are ruled
sheets hung off one board; the only colour is the lamp; the display voice is the campus
symbol set large; each seat opens on its own cell rather than on a stats row.

## Decisions recorded for QA

- No smooth scroll and no loader, on purpose (app screens).
- Seat pages are quiet at rest apart from countdowns; the gateway board carries the idle motion.
- Candidates are not shown fit scores or rank: the spec gives them stage only (§8).
- `internal_tier` is not in the app at all (§2: never shown).

## Login (added after the first review)

- The gateway's top bar carries one action, **Log in**. The three seat rows lead to the same
  login with the role preselected.
- The role choice is the board again: three cells, one lit. It is a radio group, so exactly one
  role can be chosen, and the session it opens sits in that one seat with no way to hop.
- Candidates choose between two ways in, as a second switch under the role: campus LDAP ID (an
  ID field joined to a campus mail-domain picker) or personal email. Work addresses are refused.
- Companies get one field, labelled work email. Personal mailboxes and campus addresses are
  refused as they are typed, with the reason under the field.
- Associations have no sign-up. Their cell says the login is created by Novare, and an address
  without one is turned away after the link is opened, without a session.
- Each email holds one role for good. The API refuses a second role; the app says which one the
  email already has.
- Inside a seat the bar shows the seat, the signed-in address and Log out. Nothing else.
- The curtain now plays between the board and the login, not between seats.
