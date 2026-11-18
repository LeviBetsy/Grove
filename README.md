# Grove 🌲

A forest-themed progress tracker that runs on your own laptop.

```bash
npm start          # or: node server.js
```

Then open **http://localhost:4321**. No install step, as there are no dependencies (needs Node 18+).

## Where your data lives

Everything is saved in `data/projects.json` (created the first time you plant a tracker).
It's plain JSON, so you can back it up, sync it with Dropbox/iCloud, or edit it by hand while the server is stopped.

## Using it

- Click **＋ Plant** in the top bar (or start from the welcome screen), pick **Journey** or
  **Routine**, type a name and plant it. Both open an editor (see below). **← Back** or Esc
  returns to the tracker you were on. (A simple goal is just a journey with one stage at 100%.)
- Fill a journey's selected stage by **dragging** its bar or with the **← →** keys (Shift for 5).
- Older plain projects (from before journeys took over) are turned into a one-stage journey the
  next time the server starts, keeping their history. The untouched file is kept as
  `data/projects.json.before-journeys.bak`.
- Scroll down for the **Trail log**: every change, newest first.
- Click the pencil (or double-click the title) to rename; use the bin icon to delete.
- Click **Pop out** to float a little forest window over your other windows. It shows the
  tracker's name, potion bar and percent, with a mini wanderer hopping on the bar. It
  needs Chrome, and the Grove tab has to stay open. The widget follows the selected tab. Hover it
  and use ‹ › to pin a different tracker, or 📌 to pin or unpin the one shown. Click **Pop out**
  again to close it.
- The forest has its own **day and night**: one full day lasts 20 minutes. The sun rises on the left,
  crosses the sky and sets on the right, then the moon follows with the stars and fireflies. It
  runs off the clock, so a reload or the pop-out window shows the same time of day.

## Journeys (a goal split into stages)

A journey is a big goal made of named stages, e.g. a thesis with *Chapter 1 · Introduction*,
*Chapter 2 · Related work*, and so on. Each stage has its own bar and a **share** of the journey,
and the shares must add up to **exactly 100%**: the editor won't plant or save until they do
(**Split evenly** shares 100% across the stages for you).

- The big potion shows the whole journey: each stage's progress weighted by its share. It can't be
  dragged; you fill the stages.
- Click a stage to pick it, then use **← →** on that stage, or drag the stage's own bar. **↑ ↓**
  picks another stage. There's no undo button; the undo API still exists.
- **Stage tasks:** click the grey **＋** to the right of a stage's bar to add tasks to it (type a name,
  press Enter, add as many as you like; Esc closes the box). Task and smaller-task names have no
  length limit: long ones wrap onto more lines, and the box grows as you type. Once a stage has tasks, its bar fills
  from them: each task is worth 100% ÷ the number of tasks (3 tasks → 33.3% each). The selected
  stage's tasks show under its row, one per line; click one to tick or untick it, hover it and click
  × to remove it, or use its **↑ / ↓** arrows to move it up or down the list (smaller tasks too).
  Hover a task (or smaller task) and click its **✎** to rename it: Enter or clicking away saves,
  Esc cancels. Renaming doesn't add a Trail log entry, and older entries keep the old name.
  The order is saved, so you can keep the next task at the top. A stage with tasks starts **collapsed** (`2/3 tasks ›`): clicking a stage selects it
  and opens its tasks, and clicking the selected stage again collapses or expands them.
- **Smaller tasks:** hover a task and click its **＋** to split it into smaller tasks, listed under it.
  The task's slice is shared evenly between them (a 33.3% task with 3 smaller tasks → 11.1% each),
  and the task ticks itself once they're all done, so you tick the smaller tasks rather than the task.
  A task with smaller tasks starts **collapsed** (showing e.g. `1/3 ›`); click it to show or hide them.
  This is the deepest level: smaller tasks can't be split again.
  A stage with tasks can't be dragged or filled with the buttons. Remove all its tasks to fill it by
  hand again.
- The list icon next to the title reshapes the journey: rename, add or remove stages, change shares.
  Stages you keep keep their progress and tasks; a removed stage takes them with it.

## The Grove (one bar that everything fills)

Click the **Grove** logo in the top left (or open `#grove`) to see the Grove: a master bar that every
journey and routine fills, archived ones included. The logo itself shows a slim Grove bar and your
token count.

- Each tracker has a **Grove worth**: how much of the Grove bar it fills when it's full. At 100% a full
  tracker fills the bar once; at 300% it fills it three times; at 30% it fills under a third. It
  counts as you go, so a journey worth 300% that's 10% done gives the Grove 30%.
- Every time the bar passes 100% it loops back round and you earn a **Grove token**. Going back
  down (unticking, dragging a stage back, undo) moves the Grove back too and can take tokens away.
- **Tokens have types**: **Terraform** (a shovel), **Recruit** (a tree), **Design** (a blueprint) and
  **Building** (a hammer). You choose the type of your *next* token before you earn it, and that
  choice is locked in. When the next token has no type yet, a red **!** shows on the Grove logo.
  Open the Grove and pick a card. The token is yours when the bar fills. For now only **Design**
  can be picked: the other three cards are shown greyed out with a 🔒 and say "Locked" on hover.
- Choices are kept in a log and never change. If a token withers, its type stays saved, so filling
  the bar again grows the same type back, and anything you'd already chosen for later stays too. If
  the bar fills before you've chosen, the token grows as a **?** coin until you pick its type.
- **Spending tokens at the campfire.** Below your tokens in the Grove is a big 🔥 **Spend tokens**
  button. Click it, pick a token type and how many, then confirm. **Every token is worth 1 hour**,
  whatever its type, so spending 3 Design tokens starts a 3-hour **Design** timer. The timer shows
  under the campfire with a countdown, and when it runs out the same chime as a routine's time's-up
  alarm plays (plus a macOS notification if the tab is in the background). Spent tokens leave your
  hand for good and the logo's 🪙 count drops. Spends and timers show in the Grove's Trail log.
  Only typed tokens can be spent (not **?** ones). Several timers can burn at once, and there's no
  way to put one out early. As with routines, nothing rings if Grove isn't open in a tab when a
  timer ends. If a token you already spent withers, that type is short until the bar grows it back.
- Set the worth in the editor when you plant or edit a journey or routine (the **Grove worth** box).
  Changing a routine's worth also counts for today's day if it isn't archived. Earlier days keep theirs.
- **Archiving keeps** what a tracker gave the Grove. **Deleting takes it away**, and the delete
  prompt tells you how much.
- The Grove bar and token count are never saved anywhere. They're worked out from your trackers each
  time. A tracker without a worth counts as 100%. Only the token choices and the campfire spends are
  saved (`grove.picks` and `grove.spends` in `data/projects.json`).

## Daily routines (task templates)

Routines live in `data/templates.json` (created on first start with a "Get out of bed" example).
You can manage them in the app or by hand:

- **In the app:** choose **＋ Plant → Routine** (or **Routines → ＋ New routine**), give it a name and
  a list of tasks with the share of the potion each one fills. The total can't go over 100%: the
  editor shows an error and won't save until you trim it. Planting a routine also starts today's copy.
  The ✎ next to a routine in the **Routines** menu edits or deletes it. Edits apply from the next
  day you start it; a day that's already started keeps its own tasks.
- **By hand:** edit the file and the change shows up the next time you open the **Routines** menu,
  with no restart needed. Saving from the app rewrites the file (keeping any extra fields you added),
  so don't have it open with unsaved changes at the same time.

```json
{
  "templates": [
    {
      "id": "get-out-of-bed",
      "name": "Get out of bed",
      "tasks": [
        { "name": "Fold sheet", "percent": 10 },
        { "name": "Brush teeth", "percent": 10 },
        { "name": "Breakfast or lunch", "percent": 20 }
      ]
    }
  ]
}
```

- `id` must be unique and should stay the same; it's how Grove knows whether today's copy already exists.
- `minutes` (optional) gives the routine a time limit to race, e.g. `"minutes": 20`. It must be a
  whole number from 1 to 720. Leave it out for no timer. In the app it's the **Race the clock** box
  in the routine editor.
- `worth` (optional) is the routine's Grove worth, a number from 0 to 1000 (percent). Left out, it's 100.
  The app only writes it when it isn't 100.
- `percent` per task is above 0 and at most 100. Tasks don't need to add up to 100 (finishing them
  all fills the rest), but they shouldn't add up to more. The app enforces this; the file loader doesn't.
- **Routines → Start Nov 15** creates *Get out of bed Nov 15*. Only one per routine per day;
  clicking it again just opens today's.
- Click tasks to tick them (click again to untick). When every task is done, **All tasks done**
  fills the potion to 100%.
- **Racing the clock:** a routine with a time limit shows a strip above its tasks. The clock starts
  when you press **Start the clock** or tick your first task, and counts down. Tick every task before
  it reaches 0:00 and the day is marked **🏆 Beat the clock**. If time runs out first, it's marked
  **⌛ Missed the clock** (even if Grove was closed at the time), and you can still tick the rest off.
  Unticking a task after you beat the clock starts it running again from where it stopped (the time
  you'd already used still counts, the time it sat finished doesn't), so you have to finish again before
  0:00. A missed clock stays missed; unticking just starts the lateness counting again from where it
  stopped. The result shows on the routine's page,
  in its Trail log, in the **Routines** menu and next to it in the **Archive**.
- **Time's-up alarm:** while Grove is open in a browser tab, a chime plays when a routine's clock
  hits 0:00, whichever tracker you're looking at. If the tab is in the background you also get a
  macOS notification (the browser asks for permission the first time you start a clock; clicking the
  notification opens that routine). Nothing rings if Grove isn't open, and a background tab may ring
  up to about a minute late because browsers slow down timers in hidden tabs.
- **Running late costs Grove worth.** The day's Grove worth drops the moment the clock runs out, then
  again every 15 minutes until the last task is ticked, in five even steps down to 10% at an hour late,
  however much it was worth (a worth already under 10% stays as it is). A routine worth 100% gives
  82% up to 15 minutes late, then 64%, 46%, 28%, and 10% from an hour on. A routine worth 300% gives
  242%, 184%, 126%, 68%, then 10%. The drop counts for everything the day put into the Grove, and
  stops when every task is done. Like the rest of the Grove it isn't stored: it's worked out from the
  clock's deadline and when the last task was ticked.
- A full potion can be **archived**. Archived trackers leave the tabs and live under **Archive**,
  where you can open or restore them.

## Files

| File | What it does |
| --- | --- |
| `server.js` | Tiny Node server. Serves the page and reads/writes `data/projects.json` |
| `public/app.js` | Potion flask, hero animation, tabs, Trail log |
| `public/sprite.js` | The pixel-art hero. Edit the letter grids to redesign them |
| `public/style.css` | Forest theme |

Change the port with `PORT=5000 npm start`.
