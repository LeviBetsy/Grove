// Grove — a tiny local progress tracker.
// Zero dependencies: `node server.js`, then open http://localhost:4321
// All data lives in ./data/projects.json on this machine.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 4321;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.GROVE_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'projects.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

// Written to data/templates.json the first time the server starts.
// Routines can be added in the app (Plant → Routine) or by editing that file by hand;
// the server re-reads it on every request.
const DEFAULT_TEMPLATES = {
  templates: [
    {
      id: 'get-out-of-bed',
      name: 'Get out of bed',
      tasks: [
        { name: 'Fold sheet', percent: 10 },
        { name: 'Brush teeth', percent: 10 },
        { name: 'Breakfast or lunch', percent: 20 },
      ],
    },
    {
      id: 'bedtime',
      name: 'Bedtime',
      tasks: [
        { name: 'Put phone away', percent: 15 },
        { name: 'Brush teeth', percent: 10 },
        { name: 'Wash face', percent: 10 },
        { name: "Lay out tomorrow's clothes", percent: 10 },
        { name: 'Lights out', percent: 15 },
      ],
    },
  ],
};

// ---------- storage ----------
function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(db.projects)) throw new Error('missing "projects" array');
    return db;
  } catch (err) {
    if (err.code === 'ENOENT') return { projects: [] };
    // Never silently overwrite a file we couldn't read.
    console.error(`\n  Could not read ${DATA_FILE}: ${err.message}`);
    console.error('  Fix or move that file, then start again.\n');
    process.exit(1);
  }
}

const db = loadDb();
let writeQueue = Promise.resolve();

// Plain projects (no `tasks`, no `stages`) are gone: each old one becomes a journey with a single
// stage that holds all of its progress. Its history is rewritten as fills of that stage so the
// Trail log, chart and undo keep working.
function migratePlainProjects() {
  let changed = 0;
  for (const p of db.projects) {
    if (p.tasks || p.stages) continue;
    p.stages = [{ id: 's1', name: p.name, share: 100, progress: round1(clamp(Number(p.progress) || 0, 0, 100)) }];
    let prev = 0;
    for (const h of p.history || []) {
      if (h.kind === 'start') { prev = h.value ?? 0; continue; }
      Object.assign(h, { stage: 's1', stageName: p.name, stageFrom: prev, stageTo: h.value });
      prev = h.value;
    }
    p.progress = p.stages[0].progress;
    changed++;
  }
  return changed;
}

// Grove tokens have a type, picked before they're earned. db.grove.picks is an append-only log:
// pick i is the type of token i+1. Tokens themselves stay derived (on the client) from the trackers,
// so a token that withers keeps its pick, and refilling grows the same type again.
const TOKEN_TYPES = ['terraform', 'recruit', 'design', 'building'];
// Spending tokens at the campfire (db.grove.spends, append-only): each token buys one hour on a timer.
const HOUR_MS = 60 * 60 * 1000;
const MAX_SPEND = 24;
// The 7 generic tokens grown before types existed
const FIRST_PICKS = ['design', 'design', 'terraform', 'terraform', 'building', 'building', 'recruit'];
function migrateGrove() {
  if (db.grove && Array.isArray(db.grove.picks)) return false;
  const at = now();
  db.grove = { ...(db.grove || {}), picks: FIRST_PICKS.map((type) => ({ type, at })) };
  return true;
}

function saveDb() {
  const snapshot = JSON.stringify(db, null, 2);
  writeQueue = writeQueue.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, DATA_FILE); // atomic swap, so a crash can't leave half a file
  });
  return writeQueue;
}

// ---------- helpers ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const now = () => new Date().toISOString();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- templates (routines) ----------
function ensureTemplatesFile() {
  if (fs.existsSync(TEMPLATES_FILE)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TEMPLATES_FILE, templatesJson(DEFAULT_TEMPLATES));
}

async function loadTemplates() {
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(TEMPLATES_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`templates.json is not valid JSON: ${err.message}`);
  }
  const list = Array.isArray(parsed) ? parsed : parsed.templates;
  if (!Array.isArray(list)) throw new Error('templates.json needs a "templates" array');
  return list.map((t, i) => {
    const name = cleanName(t && t.name);
    if (!name) throw new Error(`templates.json: template #${i + 1} needs a "name"`);
    if (!Array.isArray(t.tasks) || !t.tasks.length) throw new Error(`templates.json: "${name}" needs a "tasks" list`);
    const tasks = t.tasks.map((k, j) => {
      const taskName = cleanName(k && k.name);
      const percent = Number(k && k.percent);
      if (!taskName || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
        throw new Error(`templates.json: "${name}" task #${j + 1} needs a "name" and a "percent" between 0 and 100`);
      }
      return { name: taskName, percent: round1(percent) };
    });
    const clock = parseMinutes(t.minutes);
    if (clock.error) throw new Error(`templates.json: "${name}" has a "minutes" time limit that isn't a whole number from 1 to ${MAX_MINUTES}`);
    const worth = parseWorth(t.worth);
    if (worth.error) throw new Error(`templates.json: "${name}" has a "worth" that isn't a number from 0 to ${MAX_WORTH}`);
    return { id: String(t.id || slug(name)), name, ...(clock.minutes && { minutes: clock.minutes }), worth: worth.worth, tasks };
  });
}

// A routine's optional time limit (racing the clock), in whole minutes.
// Missing, null, "" or 0 means no timer.
const MAX_MINUTES = 720;
function parseMinutes(v) {
  if (v === undefined || v === null || v === '' || v === 0) return { minutes: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTES) return { error: true };
  return { minutes: n };
}

// How much of the Grove bar a tracker fills when it's full, in percent (300 = three Grove tokens).
// Missing, null or "" means the default 100.
const MAX_WORTH = 1000;
const WORTH_ERROR = `Grove worth should be a number from 0 to ${MAX_WORTH}%.`;
function parseWorth(v) {
  if (v === undefined || v === null || v === '') return { worth: 100 };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_WORTH) return { error: true };
  return { worth: round1(n) };
}

// The id a raw templates.json entry is known by (same fallback as loadTemplates).
const rawTemplateId = (t) => String((t && t.id) || slug(cleanName(t && t.name)));
const MAX_TASKS = 30;

// Check a routine sent from the app's routine editor.
// Returns { name, tasks } or { error } with a message for me to read.
function routineFromBody(body) {
  const name = cleanName(body && body.name);
  if (!name) return { error: 'Give your routine a name.' };
  const list = Array.isArray(body.tasks) ? body.tasks : [];
  if (!list.length) return { error: 'Add at least one task.' };
  if (list.length > MAX_TASKS) return { error: `A routine can hold up to ${MAX_TASKS} tasks.` };
  const tasks = [];
  for (const [i, k] of list.entries()) {
    const taskName = cleanName(k && k.name);
    const percent = round1(Number(k && k.percent));
    if (!taskName) return { error: `Task ${i + 1} needs a name.` };
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { error: `“${taskName}” needs a percent above 0 and up to 100.` };
    }
    tasks.push({ name: taskName, percent });
  }
  const total = round1(tasks.reduce((s, k) => s + k.percent, 0));
  if (total > 100) return { error: `Your tasks add up to ${total}%. Trim them to 100% or less.` };
  const clock = parseMinutes(body.minutes);
  if (clock.error) return { error: `The time limit should be whole minutes, from 1 to ${MAX_MINUTES}. Leave it empty for no timer.` };
  const worth = parseWorth(body.worth);
  if (worth.error) return { error: WORTH_ERROR };
  return { name, minutes: clock.minutes, worth: worth.worth, tasks };
}

// The routine as written to templates.json: the time limit only when there is one, the worth only when it isn't 100
const templateFields = (input) => ({
  name: input.name, ...(input.minutes && { minutes: input.minutes }),
  ...(input.worth !== undefined && input.worth !== 100 && { worth: input.worth }), tasks: input.tasks,
});

const nameTaken = (list, name, exceptId) =>
  list.some((t) => rawTemplateId(t) !== exceptId && cleanName(t && t.name).toLowerCase() === name.toLowerCase());

// Pretty-print templates.json the way it's hand-written: one task per line.
const templatesJson = (doc) => JSON.stringify(doc, null, 2)
  .replace(/\{\n\s+"name": ("(?:[^"\\]|\\.)*"),\n\s+"percent": ([\d.]+)\n\s+\}/g, '{ "name": $1, "percent": $2 }') + '\n';

let templatesQueue = Promise.resolve();

// Read templates.json, let `change` edit its raw list, then write it back (tmp + rename).
// Saves run one at a time. A file that can't be parsed is left alone, never overwritten.
// If `change` returns { error }, nothing is written.
function editTemplatesFile(change) {
  const run = templatesQueue.then(async () => {
    let doc;
    try {
      doc = JSON.parse(await fsp.readFile(TEMPLATES_FILE, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`templates.json is not valid JSON, so it was left alone: ${err.message}`);
      doc = { templates: [] };
    }
    const list = Array.isArray(doc) ? doc : doc && doc.templates;
    if (!Array.isArray(list)) throw new Error('templates.json needs a "templates" array');
    const result = change(list);
    if (result && result.error) return result;
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = TEMPLATES_FILE + '.tmp';
    await fsp.writeFile(tmp, templatesJson(doc));
    await fsp.rename(tmp, TEMPLATES_FILE);
    return result;
  });
  templatesQueue = run.catch(() => {});
  return run;
}

// ---------- journeys (a goal split into named stages) ----------
const MAX_STAGES = 40;

// Overall progress of a journey: each stage's progress weighted by its share.
function journeyProgress(p) {
  return round1(Math.min(100, p.stages.reduce((s, st) => s + (st.share * st.progress) / 100, 0)));
}

// ---------- task shapes (JSDoc only: these are plain JSON objects, not classes) ----------
// Stage tasks and smaller tasks (subtasks) belong to journeys. A routine day has its own,
// different kind of task (RoutineTask), which carries a percent and has no subtasks.

/**
 * A smaller task under a stage task. One level only: a subtask never has subtasks of its own.
 * @typedef {object} Subtask
 * @property {string} id        "u1", "u2", … unique within its task (`nextId(list, 'u')`)
 * @property {string} name      cleaned by `cleanName` (trimmed, ≤ 60 chars)
 * @property {boolean} done
 * @property {string|null} [doneAt]  ISO time it was ticked; null once unticked, absent until first ticked
 */

/**
 * A task on a journey stage. Each task is an equal slice of its stage's bar (`stageFromTasks`).
 * With subtasks, its slice is split evenly between them (`taskFraction`) and `done`/`doneAt`
 * are derived (ticked once all subtasks are done), so it can't be ticked directly.
 * @typedef {object} StageTask
 * @property {string} id        "t1", "t2", … unique within its stage (`nextId(list, 't')`)
 * @property {string} name      cleaned by `cleanName` (trimmed, ≤ 60 chars)
 * @property {boolean} done
 * @property {string|null} [doneAt]  ISO time it was ticked; null once unticked, absent until first ticked
 * @property {Subtask[]} [subtasks]  absent when it has none (never left as an empty list)
 */

/**
 * A stage of a journey. While it has tasks its progress is derived from them.
 * @typedef {object} Stage
 * @property {string} id        "s1", "s2", …
 * @property {string} name
 * @property {number} share     % of the journey this stage is worth; all shares add up to 100
 * @property {number} progress  0–100, one decimal
 * @property {StageTask[]} [tasks]  absent when it has none
 */

/**
 * A task on a routine day instance (copied from its template). Not a StageTask: it has its own
 * percent of the routine's flask and no subtasks.
 * @typedef {object} RoutineTask
 * @property {string} id
 * @property {string} name
 * @property {number} percent   > 0 and ≤ 100; a routine's percents total ≤ 100
 * @property {boolean} done
 * @property {string|null} [doneAt]  absent until first ticked
 */

const MAX_STAGE_TASKS = 50;
const MAX_SUBTASKS = 30;

// Next id like "t4" / "u2" for a list of { id } items
const nextId = (list, prefix) =>
  prefix + (list.reduce((m, x) => Math.max(m, Number(new RegExp(`^${prefix}(\\d+)$`).exec(x.id)?.[1]) || 0), 0) + 1);

// How much of its slice a task has earned: 0 or 1, or the share of its smaller tasks that are done.
/** @type {(t: StageTask) => number} */
const taskFraction = (t) =>
  t.subtasks && t.subtasks.length ? t.subtasks.filter((u) => u.done).length / t.subtasks.length : t.done ? 1 : 0;

// A stage with tasks fills from them: each task is an equal slice of the stage's bar, and a task
// with smaller tasks splits its slice evenly between them (and ticks itself once they're all done).
// One level deep only. A stage without tasks keeps whatever progress it was given by hand.
/** @param {Stage} stage */
function stageFromTasks(stage) {
  if (!stage.tasks || !stage.tasks.length) return;
  for (const t of stage.tasks) {
    if (!t.subtasks || !t.subtasks.length) continue;
    const all = t.subtasks.every((u) => u.done);
    if (all !== !!t.done) { t.done = all; t.doneAt = all ? now() : null; }
  }
  stage.progress = round1((stage.tasks.reduce((s, t) => s + taskFraction(t), 0) / stage.tasks.length) * 100);
}

// After a stage changed (from → stage.progress), re-derive the journey and log it.
function recordStage(project, stage, from, extra = {}) {
  const next = journeyProgress(project);
  const delta = round1(next - project.progress);
  project.progress = next;
  project.history.push({ at: now(), value: next, delta, note: '', ...extra, stage: stage.id, stageName: stage.name, stageFrom: from, stageTo: stage.progress });
}

// Check stages sent from the journey editor. Stages whose `id` matches an existing one keep
// their progress; new ones start at 0. Shares must add up to exactly 100%.
// Returns { stages } or { error } with a message for me to read.
function stagesFromBody(list, existing = []) {
  if (!Array.isArray(list) || !list.length) return { error: 'Add at least one stage.' };
  if (list.length > MAX_STAGES) return { error: `A journey can hold up to ${MAX_STAGES} stages.` };
  let nextNum = existing.reduce((m, s) => Math.max(m, Number(/^s(\d+)$/.exec(s.id)?.[1]) || 0), 0) + 1;
  const used = new Set();
  const stages = [];
  for (const [i, k] of list.entries()) {
    const name = cleanName(k && k.name);
    const share = round1(Number(k && k.share));
    if (!name) return { error: `Stage ${i + 1} needs a name.` };
    if (!Number.isFinite(share) || share <= 0 || share > 100) {
      return { error: `“${name}” needs a share above 0 and up to 100.` };
    }
    const old = k.id && !used.has(k.id) ? existing.find((s) => s.id === k.id) : null;
    if (old) used.add(old.id);
    stages.push({
      id: old ? old.id : `s${nextNum++}`, name, share, progress: old ? old.progress : 0,
      ...(old && old.tasks && { tasks: old.tasks }), // a kept stage keeps its tasks
    });
  }
  const total = round1(stages.reduce((s, st) => s + st.share, 0));
  if (total !== 100) return { error: `Your stages add up to ${total}%. A journey's stages must add up to exactly 100%.` };
  return { stages };
}

// Progress of a task-driven project: sum of finished tasks, or 100 once marked complete.
function taskProgress(p) {
  if (p.completed) return 100;
  return round1(Math.min(100, p.tasks.filter((t) => t.done).reduce((s, t) => s + t.percent, 0)));
}

function recordTaskProgress(p, note, kind) {
  const next = taskProgress(p);
  const delta = round1(next - p.progress);
  p.progress = next;
  p.history.push({ at: now(), value: next, delta, note, kind });
}

// ---------- racing the clock (routines with a time limit) ----------
// A timed routine day carries timer: { minutes, startedAt, endsAt, result, finishedAt }.
// result is null while it's undecided, then 'beat' (every task ticked before endsAt) or
// 'missed' (endsAt passed first). A 'missed' never changes; a 'beat' goes back to undecided if a
// task is unticked, with the clock resuming where it stopped (resumeClock).
const allTasksDone = (p) => p.tasks.every((t) => t.done);
const pad2 = (n) => String(n).padStart(2, '0');
function clockText(ms) {
  const s = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

function startClock(p) {
  const t = now();
  p.timer.startedAt = t;
  p.timer.endsAt = new Date(Date.parse(t) + p.timer.minutes * 60000).toISOString();
  p.history.push({ at: t, value: p.progress, delta: 0, note: `Clock started · ${p.timer.minutes} min to tick every task`, kind: 'timer' });
}

// The deadline passed before every task was ticked: settle it as missed, logged at the deadline
function settleTimer(p) {
  const tm = p.timer;
  if (!tm || !tm.endsAt || tm.result || Date.now() < Date.parse(tm.endsAt)) return false;
  tm.result = 'missed';
  const last = p.history[p.history.length - 1];
  const at = last && last.at > tm.endsAt ? last.at : tm.endsAt;
  p.history.push({ at, value: p.progress, delta: 0, note: `Time's up · the ${tm.minutes}-minute clock ran out`, kind: 'timer' });
  return true;
}

// Settle every race whose time ran out, so the result is there even if the app was closed
function settleTimers() {
  let changed = false;
  for (const p of db.projects) if (settleTimer(p)) changed = true;
  return changed;
}

// After a tick: the last task done in time beats the clock; done after it ran out is noted too
function checkFinish(p) {
  const tm = p.timer;
  if (!tm || !tm.startedAt || tm.finishedAt || !allTasksDone(p)) return;
  const t = now();
  tm.finishedAt = t;
  const left = Date.parse(tm.endsAt) - Date.parse(t);
  if (!tm.result) tm.result = 'beat';
  p.history.push({
    at: t, value: p.progress, delta: 0, kind: 'timer',
    note: tm.result === 'beat' ? `Beat the clock · ${clockText(left)} to spare` : `Every task done · ${clockText(left)} after the clock ran out`,
  });
}

// After an untick on a finished race: the clock picks up where it stopped. It was paused from
// finishedAt until now, so the deadline moves on by that much, keeping the time already used.
// A 'beat' goes back to undecided (and can be beaten again, or missed); a 'missed' stays missed,
// and its lateness carries on from where it stopped.
function resumeClock(p) {
  const tm = p.timer;
  if (!tm || !tm.finishedAt || allTasksDone(p)) return;
  const t = now();
  const paused = Math.max(0, Date.parse(t) - Date.parse(tm.finishedAt));
  tm.endsAt = new Date(Date.parse(tm.endsAt) + paused).toISOString();
  tm.finishedAt = null;
  if (tm.result === 'beat') tm.result = null;
  const left = Date.parse(tm.endsAt) - Date.parse(t);
  p.history.push({
    at: t, value: p.progress, delta: 0, kind: 'timer',
    note: tm.result ? `Clock running again · ${clockText(left)} late` : `Clock running again · ${clockText(left)} left`,
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// Stage tasks and smaller tasks have no length cap: they wrap onto more lines in the UI.
function cleanTaskName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
}

function cleanName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
}

function cleanNote(note) {
  return typeof note === 'string' ? note.trim().slice(0, 280) : '';
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','projects',id?,...]
  const method = req.method;
  if (settleTimers()) await saveDb();

  // /api/templates — routines, stored in data/templates.json
  if (parts[1] === 'templates') {
    let templates;
    try { templates = await loadTemplates(); } catch (err) { return send(res, 500, { error: err.message }); }
    const tid = parts[2] ? decodeURIComponent(parts[2]) : null;

    if (parts.length === 2 && method === 'GET') return send(res, 200, templates);

    // POST /api/templates {name, tasks: [{name, percent}]} — add a routine from the app
    if (parts.length === 2 && method === 'POST') {
      const input = routineFromBody(await readBody(req));
      if (input.error) return send(res, 400, input);
      const result = await editTemplatesFile((list) => {
        if (nameTaken(list, input.name)) return { error: `You already have a routine called “${input.name}”.` };
        const taken = new Set(list.map(rawTemplateId));
        const base = slug(input.name) || 'routine';
        let id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        const template = { id, ...templateFields(input) };
        list.push(template);
        return template;
      });
      if (result.error) return send(res, 400, result);
      return send(res, 201, result);
    }

    // PUT / DELETE /api/templates/:id — edit or remove a routine. The id never changes,
    // and days already started keep their own copy of the tasks.
    if (parts.length === 3 && (method === 'PUT' || method === 'DELETE')) {
      const GONE = { error: 'That routine is no longer in templates.json.', status: 404 };
      if (!templates.some((t) => t.id === tid)) return send(res, 404, { error: GONE.error });
      const body = method === 'PUT' ? await readBody(req) : null;
      const input = body ? routineFromBody(body) : null;
      if (input && input.error) return send(res, 400, input);
      const result = await editTemplatesFile((list) => {
        const i = list.findIndex((t) => rawTemplateId(t) === tid);
        if (i < 0) return GONE;
        if (!input) { list.splice(i, 1); return { ok: true }; }
        if (nameTaken(list, input.name, tid)) return { error: `You already have a routine called “${input.name}”.` };
        const { name: _n, minutes: _m, worth: _w, tasks: _t, ...extra } = list[i]; // keeps any extra hand-written fields
        list[i] = { id: tid, ...extra, ...templateFields(input) };
        return { id: tid, ...templateFields(input), worth: input.worth };
      });
      if (result.error) return send(res, result.status || 400, { error: result.error });
      // a new worth also counts for today's day (the app sends its local date), unless it's archived
      const day = input && typeof body.date === 'string' &&
        db.projects.find((p) => p.templateId === tid && p.date === body.date && !p.archived);
      if (day && day.worth !== input.worth) { day.worth = input.worth; await saveDb(); }
      return send(res, 200, result);
    }

    // /api/templates/:id/start {date: 'YYYY-MM-DD'} — today's instance (one per template per day)
    if (parts.length === 4 && parts[3] === 'start' && method === 'POST') {
      const template = templates.find((t) => t.id === tid);
      if (!template) return send(res, 404, { error: 'Routine not found in templates.json' });
      const body = await readBody(req);
      const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
      if (!date) return send(res, 400, { error: 'A date (YYYY-MM-DD) is required.' });

      const existing = db.projects.find((p) => p.templateId === template.id && p.date === date);
      if (existing) return send(res, 200, existing);

      const [, m, d] = date.split('-').map(Number);
      const t = now();
      const project = {
        id: crypto.randomUUID(),
        name: `${template.name} ${MONTHS[m - 1]} ${d}`,
        createdAt: t,
        progress: 0,
        templateId: template.id,
        date,
        tasks: template.tasks.map((k, i) => ({ id: `t${i + 1}`, name: k.name, percent: k.percent, done: false })),
        completed: false,
        archived: false,
        worth: template.worth ?? 100,
        // racing the clock: it starts on "Start the clock" or the first tick (see startClock)
        ...(template.minutes && { timer: { minutes: template.minutes, startedAt: null, endsAt: null, result: null, finishedAt: null } }),
        history: [{ at: t, value: 0, delta: 0, note: 'Routine started', kind: 'start' }],
      };
      db.projects.push(project);
      await saveDb();
      return send(res, 201, project);
    }
    return send(res, 404, { error: 'Not found' });
  }

  // /api/grove — the token pick log and the spend log
  if (parts[1] === 'grove') {
    const picks = db.grove.picks;
    const spends = db.grove.spends || [];
    if (parts.length === 2 && method === 'GET') return send(res, 200, { picks, spends });
    // POST /api/grove/spends {type, count, slot} — spend tokens at the campfire: one hour on the clock
    // per token. Append-only, like picks. Whether there are enough tokens is up to the client (the Grove
    // total is derived there); slot must equal spends.length so a double click can't spend twice.
    if (parts.length === 3 && parts[2] === 'spends' && method === 'POST') {
      const body = await readBody(req);
      if (!TOKEN_TYPES.includes(body.type)) return send(res, 400, { error: 'Pick a token type to spend: Terraform, Recruit, Design or Building.' });
      const count = Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > MAX_SPEND) return send(res, 400, { error: `Spend a whole number of tokens, from 1 to ${MAX_SPEND}.` });
      if (body.slot !== spends.length) return send(res, 409, { error: 'Those tokens were already spent. Refresh to see your fire.' });
      const at = now();
      const endsAt = new Date(Date.parse(at) + count * HOUR_MS).toISOString();
      db.grove.spends = [...spends, { id: crypto.randomUUID(), type: body.type, count, at, endsAt }];
      await saveDb();
      return send(res, 201, { picks, spends: db.grove.spends });
    }
    // POST /api/grove/picks {type, slot} — lock in the type of the next token. Picks are never changed.
    if (parts.length === 3 && parts[2] === 'picks' && method === 'POST') {
      const body = await readBody(req);
      if (!TOKEN_TYPES.includes(body.type)) return send(res, 400, { error: 'Pick a token type: Terraform, Recruit, Design or Building.' });
      if (body.slot !== picks.length) return send(res, 409, { error: 'That token was already chosen. Refresh to see it.' });
      picks.push({ type: body.type, at: now() });
      await saveDb();
      return send(res, 201, { picks, spends });
    }
    return send(res, 404, { error: 'Not found' });
  }

  if (parts[1] !== 'projects') return send(res, 404, { error: 'Not found' });

  // /api/projects
  if (parts.length === 2) {
    if (method === 'GET') return send(res, 200, db.projects);
    if (method === 'POST') {
      const body = await readBody(req);
      const name = cleanName(body.name);
      // every planted tracker is a journey (routines come from templates)
      if (!name) return send(res, 400, { error: 'Give your journey a name.' });
      const input = stagesFromBody(body.stages);
      if (input.error) return send(res, 400, input);
      const worth = parseWorth(body.worth);
      if (worth.error) return send(res, 400, { error: WORTH_ERROR });
      const t = now();
      const project = {
        id: crypto.randomUUID(),
        name,
        createdAt: t,
        progress: 0,
        stages: input.stages,
        worth: worth.worth,
        history: [{ at: t, value: 0, delta: 0, note: 'Journey planted', kind: 'start' }],
      };
      db.projects.push(project);
      await saveDb();
      return send(res, 201, project);
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  const project = db.projects.find((p) => p.id === parts[2]);
  if (!project) return send(res, 404, { error: 'Tracker not found' });

  // /api/projects/:id
  if (parts.length === 3) {
    if (method === 'PATCH') {
      const body = await readBody(req);
      const name = cleanName(body.name);
      if (!name) return send(res, 400, { error: 'Name cannot be empty.' });
      project.name = name;
      await saveDb();
      return send(res, 200, project);
    }
    if (method === 'DELETE') {
      db.projects.splice(db.projects.indexOf(project), 1);
      await saveDb();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // /api/projects/:id/archive {archived: true|false}
  if (parts[3] === 'archive' && parts.length === 4 && method === 'POST') {
    const body = await readBody(req);
    project.archived = body.archived !== false;
    project.archivedAt = project.archived ? now() : null;
    await saveDb();
    return send(res, 200, project);
  }

  if (project.archived) return send(res, 400, { error: 'This tracker is archived. Restore it to make changes.' });

  // /api/projects/:id/tasks/:taskId {done: true|false}
  if (parts[3] === 'tasks' && parts.length === 5 && method === 'POST') {
    if (!project.tasks) return send(res, 400, { error: 'This tracker has no tasks.' });
    const task = project.tasks.find((t) => t.id === parts[4]);
    if (!task) return send(res, 404, { error: 'Task not found' });
    const body = await readBody(req);
    const done = body.done !== false;
    if (task.done === done) return send(res, 200, project);
    if (done && project.timer && !project.timer.startedAt) startClock(project); // the first tick starts the race
    task.done = done;
    task.doneAt = done ? now() : null;
    if (!done) project.completed = false; // un-ticking a task takes the potion back off 100
    recordTaskProgress(project, done ? task.name : `Unchecked: ${task.name}`, 'task');
    if (done) checkFinish(project);
    else resumeClock(project); // unticking a finished race starts the clock again
    await saveDb();
    return send(res, 200, project);
  }

  // /api/projects/:id/timer — start racing the clock on a timed routine day
  if (parts[3] === 'timer' && parts.length === 4 && method === 'POST') {
    if (!project.timer) return send(res, 400, { error: 'This routine has no clock to race. Give the routine a time limit with ✎ in the Routines menu.' });
    if (project.timer.startedAt) return send(res, 200, project);
    if (allTasksDone(project)) return send(res, 400, { error: 'Every task is already done, so there is nothing left to race.' });
    startClock(project);
    await saveDb();
    return send(res, 200, project);
  }

  // /api/projects/:id/complete — all tasks done, fill the rest of the potion
  if (parts[3] === 'complete' && parts.length === 4 && method === 'POST') {
    if (!project.tasks) return send(res, 400, { error: 'This tracker has no tasks.' });
    if (!project.tasks.every((t) => t.done)) return send(res, 400, { error: 'Finish every task first.' });
    if (project.completed) return send(res, 200, project);
    project.completed = true;
    recordTaskProgress(project, 'All tasks done', 'complete');
    await saveDb();
    return send(res, 200, project);
  }

  // PUT /api/projects/:id/stages {name?, stages: [{id?, name, share}]} — reshape a journey
  if (parts[3] === 'stages' && parts.length === 4 && method === 'PUT') {
    if (!project.stages) return send(res, 400, { error: 'This tracker has no stages.' });
    const body = await readBody(req);
    const input = stagesFromBody(body.stages, project.stages);
    if (input.error) return send(res, 400, input);
    // worth is optional here: leave it as it is when it isn't sent
    if (body.worth !== undefined) {
      const worth = parseWorth(body.worth);
      if (worth.error) return send(res, 400, { error: WORTH_ERROR });
      project.worth = worth.worth;
    }
    const name = cleanName(body.name);
    if (name) project.name = name;
    if (JSON.stringify(input.stages) !== JSON.stringify(project.stages)) {
      project.stages = input.stages;
      const next = journeyProgress(project);
      const delta = round1(next - project.progress);
      project.progress = next;
      project.history.push({ at: now(), value: next, delta, note: 'Stages reshaped', kind: 'reshape' });
    }
    await saveDb();
    return send(res, 200, project);
  }

  // /api/projects/:id/stages/:stageId/... — one stage of a journey
  if (parts[3] === 'stages' && parts.length >= 6) {
    if (!project.stages) return send(res, 400, { error: 'This tracker has no stages.' });
    const stage = project.stages.find((s) => s.id === parts[4]);
    if (!stage) return send(res, 404, { error: 'That stage is no longer in this journey.' });
    const hasTasks = !!(stage.tasks && stage.tasks.length);

    // POST .../progress {value, note} — fill a stage by hand (only while it has no tasks)
    if (parts[5] === 'progress' && parts.length === 6 && method === 'POST') {
      if (hasTasks) return send(res, 400, { error: `“${stage.name}” fills up from its tasks. Tick them off instead.` });
      const body = await readBody(req);
      const value = Number(body.value);
      if (!Number.isFinite(value)) return send(res, 400, { error: 'Progress must be a number.' });
      const to = round1(clamp(value, 0, 100));
      const note = cleanNote(body.note);
      if (to === stage.progress && !note) return send(res, 200, project);
      const from = stage.progress;
      stage.progress = to;
      recordStage(project, stage, from, { note });
      await saveDb();
      return send(res, 200, project);
    }

    // POST .../tasks {name} — add a task; from now on the stage fills from its tasks
    if (parts[5] === 'tasks' && parts.length === 6 && method === 'POST') {
      const name = cleanTaskName((await readBody(req)).name);
      if (!name) return send(res, 400, { error: 'Give the task a name.' });
      if (hasTasks && stage.tasks.length >= MAX_STAGE_TASKS) return send(res, 400, { error: `A stage can hold up to ${MAX_STAGE_TASKS} tasks.` });
      const tasks = stage.tasks || (stage.tasks = []);
      tasks.push({ id: nextId(tasks, 't'), name, done: false });
      const from = stage.progress;
      stageFromTasks(stage);
      if (stage.progress !== from) recordStage(project, stage, from, { note: `Added task: ${name}`, kind: 'tasks' });
      await saveDb();
      return send(res, 201, project);
    }

    // POST .../tasks/:taskId/move {by} and .../subtasks/:subId/move {by} — shift one place up (-1) or down (1).
    // Only the order changes (it's saved), so progress and history are untouched.
    if (parts[5] === 'tasks' && method === 'POST' &&
        ((parts.length === 8 && parts[7] === 'move') || (parts.length === 10 && parts[7] === 'subtasks' && parts[9] === 'move'))) {
      const task = hasTasks && stage.tasks.find((t) => t.id === parts[6]);
      if (!task) return send(res, 404, { error: 'That task is no longer in this stage.' });
      const list = parts.length === 8 ? stage.tasks : task.subtasks;
      const item = parts.length === 8 ? task : list && list.find((u) => u.id === parts[8]);
      if (!item) return send(res, 404, { error: 'That smaller task is no longer there.' });
      const by = Number((await readBody(req)).by);
      if (by !== -1 && by !== 1) return send(res, 400, { error: 'A task moves one place up or down.' });
      const from = list.indexOf(item);
      const to = from + by;
      if (to < 0 || to >= list.length) return send(res, 200, project); // already at the top / bottom
      list.splice(from, 1);
      list.splice(to, 0, item);
      await saveDb();
      return send(res, 200, project);
    }

    // PATCH .../tasks/:taskId {name} and .../subtasks/:subId {name} — rename.
    // Only the name changes, so progress and history are untouched (older Trail notes keep the old name).
    if (parts[5] === 'tasks' && method === 'PATCH' &&
        (parts.length === 7 || (parts.length === 9 && parts[7] === 'subtasks'))) {
      const task = hasTasks && stage.tasks.find((t) => t.id === parts[6]);
      if (!task) return send(res, 404, { error: 'That task is no longer in this stage.' });
      const item = parts.length === 7 ? task : task.subtasks && task.subtasks.find((u) => u.id === parts[8]);
      if (!item) return send(res, 404, { error: 'That smaller task is no longer there.' });
      const name = cleanTaskName((await readBody(req)).name);
      if (!name) return send(res, 400, { error: parts.length === 7 ? 'Give the task a name.' : 'Give the smaller task a name.' });
      if (name === item.name) return send(res, 200, project);
      item.name = name;
      await saveDb();
      return send(res, 200, project);
    }

    // POST .../tasks/:taskId {done} — tick or untick; DELETE — remove the task
    if (parts[5] === 'tasks' && parts.length === 7 && (method === 'POST' || method === 'DELETE')) {
      const task = hasTasks && stage.tasks.find((t) => t.id === parts[6]);
      if (!task) return send(res, 404, { error: 'That task is no longer in this stage.' });
      const from = stage.progress;
      if (method === 'DELETE') {
        stage.tasks.splice(stage.tasks.indexOf(task), 1);
        if (stage.tasks.length) stageFromTasks(stage);
        else delete stage.tasks; // back to filling by hand, keeping the progress it had
        if (stage.progress !== from) recordStage(project, stage, from, { note: `Removed task: ${task.name}`, kind: 'tasks' });
      } else {
        if (task.subtasks && task.subtasks.length) return send(res, 400, { error: `“${task.name}” ticks itself when its smaller tasks are done.` });
        const done = (await readBody(req)).done !== false;
        if (task.done === done) return send(res, 200, project);
        task.done = done;
        task.doneAt = done ? now() : null;
        stageFromTasks(stage);
        recordStage(project, stage, from, { note: done ? task.name : `Unchecked: ${task.name}`, task: task.id, taskDone: done });
      }
      await saveDb();
      return send(res, 200, project);
    }

    // .../tasks/:taskId/subtasks[/:subId] — smaller tasks under a task (one level only)
    if (parts[5] === 'tasks' && parts[7] === 'subtasks' && (parts.length === 8 || parts.length === 9)) {
      const task = hasTasks && stage.tasks.find((t) => t.id === parts[6]);
      if (!task) return send(res, 404, { error: 'That task is no longer in this stage.' });
      const from = stage.progress;
      const log = (note, extra = { kind: 'tasks' }) => { if (stage.progress !== from || extra.sub) recordStage(project, stage, from, { note, ...extra }); };

      // POST .../subtasks {name} — add one; the task now ticks itself when they're all done
      if (parts.length === 8 && method === 'POST') {
        const name = cleanTaskName((await readBody(req)).name);
        if (!name) return send(res, 400, { error: 'Give the smaller task a name.' });
        const subs = task.subtasks || (task.subtasks = []);
        if (subs.length >= MAX_SUBTASKS) return send(res, 400, { error: `A task can hold up to ${MAX_SUBTASKS} smaller tasks.` });
        subs.push({ id: nextId(subs, 'u'), name, done: false });
        stageFromTasks(stage);
        log(`Added: ${name} (under ${task.name})`);
        await saveDb();
        return send(res, 201, project);
      }

      const sub = parts.length === 9 && task.subtasks && task.subtasks.find((u) => u.id === parts[8]);
      if (!sub) return send(res, 404, { error: 'That smaller task is no longer there.' });

      // DELETE .../subtasks/:subId — remove; the last one gone leaves the task ticked or not as it was
      if (method === 'DELETE') {
        task.subtasks.splice(task.subtasks.indexOf(sub), 1);
        if (!task.subtasks.length) delete task.subtasks;
        stageFromTasks(stage);
        log(`Removed: ${sub.name} (under ${task.name})`);
        await saveDb();
        return send(res, 200, project);
      }

      // POST .../subtasks/:subId {done} — tick or untick
      if (method === 'POST') {
        const done = (await readBody(req)).done !== false;
        if (sub.done === done) return send(res, 200, project);
        sub.done = done;
        sub.doneAt = done ? now() : null;
        stageFromTasks(stage);
        log(done ? `${task.name} › ${sub.name}` : `Unchecked: ${task.name} › ${sub.name}`, { task: task.id, sub: sub.id, taskDone: done });
        await saveDb();
        return send(res, 200, project);
      }
    }
    return send(res, 404, { error: 'Not found' });
  }

  const TASK_DRIVEN = 'This tracker fills up from its tasks.';
  const STAGE_DRIVEN = 'A journey fills up from its stages. Pick a stage to fill.';

  // /api/projects/:id/progress  — gone with plain projects; say where to fill instead
  if (parts[3] === 'progress' && parts.length === 4 && method === 'POST') {
    return send(res, 400, { error: project.tasks ? TASK_DRIVEN : STAGE_DRIVEN });
  }

  // /api/projects/:id/history/last — undo the most recent update
  if (parts[3] === 'history' && parts[4] === 'last' && method === 'DELETE') {
    if (project.tasks) return send(res, 400, { error: TASK_DRIVEN });
    const last = project.history[project.history.length - 1];
    if (!last || last.kind === 'start') return send(res, 400, { error: 'Nothing to undo.' });
    // journeys: put the stage back where it was and re-derive the overall potion
    if (last.kind === 'reshape') return send(res, 400, { error: "The last change reshaped the stages, which can't be undone. Edit the stages instead." });
    if (last.kind === 'tasks') return send(res, 400, { error: "The last change added or removed a task, which can't be undone." });
    const stage = project.stages.find((s) => s.id === last.stage);
    const task = stage && last.task && stage.tasks && stage.tasks.find((t) => t.id === last.task);
    const sub = task && last.sub && task.subtasks && task.subtasks.find((u) => u.id === last.sub);
    // undo a tick/untick (a task with smaller tasks re-derives its own tick in stageFromTasks)
    const target = last.sub ? sub : task;
    if (target) { target.done = !last.taskDone; target.doneAt = target.done ? now() : null; }
    if (stage && stage.tasks && stage.tasks.length) stageFromTasks(stage);
    else if (stage) stage.progress = last.stageFrom;
    project.history.pop();
    project.progress = journeyProgress(project);
    await saveDb();
    return send(res, 200, project);
  }

  return send(res, 404, { error: 'Not found' });
}

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message || 'Something went wrong' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — Grove is probably already running.`);
    console.error(`  Open http://localhost:${PORT}, or stop the other copy, or pick another port:`);
    console.error(`    PORT=4322 npm start\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

ensureTemplatesFile();

const migrated = migratePlainProjects();
if (migrated) {
  // keep the untouched file next to it before the first rewrite
  const backup = DATA_FILE + '.before-journeys.bak';
  if (!fs.existsSync(backup)) fs.copyFileSync(DATA_FILE, backup);
  saveDb();
  console.log(`\n  Turned ${migrated} plain project${migrated === 1 ? '' : 's'} into journeys (old file kept at ${backup}).`);
}
if (migrateGrove()) {
  saveDb();
  console.log(`\n  Gave your ${FIRST_PICKS.length} Grove tokens their types (2 Design, 2 Terraform, 2 Building, 1 Recruit).`);
}

server.listen(PORT, HOST, () => {
  console.log(`\n  🌲 Grove is growing at  http://localhost:${PORT}`);
  console.log(`     Data file: ${DATA_FILE}`);
  console.log(`     Routines:  ${TEMPLATES_FILE}\n`);
});
