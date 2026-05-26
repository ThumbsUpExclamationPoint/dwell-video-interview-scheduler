# Dwell Video Interview Scheduler

A static GitHub Pages site that lets the search team's reviewers post
their availability and lets candidates self-book a **30-minute Google
Meet video interview with a panel** of reviewers (whoever's
simultaneously free). Backed by a Google Apps Script web app and a
Google Sheet — zero servers, zero hosting cost.

This is the Phase 2 sibling to the [Dwell Interview Scheduler](../Dwell%20Interview%20Scheduler/)
(20-minute 1-on-1 phone calls). Same architecture, different defaults
and a panel-aware matching layer. The two are deployed as fully
independent instances — separate repo, separate Apps Script, separate
Sheet — so neither can disturb the other.

## Architecture

```
            ┌──────────────────────┐         ┌──────────────────────┐
            │  Reviewer browser     │         │  Candidate browser    │
            │  (reviewer.html)      │         │  (index.html)         │
            └──────────┬────────────┘         └──────────┬────────────┘
                       │ paint availability               │ pick PANEL slot
                       │ POST                             │ POST
                       ▼                                  ▼
            ┌────────────────────────────────────────────────────────┐
            │          Google Apps Script web app (Code.gs)           │
            │   intersect reviewer availability → panel slots         │
            │   uses ADVANCED Calendar API to attach Google Meet      │
            │              runs as matt@dwellpeninsula.com            │
            └──────────────────────┬─────────────────────────────────┘
                                   │
                       ┌───────────┼───────────────┐
                       ▼           ▼               ▼
                ┌────────────┐ ┌────────────┐ ┌────────────┐
                │ Google     │ │ Google     │ │ Matt's     │
                │ Sheet      │ │ Calendar   │ │ inbox      │
                │ (state)    │ │ + Meet     │ │ (alerts)   │
                └────────────┘ └────────────┘ └────────────┘
```

## Repo layout

```
dwell-video-interview-scheduler/
├── index.html                  # candidate booking page (public, no gate)
├── reviewer.html               # reviewer availability page (password gated)
├── assets/
│   └── dwell-icon.png          # Dwell brand icon, lifted from Next Gen Hub
├── apps-script/
│   └── Code.gs                 # backend: intersect panels, book Meet calls
├── DEPLOY.md                   # one-time setup steps for Matt (~12 min)
└── README.md                   # this file
```

## How it works

**Reviewer flow (`reviewer.html`)**

1. Reviewer enters the shared password.
2. Picks their name from an 8-card grid (with a confirmation modal so
   nobody accidentally edits someone else's row).
3. Sees a day-by-day grid of 30-minute slots from 8am–8pm PT, running
   from today through July 1, with any previously-saved times
   pre-selected.
4. Clicks (or click-and-drags) to paint when they're free.
5. Hits "Save" — the page POSTs the painted slots to Apps Script,
   which replaces their availability rows in the Sheet.

**Candidate flow (`index.html`)**

1. Candidate lands on the public page — no password.
2. Sees only **panel slots** — 30-minute blocks where at least 2
   reviewers are simultaneously available. Each slot card shows the
   panel size and the reviewers' names.
3. Picks a slot; fills in name + email + phone; hits "Confirm booking."
4. Apps Script atomically claims the slot, creates a Google Calendar
   event **with a Google Meet link** (via the advanced Calendar API),
   invites all available reviewers + the candidate, and confirms back
   to the page.

## What "panel" means here

A panel slot is a 30-minute block where ≥ `MIN_PANEL_SIZE` reviewers
have all painted themselves as available. Default `MIN_PANEL_SIZE` is
**2** (configurable in `Code.gs`). When a candidate books, *every*
reviewer who's available at that moment is invited — so panels grow
naturally to whatever size the team can manage.

If a reviewer un-paints a slot after a candidate sees it but before
they POST the booking, the server re-checks inside a lock and rejects
the booking with a clean error ("that slot just changed — please pick
another") rather than booking an under-sized panel.

## Google Meet — the one nontrivial moving piece

Apps Script's basic `CalendarApp` *cannot* generate Meet links. To
attach Meet conference data we use the **advanced Calendar API
service** (`Calendar.Events.insert(..., {conferenceDataVersion: 1})`),
which is a one-click enable in the Apps Script editor. `DEPLOY.md`
walks through this — don't skip step 2c or no Meet links will be
generated.

## Privacy

- `<meta name="robots" content="noindex, nofollow">` on both pages
  keeps this off Google.
- The reviewer page sits behind a soft password gate (`sessionStorage`
  unlock, same pattern as Next Gen Hub).
- Candidates never see other candidates' names — booked slots simply
  disappear from the candidate-facing list.
- The Sheet is private to Matt. Reviewers don't see it; only Matt and
  Jenny do.

## Where state lives

| What | Where |
|------|-------|
| Reviewer roster (id, name, email) | `REVIEWERS` map in `Code.gs` (mirrored in `reviewer.html` for instant render) |
| Reviewer availability | `Availability` tab in the Google Sheet |
| Bookings + Meet links + calendar event IDs | `Bookings` tab in the Google Sheet |
| Calendar events + Meet conference data | Matt's primary Google Calendar |
| Booking notifications | Matt's Gmail inbox (filterable by `[Video interview booked]` subject prefix) |

## Reviewers (Phase 2 roster — 8 people)

| Name | Email |
|------|-------|
| Matt Stephan | matt@dwellpeninsula.com |
| Karina Wilhelms | kgorbunoff@yahoo.com |
| Eunice Nichols | eunice.nichols@gmail.com |
| Brian Wo | brian@dwellpeninsula.com |
| Lisa Mario | lisa@dwellpeninsula.com |
| Annie Kuo | anniekuo@gmail.com |
| Stacie Ciraulo | sncir2000@yahoo.com |
| Steven Wang | swang011@gmail.com |

## Operational defaults

| Setting | Value | Where to change |
|---------|-------|-----------------|
| Slot length | 30 min, back-to-back possible | `SLOT_MINUTES` in `Code.gs` AND `CONFIG.SLOT_MINUTES` in `reviewer.html` |
| Min panel size | 2 reviewers | `MIN_PANEL_SIZE` in `Code.gs` |
| Window | today → 2026-07-01 | `CONFIG.END_DATE` in `reviewer.html` |
| Daily hours | 8 AM – 8 PM PT | `HOUR_START`/`HOUR_END` in `reviewer.html` |
| Reviewer password | `dwell-video-2026` | `REVIEWER_PASSWORD` in `Code.gs` AND `CONFIG.PASSWORD` in `reviewer.html` |
| Booking notifications | matt@dwellpeninsula.com | `NOTIFY_EMAIL` in `Code.gs` |

## See also

- [DEPLOY.md](DEPLOY.md) — step-by-step setup, ~12 minutes total.
- [../Dwell Interview Scheduler/README.md](../Dwell%20Interview%20Scheduler/README.md) — the Phase 1 phone scheduler (still alive as a separate deployment).
