# Deploy guide — Dwell Video Interview Scheduler

Total time: ~12 minutes. Five things:

1. Create a Google Sheet (the "database")
2. Paste `Code.gs` into a new Apps Script project, point it at the Sheet, **enable the advanced Calendar API**, deploy
3. Plug the Apps Script URL into the two HTML pages
4. Push the repo to GitHub and turn on Pages
5. Smoke-test end-to-end before going live

You don't need a credit card, a domain, or any paid services.

---

## 1. Create the Google Sheet

1. Go to **https://sheets.google.com** while signed in as
   `matt@dwellpeninsula.com`.
2. Create a new blank spreadsheet. Title it **"Dwell Video Interview Scheduler — DB"**.
3. Rename the default tab `Reviewers`. Then create two more tabs (➕ at
   the bottom-left): `Availability` and `Bookings`.

   The `Reviewers` tab will be auto-populated by a helper function
   (don't worry about its headers yet). For the other two, paste these
   header rows into row 1:

   **`Availability` tab — row 1:**
   ```
   reviewer_id    start_iso    end_iso    created_at
   ```

   **`Bookings` tab — row 1** (note the schema changes from Phase 1 — `panel_reviewers` and `meet_link` are new):
   ```
   id    start_iso    end_iso    panel_reviewers    candidate_name    candidate_email    candidate_phone    status    calendar_event_id    meet_link    created_at
   ```

4. Copy the Sheet's **file ID** from the URL — it's the long opaque
   string between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART_HERE`**`/edit`
5. Save that ID — you'll paste it in the next step.

---

## 2. Create the Apps Script project

1. Go to **https://script.google.com** while signed in as the same
   account that owns the Sheet.
2. Click **New project**. Rename it to **"Dwell Video Interview Scheduler"**.
3. In the editor, delete the placeholder `function myFunction()` and
   paste the contents of `apps-script/Code.gs` from this repo.
4. At the top of the file, replace the value of `SHEET_ID` with the
   file ID you copied from the Sheet. The line should look like:
   ```js
   const SHEET_ID = "1AbC2dEf3GhI4jKl5MnO6pQ7rS8tU9vWx";
   ```
5. **Save** (⌘S / Ctrl+S).

### 2a. Enable the advanced Calendar API (CRITICAL — this is what generates Meet links)

The basic `CalendarApp` service can't add Google Meet conference data.
We use the **advanced Calendar API** instead. It's a one-click enable.

1. In the left sidebar of the Apps Script editor, find **Services** (a
   `+` icon).
2. Click **+ Add a service**.
3. Find **Google Calendar API** in the list. Click it.
4. The **Identifier** field should already say `Calendar`. **Leave it
   as `Calendar`** — that's what `Code.gs` references. If you change
   it, the booking action will fail with `ReferenceError: Calendar is
   not defined`.
5. Click **Add**.

You should now see `Calendar` under Services in the sidebar. If it
shows a version number like `v3`, you're good.

### 2b. Authorize the script (one-time)

1. In the function dropdown above the editor, select **`authorize`**.
2. Click **▶ Run**.
3. A dialog appears: "Authorization required". Click **Review permissions**.
4. Pick the `matt@dwellpeninsula.com` account.
5. You'll see "Google hasn't verified this app." Click **Advanced** →
   **Go to Dwell Video Interview Scheduler (unsafe)**. (Safe — it's
   our own code. Google just hasn't gone through formal verification,
   which is for public-facing apps.)
6. Approve the requested permissions:
   - See, edit, create, and delete your spreadsheets in Google Drive
   - View and edit events on all your calendars
   - Send email as you
7. The function should finish with no errors. Check the **Execution
   log** at the bottom — last line should say "Authorization complete."

### 2c. Seed the Reviewers tab

1. In the function dropdown, select **`seedReviewers`**.
2. Click **▶ Run**.
3. Open the Sheet → `Reviewers` tab. You should see eight rows with
   names, slugs, and emails. If you change names or emails later,
   update the `REVIEWERS` map at the top of `Code.gs` and re-run
   `seedReviewers`.

### 2d. Deploy as a web app

1. Top-right: **Deploy** → **New deployment**.
2. Click the gear ⚙ next to "Select type" → **Web app**.
3. Fill in:
   - **Description**: `v1`
   - **Execute as**: **Me (matt@dwellpeninsula.com)**
   - **Who has access**: **Anyone** (this allows non-signed-in
     candidates to POST without each having to log into Google)
4. Click **Deploy**.
5. Copy the **Web app URL**. It looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`
6. Save it — you'll paste it into the two HTML files next.

---

## 3. Paste the Apps Script URL into the HTML pages

In **`index.html`**, find the `CONFIG` block near the bottom of the
file and replace `REPLACE_ME_AFTER_DEPLOYING_APPS_SCRIPT` with the URL
you just copied:
```js
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycb.../exec",
};
```

Do the same in **`reviewer.html`**. Same value, both files.

While you're in `reviewer.html`, also confirm that `CONFIG.PASSWORD`
matches `REVIEWER_PASSWORD` in `Code.gs`. They both default to
`dwell-video-2026`. If you change it in one place, change it in the
other.

---

## 4. Push to GitHub and enable Pages

1. Create a new GitHub repo named `dwell-video-interview-scheduler`
   (under your personal account or the Dwell org). Make it public —
   GitHub Pages needs the repo to be public for the free tier.
2. From the project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial deploy"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/dwell-video-interview-scheduler.git
   git push -u origin main
   ```
3. On GitHub: **Settings** → **Pages**.
4. **Source**: Deploy from a branch. **Branch**: `main`, folder
   `/ (root)`. Click **Save**.
5. Wait ~30 seconds. Pages will publish at:
   `https://YOUR_USERNAME.github.io/dwell-video-interview-scheduler/`

Two URLs to share:
- **Reviewers**: `https://YOUR_USERNAME.github.io/dwell-video-interview-scheduler/reviewer.html`
- **Candidates**: `https://YOUR_USERNAME.github.io/dwell-video-interview-scheduler/`

---

## 5. Smoke-test before going live

Run through this end-to-end before the URL goes anywhere near a real
candidate. Phase 2 has one piece Phase 1 didn't — Meet link
generation — so verify that explicitly.

1. Open `reviewer.html`, enter the password. Pick **your own name**
   (Matt). Paint 6–8 slots in the next two days. Save. Confirm the
   success message says "Saved — N slots on the calendar."
2. Open `reviewer.html` in an incognito window. Pick **a second
   reviewer** (whichever account you also have access to — or ask
   Jenny to run this step). Paint a few of the same slots Matt
   painted. Save.
3. Open the Sheet → `Availability` tab. Confirm rows for both
   reviewers with overlapping `start_iso` values.
4. Open `index.html` (no password, public). You should see slots
   labeled "2-person panel · Matt Stephan, [other name]" for the
   overlapping times. If you don't, run the Apps Script function
   `debugDumpPanelSlots` from the editor (Function dropdown → ▶ Run)
   and check the Execution log.
5. Click a slot. Fill in fake name / email / phone (use a real email
   you can check). Hit "Confirm booking."
6. You should see the green confirmation panel within ~2 seconds.
7. Check the candidate email: there should be a Google Calendar invite
   **with a Google Meet link visible in the event body**. If there's
   no Meet link, the most likely cause is step 2a — the advanced
   Calendar API isn't enabled or got renamed.
8. Check Matt's Gmail: there should be a `[Video interview booked]`
   notification with the panel composition and Meet link.
9. Check Google Calendar: the event should be on Matt's calendar at
   the right time, with all panel reviewer emails + the candidate
   email attached, and a Google Meet conference attached.
10. Refresh the candidate page. The slot you booked should be gone
    (because the panel size dropped, or the slot was claimed).
11. Open the Sheet → `Bookings` tab. Your booking row should be
    there, including a populated `meet_link` column.

If any step fails, the **Execution log** in the Apps Script editor
(View → Executions) shows what the backend saw — that's where to
debug.

---

## 6. Roll out to reviewers

Once smoke test passes:

1. Delete the test booking row from the `Bookings` tab in the Sheet
   (and delete the test event from Matt's Google Calendar).
2. Have each reviewer un-paint their test slots if any are left over
   (or run `cleanupOrphanedRows` from the editor if there's any
   orphan data — see below).
3. Email the eight reviewers the **reviewer URL** + the password +
   instructions: "Please paint any times you can do a 30-minute
   Google Meet between Wed May 27 and Wed July 1."
4. Once at least 3-4 reviewers have posted availability, share the
   **candidate URL** with the candidates.

---

## Operational notes

**If the booking creates a Calendar event without a Meet link.** This
almost always means the advanced Calendar API service didn't get
enabled (step 2a). Open the Apps Script editor → Services → confirm
`Calendar` is listed. If not, add it. Then redeploy a new version
(Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy).

**If a candidate reports the page is broken.** First place to look:
Apps Script → **Executions** (left sidebar). Each `doGet` and `doPost`
shows up there with timing and any errors. Most issues are auth
(re-run `authorize`) or a typo in `SHEET_ID`.

**If a reviewer needs to remove a slot they painted.** Have them open
`reviewer.html`, pick their name, click the painted slot to un-select
it, hit Save. The POST replaces their full schedule.

**If a candidate needs to cancel.** Open the Sheet → `Bookings` tab,
find their row, change the `status` cell from `confirmed` to
`cancelled`. The slot will reappear as a panel option (if enough
reviewers are still available). Manually delete the Google Calendar
event too (or let it sit if the panel already has the invite).

**If you want fuller panels (3+ instead of 2).** Edit `MIN_PANEL_SIZE`
at the top of `Code.gs` and redeploy. The candidate page will
immediately offer fewer, larger slots on its next load.

**If you need to change the reviewer password.** Update both
`REVIEWER_PASSWORD` in `Code.gs` AND `CONFIG.PASSWORD` in
`reviewer.html`, then redeploy the Apps Script (Deploy → Manage
deployments → ✏️ Edit → Version: New version → Deploy) and push the
HTML change to GitHub.

**If you change anything in `Code.gs`.** You must redeploy a new
version: Deploy → Manage deployments → ✏️ Edit → Version: New version
→ Deploy. The web app URL stays the same.

**If the audit (`auditAvailability`) shows orphan rows.** Run
`cleanupOrphanedRows` from the editor. Safe to re-run any time.
