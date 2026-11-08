/**
 * MCP Apps widget for interview_next: the open questions as cards with
 * answer chips, check boxes ("check all that apply") and text boxes, under
 * the current phase's title and intro. "Save answers" records them with profile_set (the same
 * validation as the AI's own calls), then sends one chat message saying what
 * was saved so the assistant carries on. Hosts without MCP Apps ignore this
 * and the AI asks in text (the tool result is unchanged).
 *
 * The MCP Apps runtime (@modelcontextprotocol/ext-apps "app-with-deps", one
 * self-contained ESM file) is inlined, so the page needs no network access.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export const INTERVIEW_WIDGET_URI = 'ui://1040kit/interview.html';

let cached: string | undefined;

/** The ext-apps browser bundle with its final `export{a as B,…}` turned into a global. */
export function appRuntimeScript(): string {
  const require = createRequire(import.meta.url);
  const file = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
  const src = readFileSync(file, 'utf8');
  const m = /export\s*\{([^}]*)\};?\s*$/.exec(src);
  if (!m) throw new Error('ext-apps bundle: no trailing export list');
  const pairs = m[1]!
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [local, exported] = p.split(/\s+as\s+/);
      return `${JSON.stringify(exported ?? local)}:${local}`;
    });
  return (
    src.slice(0, m.index) + `globalThis.McpApps={${pairs.join(',')}};`
  ).replace(/<\/script/gi, '<\\/script');
}

export function interviewWidgetHtml(): string {
  cached ??= PAGE.replace('/*__APP_RUNTIME__*/', () => appRuntimeScript());
  return cached;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>1040kit questions</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--color-background-primary, light-dark(#ffffff, #1f1f1e));
    --card: var(--color-background-secondary, light-dark(#f6f5f1, #2a2a28));
    --text: var(--color-text-primary, light-dark(#1a1a19, #f2f1ec));
    --muted: var(--color-text-secondary, light-dark(#5f5e5a, #b4b2a9));
    --line: var(--color-border-primary, light-dark(#dedcd3, #3d3d3a));
    --accent: light-dark(#1d5fd1, #7aa7ff);
    --accent-text: light-dark(#ffffff, #0e1a33);
    --bad: light-dark(#b3261e, #ff8a80);
    --radius: var(--border-radius-lg, 12px);
    font-family: var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  }
  body { margin: 0; background: transparent; color: var(--text); font-size: 15px; line-height: 1.4; }
  main { padding: 4px 2px 8px; display: grid; gap: 10px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .head h1 { font-size: 15px; font-weight: 600; margin: 0; }
  .head span { color: var(--muted); font-size: 13px; }
  .q { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; display: grid; gap: 8px; }
  .q p { margin: 0; }
  .q .why { color: var(--muted); font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font: inherit; font-size: 14px; border: 1px solid var(--line); background: var(--bg); color: var(--text);
          border-radius: 999px; padding: 6px 12px; cursor: pointer; min-height: 32px; }
  .chip:hover { border-color: var(--accent); }
  .chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .chip:focus-visible, input:focus-visible, .save:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  input { font: inherit; font-size: 14px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px;
          background: var(--bg); color: var(--text); max-width: 220px; }
  .money { display: flex; align-items: center; gap: 4px; }
  .note { color: var(--muted); font-size: 13px; font-style: italic; }
  .err { color: var(--bad); font-size: 13px; }
  .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .save { font: inherit; font-weight: 600; border: 0; border-radius: 999px; padding: 8px 16px;
          background: var(--accent); color: var(--accent-text); cursor: pointer; }
  .save:disabled { opacity: .45; cursor: default; }
  .status { color: var(--muted); font-size: 13px; }
  .q.saved { opacity: .7; }
  .q.saved .chip, .q.saved input { pointer-events: none; }
  .ok { color: var(--muted); font-size: 13px; }
  .done { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; }
  .phase { display: grid; gap: 2px; }
  .phase .step { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .phase h1 { font-size: 16px; font-weight: 600; margin: 0; }
  .phase p { margin: 0; color: var(--muted); font-size: 14px; }
  .checks { display: grid; gap: 2px; }
  .check { display: flex; align-items: flex-start; gap: 10px; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
  .check:hover { background: var(--bg); }
  .check input { width: 18px; height: 18px; margin: 1px 0 0; flex: none; accent-color: var(--accent); max-width: none; padding: 0; }
  .check.none { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 10px; border-radius: 0 0 8px 8px; }
  .other-text { margin: 2px 0 4px 36px; max-width: calc(100% - 44px); width: 320px; }
  .q.saved .check { pointer-events: none; }
</style>
</head>
<body>
<main id="root"><p class="status">Loading questions…</p></main>
<script type="module">/*__APP_RUNTIME__*/</script>
<script type="module">
const { App, PostMessageTransport, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } = globalThis.McpApps;
const root = document.getElementById('root');
const app = new App({ name: '1040kit interview', version: '0.1.0' }, {}, { autoResize: true });

let workspace = null;
let questions = [];
const answers = new Map(); // question path -> { value, label } or { sets: [{ path, value }], label }

const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids) n.append(k);
  return n;
};

function choose(q, value, label, group) {
  answers.set(q.path, { value, label });
  if (group) for (const b of group.querySelectorAll('.chip')) b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
  refreshBar();
}

function chips(q, options) {
  const group = el('div', { class: 'chips', role: 'group', 'aria-label': q.question });
  for (const o of options) {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, o.label);
    b.dataset.v = String(o.value);
    b.addEventListener('click', () => choose(q, o.value, o.label, group));
    group.append(b);
  }
  return group;
}

function input(q, type, parse, show) {
  const i = el('input', { type, 'aria-label': q.question });
  i.addEventListener('input', () => {
    const v = parse(i.value);
    if (v === undefined) answers.delete(q.path); else answers.set(q.path, { value: v, label: show(i.value) });
    refreshBar();
  });
  return i;
}

// "Check all that apply": every option is saved, true when checked and false
// otherwise, so one card replaces a yes/no question per situation.
function multiselect(q, a) {
  const box = el('div', { class: 'checks', role: 'group', 'aria-label': q.question });
  const picked = new Set();
  let none = false, otherOn = false, otherText = '';
  const boxes = [];
  const row = (label, cls, onchange) => {
    const i = el('input', { type: 'checkbox' });
    i.addEventListener('change', () => onchange(i.checked));
    const l = el('label', { class: 'check' + (cls ? ' ' + cls : '') }, i, el('span', {}, label));
    box.append(l);
    return i;
  };
  const otherInput = el('input', { type: 'text', class: 'other-text', placeholder: 'What was it?', 'aria-label': 'Describe the other situation', hidden: '' });
  const update = () => {
    const other = otherOn ? otherText.trim() : '';
    if (otherOn && !other) { answers.delete(q.path); refreshBar(); return; }
    if (!none && picked.size === 0 && !other) { answers.delete(q.path); refreshBar(); return; }
    const sets = a.options.map((o) => ({ path: o.path, value: picked.has(o.path) }));
    if (a.other) sets.push({ path: a.other.path, value: other ? [other] : [] });
    const chosen = a.options.filter((o) => picked.has(o.path)).map((o) => o.label);
    if (other) chosen.push('Something else: ' + other);
    answers.set(q.path, { sets, label: chosen.length ? chosen.join('; ') : a.noneLabel });
    refreshBar();
  };
  let noneBox;
  const clearNone = () => { none = false; if (noneBox) noneBox.checked = false; };
  for (const o of a.options) {
    boxes.push(row(o.label, '', (on) => { if (on) { picked.add(o.path); clearNone(); } else picked.delete(o.path); update(); }));
  }
  let otherBox;
  if (a.other) {
    otherBox = row(a.other.label, '', (on) => {
      otherOn = on; otherInput.hidden = !on;
      if (on) { clearNone(); otherInput.focus(); }
      update();
    });
    otherInput.addEventListener('input', () => { otherText = otherInput.value; update(); });
    box.append(otherInput);
  }
  noneBox = row(a.noneLabel, 'none', (on) => {
    none = on;
    if (on) {
      picked.clear(); otherOn = false; otherInput.hidden = true;
      for (const b of boxes) b.checked = false;
      if (otherBox) otherBox.checked = false;
    }
    update();
  });
  return box;
}

function control(q) {
  const a = q.answer || { kind: 'open' };
  switch (a.kind) {
    case 'multiselect': return multiselect(q, a);
    case 'yesno': return chips(q, [{ value: true, label: 'Yes' }, { value: false, label: 'No' }]);
    case 'choice': return chips(q, a.options);
    case 'number':
      if (a.min !== undefined && a.max !== undefined && a.max - a.min <= 12) {
        const opts = [];
        for (let n = a.min; n <= a.max; n++) opts.push({ value: n, label: String(n) });
        return chips(q, opts);
      }
      return input(q, 'number', (s) => (s.trim() === '' || !Number.isInteger(Number(s)) ? undefined : Number(s)), (s) => s);
    case 'amount': {
      const i = input(q, 'text', (s) => {
        const n = Number(s.replace(/[$,\\s]/g, ''));
        return s.trim() === '' || !Number.isFinite(n) ? undefined : Math.round(n * 100);
      }, (s) => '$' + s.replace(/^\\$/, ''));
      i.setAttribute('inputmode', 'decimal');
      i.setAttribute('placeholder', '0.00');
      return el('div', { class: 'money' }, '$', i);
    }
    case 'date': return input(q, 'date', (s) => (/^\\d{4}-\\d{2}-\\d{2}$/.test(s) ? s : undefined), (s) => s);
    case 'text': return input(q, 'text', (s) => (s.trim() ? s.trim() : undefined), (s) => s.trim());
    default: return el('p', { class: 'note' }, 'Answer this one in the chat.');
  }
}

let saveBtn, statusEl;
// Tell the host how tall the card is (autoResize misses changes inside a fixed-height frame).
function reportSize() {
  const height = Math.ceil(root.getBoundingClientRect().height) + 4;
  app.sendSizeChanged({ height }).catch(() => {});
}
new ResizeObserver(reportSize).observe(root);
function refreshBar() {
  if (!saveBtn) return;
  saveBtn.disabled = answers.size === 0;
  saveBtn.textContent = answers.size > 1 ? 'Save ' + answers.size + ' answers' : 'Save answer';
}

function render(result) {
  const data = result && result.structuredContent;
  root.replaceChildren();
  if (!data || data.ok === false) {
    root.append(el('p', { class: 'err' }, (data && data.error && data.error.message) || 'Could not load the questions.'));
    return;
  }
  workspace = data.workspace;
  questions = data.questions || [];
  answers.clear();
  if (data.done || questions.length === 0) {
    root.append(el('div', { class: 'done' }, 'All questions are answered. The assistant can calculate your return now.'));
    return;
  }
  const more = data.remaining - questions.length;
  const step = data.phase === 'deductions' ? 'Part 2 of 2' : 'Part 1 of 2';
  root.append(el('div', { class: 'phase' },
    el('span', { class: 'step' }, step),
    el('h1', {}, data.phaseTitle || 'A few questions for your return'),
    ...(data.phaseIntro ? [el('p', {}, data.phaseIntro)] : [])));
  if (more > 0) root.append(el('div', { class: 'head' }, el('span', {}, questions.length + ' shown, ' + more + ' more after these')));
  for (const q of questions) {
    const card = el('section', { class: 'q', 'aria-label': q.question },
      el('p', {}, q.question),
      ...(q.why ? [el('p', { class: 'why' }, q.why)] : []),
      control(q),
      el('p', { class: 'err', hidden: '' }));
    card.dataset.path = q.path;
    if (q.answer && q.answer.kind === 'multiselect')
      card.dataset.paths = JSON.stringify([...q.answer.options.map((o) => o.path), ...(q.answer.other ? [q.answer.other.path] : [])]);
    root.append(card);
  }
  saveBtn = el('button', { class: 'save', type: 'button', disabled: '' }, 'Save answer');
  saveBtn.addEventListener('click', save);
  statusEl = el('span', { class: 'status', role: 'status' });
  root.append(el('div', { class: 'bar' }, saveBtn, statusEl));
}

function cardFor(path) {
  return [...root.querySelectorAll('section.q')].find((s) =>
    s.dataset.path === path || (s.dataset.paths && JSON.parse(s.dataset.paths).includes(path)));
}
// Rejections come back per fact path; map them to the question that set it.
function questionPathFor(path) {
  const c = cardFor(path);
  return c ? c.dataset.path : path;
}

async function save() {
  const entries = [...answers.entries()];
  if (!entries.length || !workspace) return;
  saveBtn.disabled = true;
  statusEl.textContent = 'Saving…';
  for (const s of root.querySelectorAll('.err')) s.hidden = true;
  let env;
  try {
    const r = await app.callServerTool({
      name: 'profile_set',
      arguments: { workspace, set: entries.flatMap(([path, a]) =>
        (a.sets || [{ path, value: a.value }]).map((x) => ({ path: x.path, value: x.value, source: 'user' }))) },
    });
    env = r.structuredContent;
  } catch (e) {
    env = { ok: false, error: { message: String(e && e.message || e) } };
  }
  if (!env || env.ok === false) {
    statusEl.textContent = (env && env.error && env.error.message) || 'Could not save.';
    saveBtn.disabled = false;
    return;
  }
  const rejected = new Map((env.rejected || []).map((r) => [questionPathFor(r.path), r.reason || 'Not accepted']));
  for (const [path, why] of rejected) {
    const c = cardFor(path);
    if (c) { const e = c.querySelector('.err'); e.textContent = why; e.hidden = false; }
  }
  const saved = entries.filter(([p]) => !rejected.has(p));
  for (const [p] of saved) {
    answers.delete(p);
    const c = cardFor(p);
    if (c && !c.classList.contains('saved')) {
      c.classList.add('saved');
      for (const i of c.querySelectorAll('button, input')) i.setAttribute('disabled', '');
      c.append(el('p', { class: 'ok' }, 'Saved'));
    }
  }
  const lines = saved.map(([p, a]) => {
    const q = questions.find((x) => x.path === p);
    if (q && q.answer && q.answer.kind === 'multiselect') return '- Situations that apply: ' + a.label;
    return '- ' + (q ? q.question : p) + ' ' + a.label;
  });
  statusEl.textContent = saved.length ? 'Saved ' + saved.length + '.' : '';
  refreshBar();
  if (!saved.length) return;
  const text = 'I answered in the 1040kit card (saved with profile_set):\\n' + lines.join('\\n') +
    (rejected.size ? '\\nSome answers were not accepted; I will fix them in the card.' : '\\nPlease continue.');
  const caps = app.getHostCapabilities() || {};
  try {
    if (caps.message) await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
    else {
      await app.updateModelContext({ content: [{ type: 'text', text }] });
      statusEl.textContent += ' Tell the assistant to continue.';
    }
  } catch {
    statusEl.textContent += ' Tell the assistant to continue.';
  }
}

app.ontoolresult = (result) => render(result);
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles && ctx.styles.css && ctx.styles.css.fonts) applyHostFonts(ctx.styles.css.fonts);
};
await app.connect(new PostMessageTransport(window.parent, window.parent));
const ctx = app.getHostContext();
if (ctx) app.onhostcontextchanged(ctx);
</script>
</body>
</html>
`;
