# Prompt: Capture the missing feature screenshots (per the SmartLife & Budget Balance Platform proposal)

> How to use: open the MuMu emulator (or a real phone) with the SmartLife app logged in and
> ready, make sure `adb` is connected, then open Claude Code (or any terminal running
> Claude) at the `SmartLifeExpo` project path and paste the prompt below into that session.
>
> Note: this must run in a terminal on your actual machine where adb/the emulator are
> reachable (the cloud session that generated the earlier report uses a separate VM with no
> access to adb or your emulator).

---

Context: The SmartLifeExpo project (Expo/React Native) already has feature screenshots in
docs/app-walkthrough/ (files 01 through 12b), captured with adb exec-out screencap -p from
the real app running on the MuMu emulator, using real data — not mocked or edited. I now
need additional screenshots covering the 4 scope areas from the project proposal
("SmartLife & Budget Balance Platform"), specifically the features the proposal describes
that don't have screenshots yet.

Follow these steps:

1. Check that a device is connected with `adb devices`. If none is found, tell me to open
   / connect the emulator first — do not proceed on a guess.
2. Read docs/app-walkthrough/README.md to see the existing caption style and the last file
   number used (currently 12b).
3. For each screen in the list below, do this one at a time:
   a. Tell me in plain text which screen to open in the app, and what needs to be set up
      or entered first (if anything).
   b. Wait for me to confirm I'm on that screen (I'll type "ok" or "ready") before capturing
      — never guess which screen is showing and capture anyway.
   c. Run: adb exec-out screencap -p > docs/app-walkthrough/<filename>.png
   d. Open the resulting image and check it isn't blank or showing an error before moving
      to the next item. Recapture if it looks wrong.
4. Once all screenshots are captured, update the table in docs/app-walkthrough/README.md
   with a new row for every file, using the same caption style as the existing entries
   (short, specific, describing what's actually visible in the image).
5. Give me a summary of what was captured and what's still missing — if a feature in the
   list isn't actually implemented in the app yet (it's still just a proposal concept),
   tell me directly and skip it rather than capturing an unrelated screen instead.

## Screens to capture (grouped by the 4 proposal scope areas)

### 1) Unified Dashboard
- 13-ai-assistant-voice-query.png — AI Assistant answering a real question, e.g. "What
  time is my class today?" or "How much do I have left for food?" (must show an actual
  answer in the chat, not an empty screen)
- 14-dashboard-priority-day.png — Dashboard on a day with an exam or urgent task, showing
  the system pushing the important notification to the top (AI Dynamic Prioritization) —
  if this logic isn't actually implemented yet, tell me and skip it

### 2) Smart Schedule Importer
- 15-schedule-import-upload.png — The timetable photo upload screen, before pressing scan
- 16-schedule-import-ocr-result.png — The result after OCR extracts subject codes, times,
  and rooms from the timetable photo, with a confirmation step
- 17-calendar-sync-confirmed.png — A confirmed Google Calendar sync status (only capture
  if it's meaningfully different from the existing 02-calendar-week.png)

### 3) Smart Schedule Builder
- 18-burnout-risk-analysis.png — The AI Burnout Predictor screen showing the analysis of
  study time vs. sleep time and the resulting burnout risk level
- 19-burnout-coach-message.png — The encouraging message / short-break recommendation from
  the AI Coach

### 4) Personal Finance Tracker
- 20-finance-overview.png — The finance summary screen (income/expense by day/week/month)
- 21-receipt-scan-result-categorized.png — The result after scanning one real receipt,
  showing the system auto-tagging the category (e.g. tagging it "Food" automatically) —
  pairs with the existing 09-receipt-scan.png, which only shows the empty state
- 22-budget-alert.png — The alert shown when spending goes over the set budget (only if
  this feature actually exists)

## Final note

If any feature in this list isn't actually implemented in the app (e.g. AI Dynamic
Prioritization, Burnout Predictor, or Budget Alert may still just be proposal concepts
that haven't been built), tell me directly in the step-5 summary instead of trying to
capture an unrelated screen as a substitute — so it can be listed as "future work" in the
report/slides instead of causing an awkward moment during the presentation Q&A.
