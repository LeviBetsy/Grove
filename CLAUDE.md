# CLAUDE.md

## What this project is

**Grove** is a personal, forest-themed progress tracker that runs locally on my laptop. I use it to
enter **projects** (long-running goals like a thesis) and **daily routines** (checklists like
"Get out of bed" or "Bedtime"), then track my progress on them through the day. Each tracker is
shown as a potion flask that fills from 0 to 100%, with a pixel-art hero walking along the top
and a log of my progress (the Trail log) below.

It is a single-user app. It has no accounts, no cloud and no build step.

**It runs on my Mac and is used in a desktop browser on that Mac, not on a phone.** Design and
test for a laptop screen with a mouse/trackpad and keyboard. Mobile layouts and touch support are
not a priority, so don't spend effort on them unless I ask.

## Running it

```bash
npm start            # = node server.js → http://localhost:4321
PORT=5000 npm start  # different port
GROVE_DATA_DIR=/some/dir npm start  # keep the data files somewhere else
```

- Needs Node 18+. **There are no dependencies.** Keep it that way: use only Node built-ins on the
  server and vanilla JS (ES modules) in the browser, with no bundler or framework.
- The server binds to `127.0.0.1` only.
- No test suite or linter exists. To check a change, run the server and use the app, or `curl` the API.

## Layout

| Path | Role |
| --- | --- |
| `server.js` | The whole backend: an `http` server, a JSON API, static file serving and persistence |
| `public/index.html` | Page markup: topbar (Grove logo button `#groveBtn`, tabs, Routines menu, Archive menu, ＋ Plant button), stage (plant view + project view with stage bars `#legs`), trail section `#trail` (the Trail log; there is no chart or stats panel, removed on purpose), editor sheet `<dialog id="sheet">` |
| `public/app.js` | All frontend logic: forest backdrop (with a 20-minute day/night cycle: `skyAt`/`tickSky` set CSS variables on `.forest`, and on the pop-out's copy), `Flask` class (SVG potion + hero animation), state, rendering, actions, event wiring |
| `public/sprite.js` | Pixel-art hero drawn from character grids (`HEAD`, `BODY`, `LEGS`) and a `PALETTE` |
| `public/style.css` | Forest/night theme |
| `data/projects.json` | **My real data.** All trackers and their history |
| `data/templates.json` | Routine definitions, edited in the app or by hand |

## Two kinds of tracker

All live in `db.projects` and share the same base shape:
`{ id, name, createdAt, progress, history: [{ at, value, delta, note, kind? }] }`.
The kind is detected by shape: `tasks` → routine, `stages` → journey.

There used to be a third kind, the **plain project** (neither `tasks` nor `stages`, filled by hand
via `POST .../progress`). It was removed: `migratePlainProjects()` in `server.js` turns any such
record into a one-stage journey at startup (stage `s1` named after the project, share 100, history
entries given `stage/stageFrom/stageTo` so undo works) and keeps the original file as
`projects.json.before-journeys.bak`. `/progress` now only returns an error. Don't bring plain
projects back.

New trackers are planted from the **plant view** (`#empty`): shown when nothing is active, either
because nothing exists yet or via the topbar **＋ Plant** button (`openPlantView`, which remembers
`plantReturnId` for "← Back"/Esc). It has Journey / Routine cards (`plantKind`) and a name
form. Both open the **editor sheet** (`#sheet`,
`openSheet(mode, { item, name })`). The sheet edits name + percent rows; `EDITORS` in `app.js` holds
the wording and rules per mode (routine: total ≤ 100; journey: total exactly 100).

1. **Routine instance.** Created from a template in `data/templates.json`, one per template per
   **local calendar day** (`date: "YYYY-MM-DD"`). It is named like `Bedtime Nov 15` and carries
   `templateId`, `date`, `tasks: [{ id, name, percent, done, doneAt }]` and `completed`. Progress
   is **derived from tasks**: the sum of `percent` for done tasks, capped at 100, or 100 once
   `completed` is set. "All tasks done" sets `completed` and fills the remainder. Manual controls,
   undo and `/progress` are rejected for these.

   **Racing the clock.** A template may carry `minutes` (whole, 1–720, `parseMinutes`). Its day
   instances then get `timer: { minutes, startedAt, endsAt, result, finishedAt }` (absent on untimed
   routines and older records). The clock starts via `POST .../timer` or the first tick
   (`startClock`). The server decides `result`: `'beat'` when the last task is ticked before `endsAt`
   (`checkFinish`), `'missed'` once `endsAt` passes (`settleTimers()` runs at the top of every API
   request, so it's settled even if the app was closed). `'missed'` never changes. Unticking a task on a
   finished day (`resumeClock`) clears `finishedAt`, pushes `endsAt` on by the time it sat finished
   (so time already used still counts), and turns `'beat'` back to `null`. These log
   `kind: "timer"` history entries. The UI (`renderRace`, `raceLabel`) only displays it, and at 0:00
   re-fetches (`settleClock`) to pick up the server's verdict. A time's-up alarm (`scheduleAlarms`,
   run from `renderTabs`, keeps one timeout per running race keyed `id@endsAt`; `ringAlarm` plays a
   Web Audio chime via `playAlarm` and, if the tab is hidden, shows a `Notification`) rings once per deadline.
   A `'missed'` day loses Grove worth: one step at the deadline, then one per full 15 min late (to
   `finishedAt`, or now while unfinished): five even steps from its worth down to 10% at 60 min (`worthOf` in `app.js`; the stored
   `worth` is `baseWorth`). Client-side and derived, like the rest of the Grove; a 30 s interval
   re-renders while a late day is still withering.
2. **Journey.** A goal split into named stages: `stages: [{ id: "s1", name, share, progress }]`.
   Shares must add up to **exactly 100** (enforced by `stagesFromBody()` on the server and the
   sheet in the UI). Overall `progress` is **derived**: `sum(share × stage progress / 100)`
   (`journeyProgress`, same formula in `server.js` and `app.js`). The flask can't be dragged;
   ←/→ (`canFill`) act on the **selected stage**
   (`selectedStage`, `stagePick`) via `nudge()` → `commitStage()`, and each stage bar
   in `#legs` can be dragged. ↑/↓ change the selected stage. A stage update adds a history entry with
   `stage, stageName, stageFrom, stageTo`; undo restores `stageFrom`. Reshaping (`PUT .../stages`)
   keeps progress (and tasks) for stages whose `id` is sent back, logs a `kind: "reshape"` entry,
   and can't be undone. `/progress` is rejected for journeys.

   **Stage tasks.** A stage may carry `tasks: [{ id: "t1", name, done, doneAt }]` (absent when it
   has none). While it has tasks its progress is derived: `done / count × 100` (`stageFromTasks`),
   and hand-filling that stage is rejected (server) and disabled (UI: `stageHasTasks`, the bar can't
   be dragged). Removing the last task leaves the stage's
   progress as it was and makes it hand-filled again. A tick/untick logs `task, taskDone` on the
   history entry so undo can reverse it; adding/removing a task logs `kind: "tasks"` (only when the
   stage's progress changes) and can't be undone. In the UI the grey ＋ (`.leg-add`) opens an inline
   input (`addingTaskFor`), and only the selected stage's tasks render (`stageTasksHtml`), and only
   while it's expanded: stages start collapsed; `pickStage` selects + expands an unselected stage
   and toggles `expandedStages` (session only) on the selected one; the ＋ always expands.

   **Smaller tasks (subtasks).** A stage task may carry `subtasks: [{ id: "u1", name, done, doneAt }]`
   (absent when it has none). **One level only, by design: do not add deeper nesting.** A task's
   worth is `taskFraction`: 0/1 from `done`, or the share of its subtasks done. A task with subtasks
   has its `done` derived in `stageFromTasks` (ticked when all are done) and can't be ticked directly.
   Subtask ticks log `task, sub, taskDone` so undo reverses them; adding/removing logs `kind: "tasks"`.
   In the UI each task is a line (`.stask` → `.stask-line`), subtasks are an indented `.ssubs` list,
   and the hover ＋ (`data-add-sub`) opens an inline box (`addingSubFor`; inputs use `data-for`).
   Tasks with subtasks are collapsed by default; clicking one toggles `expandedTasks` (session only,
   keyed `<journey>/<stage>/<task>`), and the ＋ expands it.

**The Grove (master bar).** Every tracker has an optional `worth` (0–1000, percent, missing = 100,
`worthOf`) for how much of the Grove bar it fills when full. Routine templates carry `worth` too and copy
it to each day instance; `PUT /api/templates/:id` with `date` also updates that day's instance if
it isn't archived. The Grove is **never stored**: `groveTotal = Σ progress × worth / 100` over all
trackers (archived count, deleted don't), `tokens = floor(total / 100)`, bar = the remainder
(`groveState` in `app.js`). Because it's derived, decreases revoke tokens with no special code. The
Grove view (`openGrove`, hash `#grove`, opened from the `#groveBtn` logo) reuses the project view in
`.grove-mode` (`state.activeId` is null, `groveOpen` is true) with `#grovePanel`, a merged-history
log (`groveTimeline` → `renderGroveTrail`). `renderGrove()` runs on every `renderTabs()`
and toasts tokens sprouting/withering by comparing with `groveSeen`. `parseWorth` in `server.js` validates it.

**Token types.** Tokens are typed: `terraform` (shovel), `recruit` (tree), `design` (blueprint),
`building` (hammer) (`TOKEN_TYPES` in both files; coins drawn by `coinSvg`). A type with
`locked: true` in `app.js` (currently all but `design`) shows as a greyed "Locked" card that can't be picked. The only stored Grove data is
an append-only log, `db.grove.picks: [{ type, at }]` in `projects.json` (loaded into `state.grove`):
**pick i is the type of token i+1**. The user picks *before* earning, and picks are never edited or
removed, so a withered token's type (and any later picks) stay locked in for the next refill. A pick is
needed (`needsPick`, shown as the `#groveAlert` ❗ on the logo and the `#grovePick` cards in the Grove view)
while `picks.length <= tokens`; earned slots without a pick show as a "?" coin. The server only checks
`slot === picks.length` (double-click/stale guard); whether a pick is allowed is up to the client,
since the Grove total is derived there. `migrateGrove()` seeded the 7 pre-type tokens at startup.

**Spending tokens (the campfire).** The 🔥 `#campfireBtn` under `#groveTokens` opens `#spendSheet`
(`openSpend` → pick type + count → `submitSpend` asks "Are you sure?" → `POST /api/grove/spends`). Every
token is worth **1 hour** whatever its type. Spends are a second append-only log,
`db.grove.spends: [{ id, type, count, at, endsAt }]` (absent on older files, so read it as `|| []`);
the server sets `endsAt = at + count h` and, like picks, only checks the `slot === spends.length` guard
(plus type and a whole count 1–24). Tokens in hand are derived (`tokenPurse` in `app.js`): typed tokens
grown per type minus spent per type, plus unchosen ones; spent coins leave `#groveTokens` and the
topbar 🪙 count. Burning timers render in `#groveFires` (`renderCampfire`, reusing `.race` styles), and
`scheduleAlarms` keeps one timeout per fire (key `fire:<id>`) that calls `ringFire` (same `playAlarm`
chime + `Notification`). The Grove trail logs spends and burn-outs. No early stop, by design.

Any kind can be **archived** (`archived`, `archivedAt`). Archived trackers leave the tabs, show
in the Archive menu and are read-only until restored.

## API (all in `server.js` → `handleApi`)

```
GET    /api/projects
POST   /api/projects                     { name, worth?, stages: [{ name, share }] }   always a journey
PATCH  /api/projects/:id                 { name }
DELETE /api/projects/:id
PUT    /api/projects/:id/stages          { name?, worth?, stages: [{ id?, name, share }] }  journeys only
POST   /api/projects/:id/stages/:sid/progress  { value, note }  journeys only, stage without tasks
POST   /api/projects/:id/stages/:sid/tasks      { name }         add a task to a stage
POST   /api/projects/:id/stages/:sid/tasks/:tid { done }         tick / untick
PATCH  /api/projects/:id/stages/:sid/tasks/:tid { name }         rename (saved, no history entry)
DELETE /api/projects/:id/stages/:sid/tasks/:tid                  remove a task (and its subtasks)
POST   /api/projects/:id/stages/:sid/tasks/:tid/move    { by: -1 | 1 }  reorder (saved, no history entry)
POST   /api/projects/:id/stages/:sid/tasks/:tid/subtasks       { name }   add a smaller task
POST   /api/projects/:id/stages/:sid/tasks/:tid/subtasks/:uid  { done }   tick / untick
PATCH  /api/projects/:id/stages/:sid/tasks/:tid/subtasks/:uid  { name }   rename a smaller task
DELETE /api/projects/:id/stages/:sid/tasks/:tid/subtasks/:uid             remove a smaller task
POST   /api/projects/:id/stages/:sid/tasks/:tid/subtasks/:uid/move { by: -1 | 1 }  reorder a smaller task
DELETE /api/projects/:id/history/last                      undo, journeys only
POST   /api/projects/:id/tasks/:taskId   { done }          routines only
POST   /api/projects/:id/complete                          routines only, all tasks must be done
POST   /api/projects/:id/timer                             start the clock on a timed routine day
POST   /api/projects/:id/archive         { archived }
GET    /api/templates
POST   /api/templates                    { name, minutes?, worth?, tasks: [{ name, percent }] }  writes templates.json
PUT    /api/templates/:id                { name, minutes?, worth?, tasks, date? }   id never changes; date = today's day to re-worth
DELETE /api/templates/:id                                  existing day instances are kept
POST   /api/templates/:id/start          { date: "YYYY-MM-DD" }  returns the existing instance if one exists
GET    /api/grove                                          { picks: [{ type, at }], spends: [{ id, type, count, at, endsAt }] }
POST   /api/grove/picks                  { type, slot }    lock in the next token type; slot must equal picks.length
POST   /api/grove/spends                 { type, count, slot }  spend tokens: a count-hour timer; slot must equal spends.length
```

Errors come back as `{ error: "message" }`. The frontend shows that message in a toast, so write
error text for me to read.

## Data and persistence rules

- `data/projects.json` is loaded once at startup into memory (`db`). Every change calls
  `saveDb()`, which writes through a serialized promise queue to a `.tmp` file and then renames it
  (an atomic swap). Preserve this pattern.
- If `projects.json` exists but can't be parsed, the server **exits rather than overwriting it**.
  Do not weaken this.
- Because the server holds data in memory, **hand edits to `projects.json` only stick if the
  server is stopped**.
- `templates.json` is the opposite: it is re-read on every `/api/templates` request, so edits show
  up without a restart. It is created with default routines on first start. Templates are
  validated by `loadTemplates()`: each needs a `name` and a non-empty `tasks` list, and each task
  needs a `name` and a `percent` greater than 0 and at most 100. The `id` falls back to a slug of
  the name and must stay stable, since it links a day's instance to its template.
- Routines can be edited **in the app** (editor sheet: plant, edit via ✎ in the Routines menu,
  delete) **or by hand** in the JSON file. App writes go through `editTemplatesFile()`: re-read the
  file, change the raw list, write `.tmp` then rename, serialized on `templatesQueue`. It keeps
  extra hand-written fields, writes one task per line (`templatesJson`), and refuses to touch a file
  it can't parse. Writes from the app are validated by `routineFromBody()`, which also rejects task
  totals over 100%. `loadTemplates()` does not check the total, so hand-edited files still load.
  Editing a routine doesn't change day instances that already exist.
- Never delete, reset or rewrite `data/*.json` without asking. It is my real history.
- Names are trimmed, collapsed and capped at 60 characters; notes are capped at 280
  (`cleanName` / `cleanNote`). Progress values are rounded to one decimal (`round1`).

## Frontend conventions

- `state = { projects, templates, activeId }` is the single source of truth. After any API call,
  `replaceProject(updated)` and then re-render (`renderTabs`, `renderProjectChrome`,
  `renderJourney`). `applyUpdate()` does all of that and also plays the fill animation.
- Progress writes are chained on a module-level `queue` promise so they hit the server in order.
  Use it for any new mutating action.
- Stage fills are optimistic: the bars and flask move first, then reconcile or roll back on error.
- Rendering is template strings assigned to `innerHTML`. **Always pass user text through
  `esc()`.**
- The potion colour comes from `STOPS` and `colorAt(f)` and is mirrored to the `--potion` CSS
  variable. Reuse these instead of adding new colours.
- `canFill(p)` controls whether ←/→ fill the selected stage (journey, not archived). There is no
  manual-controls bar (+/−, note, Set to, Undo); it was removed on purpose. The flask itself
  is never dragged.
- The active tracker is reflected in the URL hash (`#<id>`).
- The UI copy uses forest wording: trackers are "planted", the progress bar is a "potion", the
  history is the "Trail log", and "tended" means updated. Keep new copy in that voice.

## When changing things

- **Edit files with the Edit tool (or Write for new files), never with shell commands.** Don't
  change files with `python`, `sed`, `awk`, `perl`, heredocs or `echo >`, even when many edits
  would be faster batched into one script. I want each change as its own reviewable diff, and file
  edits made through Bash bypass my "Edit automatically" setting and ask for approval anyway.
  Reading and searching with shell commands (`grep`, `cat`) is fine.

- Update `README.md` when behaviour or the templates format changes.
- If you add a field to projects, existing records in `projects.json` won't have it, so handle
  `undefined` gracefully (as the code already does for `archived` and `tasks`).
- Check changes at laptop window sizes. The existing small-screen handling (`Flask.layout()`)
  can stay, but it only matters for a narrow browser
  window, not phones.
