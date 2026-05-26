/**
 * Dwell Video Interview Scheduler — backend (Phase 2)
 *
 * Apps Script web app that powers two static pages on GitHub Pages:
 *   - reviewer.html — reviewers paint their availability on a calendar grid
 *   - index.html    — candidates pick a 30-min PANEL slot (multiple
 *                     reviewers simultaneously available) and get auto-
 *                     invited to a Google Meet with all of them.
 *
 * State lives in a Google Sheet (acts as a tiny "database"). Calendar
 * invites + Google Meet links are sent via the advanced Calendar API
 * (Calendar.Events.insert), which is what lets us attach Meet conference
 * data — the simpler CalendarApp.createEvent() can't generate Meet links.
 *
 * Runs as Matt's Google account, so it inherits Matt's Sheet, Calendar,
 * and Mail permissions.
 *
 * Deploy:
 *   1. Open https://script.google.com → New project → paste this file as Code.gs.
 *   2. Fill in SHEET_ID below (the file ID of the backing Google Sheet).
 *   3. Services panel (left sidebar) → ➕ → "Google Calendar API" → Add.
 *      The identifier MUST stay as "Calendar" (that's what this file uses).
 *   4. Function dropdown → "authorize" → ▶ Run → approve permissions.
 *   5. Function dropdown → "seedReviewers" → ▶ Run → check Reviewers tab.
 *   6. Deploy → New deployment → Web app
 *      Execute as: Me (matt@dwellpeninsula.com)
 *      Who has access: Anyone
 *   7. Copy the /macros/s/.../exec URL into:
 *        index.html    → CONFIG.APPS_SCRIPT_URL
 *        reviewer.html → CONFIG.APPS_SCRIPT_URL
 */

// =====================================================================
// Configuration
// =====================================================================

// File ID of the backing Google Sheet. Get it from the URL of the sheet,
// the long opaque string between /d/ and /edit. The sheet must have three
// tabs (DEPLOY.md walks through creating them):
//   Reviewers    — id, name, email
//   Availability — reviewer_id, start_iso, end_iso, created_at
//   Bookings     — id, start_iso, end_iso, panel_reviewers, candidate_name,
//                  candidate_email, candidate_phone, status,
//                  calendar_event_id, meet_link, created_at
const SHEET_ID = "16cxcoRG0X2gHp94wsQfThF8CBVeuDl1Us6XsAb2SiQI";

// Static reviewer roster — slug → {name, email}. Eight people for Phase 2.
// If it changes, update this AND the REVIEWERS array in reviewer.html
// (kept in sync by hand on purpose; we want reviewers visible at page-load
// even if the backend is slow to respond). index.html does not need a
// roster — candidates don't pick reviewers, panels are computed server-side.
const REVIEWERS = {
  "matt-stephan":     { name: "Matt Stephan",     email: "matt@dwellpeninsula.com" },
  "karina-wilhelms":  { name: "Karina Wilhelms",  email: "kgorbunoff@yahoo.com" },
  "eunice-nichols":   { name: "Eunice Nichols",   email: "eunice.nichols@gmail.com" },
  "brian-wo":         { name: "Brian Wo",         email: "brian@dwellpeninsula.com" },
  "lisa-mario":       { name: "Lisa Mario",       email: "lisa@dwellpeninsula.com" },
  "annie-kuo":        { name: "Annie Kuo",        email: "anniekuo@gmail.com" },
  "stacie-ciraulo":   { name: "Stacie Ciraulo",   email: "sncir2000@yahoo.com" },
  "steven-wang":      { name: "Steven Wang",      email: "swang011@gmail.com" },
};

// Soft password for the reviewer page. Anyone with this URL + password
// can submit availability on behalf of any reviewer (they pick their own
// name from a dropdown). Not real security — change it in one place if
// it leaks. Candidate page is fully public, no password.
const REVIEWER_PASSWORD = "dwell-video-2026";

// Slot length in minutes. 30 = 30-min video call, back-to-back possible
// (no buffer). Reviewers paint the grid at this granularity.
const SLOT_MINUTES = 30;

// Minimum number of reviewers that must be simultaneously available for
// a slot to be offered to candidates. 2 lets candidates see more
// availability; raising to 3 forces fuller panels at the cost of
// fewer bookable slots. Tune as needed.
const MIN_PANEL_SIZE = 2;

// Where booking notifications go. Matt's inbox is the default — Jenny
// (the AI agent) can scan for the "[Video interview booked]" subject
// prefix or read the Bookings tab directly. Set to "" to disable email
// notifications (sheet writes still happen).
const NOTIFY_EMAIL = "matt@dwellpeninsula.com";

// =====================================================================
// HTTP handlers
// =====================================================================

/**
 * GET routes — used by both pages on initial load.
 *   ?action=ping                       → health check
 *   ?action=reviewers                  → list of {id, name}
 *   ?action=availability&reviewer=ID   → that reviewer's painted slots
 *                                        (used by reviewer.html for re-edit)
 *   ?action=panel_slots                → all future slots where at least
 *                                        MIN_PANEL_SIZE reviewers are free,
 *                                        with the list of who's available.
 *                                        Used by the candidate page.
 *   ?action=audit&password=PW          → DIAGNOSTIC: every row in the
 *                                        Availability tab grouped by
 *                                        reviewer_id, plus orphans.
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === "ping")          return jsonResponse({ ok: true, msg: "video scheduler alive" });
    if (p.action === "reviewers")     return jsonResponse({ ok: true, reviewers: listReviewers() });
    if (p.action === "availability")  return jsonResponse({ ok: true, slots: getReviewerPaintedSlots(p.reviewer) });
    if (p.action === "panel_slots")   return jsonResponse({ ok: true, slots: getPanelSlots() });
    if (p.action === "audit") {
      if (p.password !== REVIEWER_PASSWORD) return jsonResponse({ ok: false, error: "bad password" });
      return jsonResponse({ ok: true, audit: auditAvailability() });
    }
    return textResponse("Dwell Video Interview Scheduler — alive.\nTry ?action=panel_slots");
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * POST routes:
 *   action=postAvailability  → reviewer submits a fresh availability set
 *   action=book              → candidate claims a panel slot
 *
 * The static pages POST as multipart/form-data with mode "no-cors" so
 * they don't need CORS headers (Apps Script doesn't return them on POST).
 * Tradeoff: the page can't read the response body — it shows a generic
 * "submitted" message and re-fetches state to confirm.
 */
function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === "postAvailability")  return jsonResponse(handlePostAvailability(p));
    if (p.action === "book")              return jsonResponse(handleBook(p));
    return jsonResponse({ ok: false, error: "unknown action: " + (p.action || "(none)") });
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

// =====================================================================
// Public read API
// =====================================================================

function listReviewers() {
  return Object.keys(REVIEWERS).map(id => ({ id: id, name: REVIEWERS[id].name }));
}

/**
 * Return a single reviewer's painted slots — used by reviewer.html to
 * re-render their existing schedule when they reopen the page. Booked
 * slots get a `booked: true` flag so the page can dim them.
 */
function getReviewerPaintedSlots(reviewerId) {
  if (!reviewerId || !REVIEWERS[reviewerId]) return [];

  const ss = SpreadsheetApp.openById(SHEET_ID);

  const availSheet = ss.getSheetByName("Availability");
  const availData = availSheet.getDataRange().getValues();
  availData.shift(); // drop header
  const slots = availData
    .filter(r => r[0] === reviewerId && r[1] && r[2])
    .map(r => ({ start: toIso(r[1]), end: toIso(r[2]) }));

  const bookedStarts = getBookedStartIsos();

  return slots
    .map(s => ({ start: s.start, end: s.end, booked: bookedStarts.has(s.start) }))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/**
 * The headline function. Returns all future 30-min blocks where at least
 * MIN_PANEL_SIZE reviewers are simultaneously available and the slot
 * hasn't already been booked.
 *
 * Approach: every painted slot is on a canonical 30-min boundary (because
 * reviewers paint the same grid), so a "panel slot" is just a start_iso
 * value that appears in availability rows for >= MIN_PANEL_SIZE distinct
 * reviewer_ids. Group, count, filter. O(rows) — fast at any realistic
 * scale (under 10k availability rows).
 *
 * Returns: [
 *   {
 *     start: ISO string,
 *     end: ISO string,
 *     available_reviewers: [{id, name}, ...],  // sorted alphabetical
 *     panel_size: number
 *   }, ...
 * ]
 */
function getPanelSlots() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const availSheet = ss.getSheetByName("Availability");
  const availData = availSheet.getDataRange().getValues();
  availData.shift(); // drop header

  // start_iso → { end, reviewer_ids: Set<string> }
  const grouped = {};
  availData.forEach(r => {
    if (!r[0] || !r[1] || !r[2]) return;
    if (!REVIEWERS[r[0]]) return;  // ignore orphans
    const startIso = toIso(r[1]);
    if (!grouped[startIso]) {
      grouped[startIso] = { end: toIso(r[2]), reviewers: new Set() };
    }
    grouped[startIso].reviewers.add(r[0]);
  });

  const bookedStarts = getBookedStartIsos();
  const nowMs = Date.now();

  const slots = [];
  Object.keys(grouped).forEach(startIso => {
    if (new Date(startIso).getTime() < nowMs) return; // past
    if (bookedStarts.has(startIso)) return;            // already taken
    const g = grouped[startIso];
    if (g.reviewers.size < MIN_PANEL_SIZE) return;     // panel too small

    const reviewerList = Array.from(g.reviewers)
      .map(id => ({ id: id, name: REVIEWERS[id].name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    slots.push({
      start: startIso,
      end: g.end,
      available_reviewers: reviewerList,
      panel_size: reviewerList.length,
    });
  });

  return slots.sort((a, b) => new Date(a.start) - new Date(b.start));
}

/**
 * Set of start_iso strings for every NON-cancelled booking. Used to hide
 * already-claimed slots from both the candidate page and the reviewer
 * "re-edit" view.
 */
function getBookedStartIsos() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const bookSheet = ss.getSheetByName("Bookings");
  const data = bookSheet.getDataRange().getValues();
  data.shift(); // drop header
  // Bookings schema: id, start_iso, end_iso, panel_reviewers, candidate_name, ...
  return new Set(
    data
      .filter(r => r[1] && r[7] !== "cancelled")
      .map(r => toIso(r[1]))
  );
}

// =====================================================================
// Reviewer write: post availability
// =====================================================================

/**
 * Replace this reviewer's availability with the freshly-painted grid.
 * "Replace" (not "append") matches the mental model — reviewers paint
 * the whole week at once, not slot-by-slot.
 *
 * Body fields (form-encoded):
 *   action      : "postAvailability"
 *   password    : must match REVIEWER_PASSWORD
 *   reviewer_id : slug from REVIEWERS
 *   slots       : JSON-stringified array of { start, end } (ISO strings)
 */
function handlePostAvailability(p) {
  if (p.password !== REVIEWER_PASSWORD)        return { ok: false, error: "bad password" };
  const reviewerId = p.reviewer_id;
  if (!reviewerId || !REVIEWERS[reviewerId])   return { ok: false, error: "unknown reviewer" };

  let slots;
  try { slots = JSON.parse(p.slots || "[]"); }
  catch (err) { return { ok: false, error: "bad slots JSON" }; }
  if (!Array.isArray(slots))                   return { ok: false, error: "slots must be an array" };

  // Lock so two reviewers (or two tabs) submitting at once can't
  // interleave deletions with appends.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))                    return { ok: false, error: "server busy, retry" };

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("Availability");
    const data = sheet.getDataRange().getValues();

    // Walk bottom-up so deleting a row doesn't shift the indices we
    // haven't visited yet.
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === reviewerId) sheet.deleteRow(i + 1);
    }

    if (slots.length > 0) {
      const now = new Date();
      const rows = slots.map(s => [reviewerId, s.start, s.end, now]);
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    }

    return { ok: true, slots_saved: slots.length };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Candidate write: book a panel slot (with Google Meet)
// =====================================================================

/**
 * Atomically claim a panel slot:
 *   1. Lock
 *   2. Re-check that the slot still has >= MIN_PANEL_SIZE available
 *      reviewers (guards against the race where a reviewer un-painted
 *      between the candidate's GET and POST).
 *   3. Create the Calendar event with Meet conference data, inviting
 *      ALL currently-available reviewers + the candidate.
 *   4. Append the booking row, including the comma-separated panel.
 *   5. Notify Matt's inbox.
 *   6. Unlock.
 *
 * Body fields (form-encoded):
 *   action            : "book"
 *   slot_start        : ISO string (must match a current panel slot)
 *   slot_end          : ISO string (slot_start + SLOT_MINUTES)
 *   candidate_name    : full name
 *   candidate_email   : email (Calendar invite + Meet link goes here)
 *   candidate_phone   : phone (backup contact)
 */
function handleBook(p) {
  const start  = p.slot_start;
  const end    = p.slot_end;
  const cName  = (p.candidate_name  || "").trim();
  const cEmail = (p.candidate_email || "").trim();
  const cPhone = (p.candidate_phone || "").trim();

  if (!start || !end)                         return { ok: false, error: "missing slot times" };
  if (!cName || !cEmail || !cPhone)           return { ok: false, error: "name, email, and phone are all required" };
  if (!isValidEmail(cEmail))                  return { ok: false, error: "that email looks invalid" };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))                   return { ok: false, error: "server busy, retry" };

  try {
    // Re-validate inside the lock — between the candidate's GET and POST,
    // someone may have grabbed this slot or a reviewer may have removed
    // availability. Better to fail clean here than to double-book or
    // to send a Meet invite to a too-small panel.
    const currentPanel = getPanelSlots().find(s => s.start === start);
    if (!currentPanel) {
      return { ok: false, error: "that slot just changed — please pick another" };
    }

    const startDt  = new Date(start);
    const endDt    = new Date(end);

    // Collect reviewer email list for the invite.
    const reviewerEmails = currentPanel.available_reviewers.map(r => REVIEWERS[r.id].email);
    const reviewerNames  = currentPanel.available_reviewers.map(r => r.name).join(", ");
    const reviewerIds    = currentPanel.available_reviewers.map(r => r.id).join(",");

    // Build the Calendar event via the ADVANCED Calendar API service
    // (not CalendarApp). This is the only way to attach Google Meet
    // conference data from Apps Script. Requires the Calendar advanced
    // service to be enabled in the editor — see DEPLOY.md step 2c.
    const requestId = "dwell-vid-" + Utilities.getUuid();
    const eventBody = {
      summary: "Dwell video interview — " + cName + " × Dwell panel",
      description:
        "Video interview for Dwell Church.\n\n" +
        "Panel: " + reviewerNames + "\n" +
        "Candidate: " + cName + " (" + cEmail + ")\n" +
        "Candidate phone (backup): " + cPhone + "\n\n" +
        "Join via the Google Meet link in this calendar invite at the\n" +
        "scheduled time. The candidate joins from the link too.\n\n" +
        "Booked via the Dwell video interview scheduler.",
      start: { dateTime: startDt.toISOString(), timeZone: "America/Los_Angeles" },
      end:   { dateTime: endDt.toISOString(),   timeZone: "America/Los_Angeles" },
      attendees: reviewerEmails.concat([cEmail]).map(em => ({ email: em })),
      conferenceData: {
        createRequest: {
          requestId: requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: { useDefault: true },
    };

    const createdEvent = Calendar.Events.insert(eventBody, "primary", {
      conferenceDataVersion: 1,
      sendUpdates: "all",
    });

    // Extract the Meet link. The advanced API returns it under
    // hangoutLink for backward compat AND inside conferenceData.entryPoints.
    const meetLink = createdEvent.hangoutLink || extractMeetLink(createdEvent.conferenceData);

    // Append the booking row. Sheet schema:
    //   id, start_iso, end_iso, panel_reviewers, candidate_name,
    //   candidate_email, candidate_phone, status, calendar_event_id,
    //   meet_link, created_at
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const bSheet = ss.getSheetByName("Bookings");
    const bookingId = Utilities.getUuid();
    bSheet.appendRow([
      bookingId,
      start,
      end,
      reviewerIds,
      cName,
      cEmail,
      cPhone,
      "confirmed",
      createdEvent.id,
      meetLink || "",
      new Date(),
    ]);

    // Notify Matt's inbox. Failure here shouldn't fail the booking —
    // the calendar invites already went out, the sheet row is written.
    if (NOTIFY_EMAIL) {
      try {
        MailApp.sendEmail({
          to: NOTIFY_EMAIL,
          subject: "[Video interview booked] " + cName + " × " + currentPanel.panel_size + "-person panel",
          body:
            "A new video interview was just booked.\n\n" +
            "Panel (" + currentPanel.panel_size + "): " + reviewerNames + "\n" +
            "Candidate: " + cName + "\n" +
            "Email: " + cEmail + "\n" +
            "Phone (backup): " + cPhone + "\n\n" +
            "Time: " + formatPT(startDt) + " — " + formatPT(endDt) + "\n" +
            "Meet link: " + (meetLink || "(check the Calendar event)") + "\n\n" +
            "Booking ID: " + bookingId + "\n" +
            "Calendar event: " + createdEvent.id + "\n\n" +
            "All panel reviewers + candidate have been auto-invited via Calendar.",
        });
      } catch (mailErr) {
        console.warn("notification email failed: " + mailErr);
      }
    }

    return {
      ok: true,
      booking_id: bookingId,
      calendar_event_id: createdEvent.id,
      meet_link: meetLink,
      panel_size: currentPanel.panel_size,
    };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Pull the Meet URL out of the conferenceData entryPoints array. Google
 * sometimes returns the link only here (not on hangoutLink) on the first
 * insert response, so we check both.
 */
function extractMeetLink(conferenceData) {
  if (!conferenceData || !conferenceData.entryPoints) return null;
  const video = conferenceData.entryPoints.find(ep => ep.entryPointType === "video");
  return video ? video.uri : null;
}

/**
 * Sheets stores Date cells as native Date objects, but ISO strings if a
 * value was written as a string. Normalize either to an ISO string so
 * comparisons are stable.
 */
function toIso(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function formatPT(d) {
  return Utilities.formatDate(d, "America/Los_Angeles", "EEE MMM d, h:mm a 'PT'");
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function textResponse(msg) {
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}

// =====================================================================
// One-time setup helpers (run from the Apps Script editor)
// =====================================================================

/**
 * Run this once after pasting in the code (▶ Run with "authorize"
 * selected in the function dropdown). It touches every Google API the
 * web app uses — Sheets, Calendar (both basic and advanced), Mail — so
 * Apps Script's permission scanner asks for all the needed scopes in a
 * single auth dialog.
 *
 * Without this step you'd get partial-permission errors at first request.
 */
function authorize() {
  if (SHEET_ID === "REPLACE_ME_AFTER_CREATING_SHEET") {
    throw new Error("Fill in SHEET_ID first (top of this file), then re-run authorize.");
  }
  SpreadsheetApp.openById(SHEET_ID);  // Sheets scope
  CalendarApp.getDefaultCalendar();    // basic Calendar scope (used incidentally)
  Calendar.CalendarList.list();        // advanced Calendar scope — required for Meet
  MailApp.getRemainingDailyQuota();    // Mail scope
  console.log("Authorization complete. Now redeploy as a new version: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.");
}

/**
 * Run this once to populate the Reviewers tab with the static REVIEWERS
 * map above. Idempotent — running again clears the tab and rewrites it,
 * which is what you want if you've changed names or emails.
 */
function seedReviewers() {
  if (SHEET_ID === "REPLACE_ME_AFTER_CREATING_SHEET") {
    throw new Error("Fill in SHEET_ID first.");
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Reviewers") || ss.insertSheet("Reviewers");
  sheet.clear();
  sheet.appendRow(["id", "name", "email"]);
  Object.keys(REVIEWERS).forEach(id => {
    sheet.appendRow([id, REVIEWERS[id].name, REVIEWERS[id].email]);
  });
  console.log("Seeded " + Object.keys(REVIEWERS).length + " reviewers.");
}

/**
 * Convenience for end-to-end verification: prints the panel slot list
 * to the Apps Script log. Run after a few reviewers have posted
 * availability to confirm intersection math is working.
 */
function debugDumpPanelSlots() {
  const slots = getPanelSlots();
  console.log("Panel slots (>= " + MIN_PANEL_SIZE + " reviewers): " + slots.length);
  slots.slice(0, 10).forEach(s => {
    console.log("  " + s.start + " — " + s.panel_size + " reviewers: " +
                s.available_reviewers.map(r => r.name).join(", "));
  });
}

// =====================================================================
// Diagnostics & cleanup
// =====================================================================

/**
 * Walk the Availability tab and group every row by its reviewer_id. The
 * result has one bucket per known reviewer plus an `_orphans` bucket for
 * any row whose reviewer_id isn't in the REVIEWERS map (manual edit,
 * typo, or stale slug from a removed reviewer).
 */
function auditAvailability() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Availability");
  const data = sheet.getDataRange().getValues();
  data.shift(); // drop header

  const buckets = { _orphans: [] };
  Object.keys(REVIEWERS).forEach(id => { buckets[id] = []; });

  data.forEach((r, i) => {
    if (!r[1] || !r[2]) return; // skip empty rows
    const rowEntry = {
      sheet_row: i + 2, // +2: 1 for 0-index, 1 for header
      reviewer_id: r[0],
      start: toIso(r[1]),
      end: toIso(r[2]),
      created_at: r[3] ? toIso(r[3]) : null,
    };
    if (buckets[r[0]] !== undefined) buckets[r[0]].push(rowEntry);
    else                              buckets._orphans.push(rowEntry);
  });

  const summary = { total_rows: data.length, orphan_rows: buckets._orphans.length };
  Object.keys(REVIEWERS).forEach(id => {
    summary[id] = buckets[id].length;
  });
  return { summary: summary, by_reviewer: buckets };
}

/**
 * Run if `auditAvailability` shows orphan rows — rows whose reviewer_id
 * isn't one of the valid slugs. Deletes them and logs what was removed.
 * SAFE to re-run; does nothing if the sheet is clean.
 */
function cleanupOrphanedRows() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Availability");
  const data = sheet.getDataRange().getValues();

  let removed = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    const reviewerId = data[i][0];
    if (!reviewerId || REVIEWERS[reviewerId] === undefined) {
      console.log("Removing orphan row " + (i + 1) + ": reviewer_id=" + JSON.stringify(reviewerId) +
                  " start=" + data[i][1] + " end=" + data[i][2]);
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  console.log("Removed " + removed + " orphan row(s).");
}
