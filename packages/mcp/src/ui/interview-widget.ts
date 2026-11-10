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
  .other-hint { margin: 0 0 4px 36px; color: var(--bad); font-size: 13px; }
  .q.saved .check { pointer-events: none; }
  .form { display: grid; gap: 12px; }
  .row { display: grid; gap: 5px; }
  .row > .label { font-size: 13px; color: var(--muted); }
  .row.saved { opacity: .6; }
  .row.saved .chip, .row.saved input { pointer-events: none; }
  .person { display: grid; gap: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
  .person h2 { font-size: 13px; font-weight: 600; margin: 0; }
  .person.first { border-top: 0; padding-top: 0; }
  .person-head { display: flex; justify-content: space-between; align-items: center; }
  .remove { font: inherit; font-size: 13px; border: 0; background: transparent; color: var(--muted); cursor: pointer; text-decoration: underline; }
  .remove:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .add { font: inherit; font-size: 14px; justify-self: start; border: 1px dashed var(--line); background: transparent;
         color: var(--accent); border-radius: 999px; padding: 6px 12px; cursor: pointer; }
  .add:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  [hidden] { display: none !important; }
  .section { font-size: 13px; font-weight: 600; margin: 4px 0 0; }
  .row .check, .row .swap { padding: 4px 0; }
  .row .check:hover { background: transparent; }
  .item-amount { margin: 0 0 6px 36px; }
  .hint { color: var(--muted); font-size: 12px; display: block; }
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

// Put a value into a row's control (prefill, or the main-filer switch), as if typed or clicked.
function setValue(row, answer, value) {
  const kind = answer && answer.kind;
  if (kind === 'check') {
    const box = row.querySelector('input[type=checkbox]');
    box.checked = value === true;
    box.dispatchEvent(new Event('change'));
    return;
  }
  const chipsEl = row.querySelector('.chips');
  if (chipsEl) {
    const match = [...chipsEl.querySelectorAll('.chip')].find((b) => b.dataset.v === String(value));
    if (match) match.click();
    else {
      for (const b of chipsEl.querySelectorAll('.chip')) b.setAttribute('aria-pressed', 'false');
      answers.delete(row.dataset.path);
      refreshBar();
    }
    return;
  }
  const box = row.querySelector('input');
  if (!box) return;
  box.value = value === undefined || value === null ? '' : kind === 'amount' ? (Number(value) / 100).toFixed(2) : String(value);
  box.dispatchEvent(new Event('input'));
}

// One check box that saves true or false (unchecked is an answer too).
function checkBox(q, a) {
  const i = el('input', { type: 'checkbox' });
  const set = () => { answers.set(q.path, { value: i.checked, label: i.checked ? 'Yes' : 'No' }); refreshBar(); };
  i.addEventListener('change', set);
  answers.set(q.path, { value: false, label: 'No' });
  return el('label', { class: 'check' }, i, el('span', {}, a.label));
}

// Business or rental expenses: tick what applies, enter each total. The
// step is saved as done, so categories left unticked are $0.
function checklistForm(q, a) {
  const box = el('div', { class: 'checks', role: 'group', 'aria-label': q.question });
  const on = new Map(); // item path -> cents (undefined while the box is empty)
  let none = false;
  const update = () => {
    if (!none && on.size === 0) { answers.delete(q.path); refreshBar(); return; }
    if ([...on.values()].some((v) => v === undefined)) { answers.delete(q.path); refreshBar(); return; }
    const sets = [];
    for (const it of a.items) {
      if (on.has(it.path)) sets.push({ path: it.path, value: on.get(it.path) });
      else if (it.value) sets.push({ path: it.path, value: null });
    }
    sets.push({ path: a.done.path, value: a.done.value });
    const picked = a.items.filter((it) => on.has(it.path)).map((it) => it.label + ' $' + (on.get(it.path) / 100).toFixed(2));
    answers.set(q.path, { sets, label: picked.length ? picked.join('; ') : a.noneLabel });
    refreshBar();
  };
  const rows = [];
  let noneBox;
  for (const it of a.items) {
    const c = el('input', { type: 'checkbox' });
    const amt = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', 'aria-label': it.label + ' total' });
    const money = el('div', { class: 'money item-amount', hidden: '' }, '$', amt);
    const read = () => {
      const n = Number(amt.value.split('$').join('').split(',').join('').trim());
      on.set(it.path, amt.value.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : Math.round(n * 100));
    };
    c.addEventListener('change', () => {
      money.hidden = !c.checked;
      if (c.checked) { none = false; if (noneBox) noneBox.checked = false; read(); amt.focus(); }
      else on.delete(it.path);
      update();
    });
    amt.addEventListener('input', () => { read(); update(); });
    const label = el('label', { class: 'check' }, c, el('span', {}, it.label, ...(it.hint ? [el('span', { class: 'hint' }, it.hint)] : [])));
    box.append(label, money);
    rows.push({ it, c, amt, money });
    if (it.value) { c.checked = true; money.hidden = false; amt.value = (it.value / 100).toFixed(2); on.set(it.path, it.value); }
  }
  noneBox = el('input', { type: 'checkbox' });
  noneBox.addEventListener('change', () => {
    none = noneBox.checked;
    if (none) for (const r of rows) { r.c.checked = false; r.money.hidden = true; on.delete(r.it.path); }
    update();
  });
  box.append(el('label', { class: 'check none' }, noneBox, el('span', {}, a.noneLabel)));
  if (a.note) box.append(el('p', { class: 'why' }, a.note));
  if (on.size) update();
  return box;
}

// Rows shown only while another field has a given answer.
function applyShowIf() {
  for (const row of root.querySelectorAll('.row[data-showif]')) {
    const c = JSON.parse(row.dataset.showif);
    const v = answers.has(c.path) ? answers.get(c.path).value : undefined;
    const show = 'equals' in c ? v === c.equals : 'notEquals' in c ? v !== c.notEquals : true;
    row.hidden = !show;
  }
  for (const h of root.querySelectorAll('.section[data-section]')) {
    const rows = [...h.parentElement.querySelectorAll('.row')].filter((r) => r.dataset.section === h.dataset.section && r.closest('.form') === h.closest('.form'));
    h.hidden = rows.length > 0 && rows.every((r) => r.hidden);
  }
}
const hiddenRow = (path) => [...root.querySelectorAll('.row')].some((r) => r.dataset.path === path && r.hidden);

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
  // Its own class: save() clears '.err' messages, and this one must stay
  // until the box is filled. Shown once the user leaves the box empty.
  const otherHint = el('p', { class: 'hint other-hint', hidden: '' }, 'Describe it in a few words, or untick “Something else”.');
  let otherTouched = false;
  const update = () => {
    const other = otherOn ? otherText.trim() : '';
    otherHint.hidden = !(otherOn && !other && otherTouched);
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
    otherInput.addEventListener('blur', () => { otherTouched = true; update(); });
    box.append(otherInput, otherHint);
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

// Label of every field inside a grouped question, for the message after saving.
const fieldLabels = new Map(); // field path -> 'About Robin, Date of birth'

// A compact form: several facts about one thing (a dependent, a business),
// one row each. Every field saves to its own fact path. "Add another person"
// repeats the fields for the next dependent id.
function groupForm(q, a, card) {
  const form = el('div', { class: 'form', role: 'group', 'aria-label': q.question });
  let uid = 0;
  const addRows = (fields, into, person) => {
    let section;
    for (const f of fields) {
      if (f.hidden) {
        // Saved as is, never shown (e.g. who owns a single filer's rental).
        answers.set(f.path, { value: f.value, label: String(f.value), hidden: true });
        continue;
      }
      if (f.section && f.section !== section) {
        section = f.section;
        into.append(el('h3', { class: 'section', 'data-section': f.section }, f.section));
      }
      // For the post-save message and the "still open" list: card, person, field.
      fieldLabels.set(f.path, { card: q.question, person: person || f.section, label: f.label, optional: !!f.optional });
      const name = person ? person + ': ' + f.label : f.label;
      const sub = { path: f.path, question: name, answer: f.answer };
      if (f.answer.kind === 'swap') {
        const box = el('input', { type: 'checkbox' });
        answers.set(f.path, { value: 'taxpayer', label: 'unchanged' });
        box.addEventListener('change', () => {
          const [a1, a2] = f.answer.sections;
          const rowsOf = (sec) => [...form.querySelectorAll('.row')].filter((r) => r.dataset.section === sec);
          const other = (path) => path.split('taxpayer').join('@').split('spouse').join('taxpayer').split('@').join('spouse');
          const second = rowsOf(a2);
          for (const r1 of rowsOf(a1)) {
            const r2 = second.find((r) => r.dataset.path === other(r1.dataset.path));
            if (!r2) continue;
            const v1 = answers.has(r1.dataset.path) ? answers.get(r1.dataset.path).value : undefined;
            const v2 = answers.has(r2.dataset.path) ? answers.get(r2.dataset.path).value : undefined;
            setValue(r1, JSON.parse(r1.dataset.answer), v2);
            setValue(r2, JSON.parse(r2.dataset.answer), v1);
          }
          answers.set(f.path, box.checked ? { value: 'spouse', label: 'the spouse is the main filer now' } : { value: 'taxpayer', label: 'unchanged' });
          refreshBar();
        });
        const row = el('div', { class: 'row' }, el('label', { class: 'check swap' }, box, el('span', {}, f.answer.label)));
        row.dataset.path = f.path;
        row.dataset.answer = JSON.stringify(f.answer);
        if (f.showIf) row.dataset.showif = JSON.stringify(f.showIf);
        into.append(row);
        continue;
      }
      const ctl = control(sub);
      const id = 'f-' + (++uid) + '-' + Math.random().toString(36).slice(2, 7);
      // A text, date or number box gets a real <label for>; chips are labelled by it.
      const box = ctl.tagName === 'INPUT' ? ctl : ctl.querySelector && ctl.querySelector('input');
      let label;
      if (box) { box.id = id; label = el('label', { class: 'label', for: id }, f.label); }
      else { label = el('span', { class: 'label', id }, f.label); if (ctl.setAttribute) ctl.setAttribute('aria-labelledby', id); }
      const row = el('div', { class: 'row' }, ...(f.answer.kind === 'check' ? [ctl] : [label, ctl]));
      row.dataset.path = f.path;
      row.dataset.answer = JSON.stringify(f.answer);
      if (f.section) row.dataset.section = f.section;
      if (f.showIf) row.dataset.showif = JSON.stringify(f.showIf);
      into.append(row);
      if (f.value !== undefined) setValue(row, f.answer, f.value);
    }
    if (card) card.dataset.paths = JSON.stringify([...JSON.parse(card.dataset.paths || '[]'), ...fields.map((f) => f.path)]);
  };
  if (a.addAnother) {
    // New people: each gets a heading, and added ones can be removed.
    const heading = a.addAnother.heading || 'Person';
    const prefix = a.addAnother.idPrefix || 'dependent_';
    const first = el('div', { class: 'person first' }, el('h2', {}, heading + ' 1'));
    addRows(a.fields, first, heading + ' 1');
    form.append(first);
    let n = a.addAnother.nextIndex;
    let count = 1;
    const add = el('button', { class: 'add', type: 'button' }, '+ ' + a.addAnother.label);
    add.addEventListener('click', () => {
      const id = prefix + n++;
      const title = heading + ' ' + (++count);
      const fields = a.addAnother.fields.map((f) => ({
        ...f,
        path: f.path.split('{id}').join(id),
        ...(f.showIf ? { showIf: { ...f.showIf, path: f.showIf.path.split('{id}').join(id) } } : {}),
      }));
      const remove = el('button', { class: 'remove', type: 'button', 'aria-label': 'Remove ' + title }, 'Remove');
      const person = el('div', { class: 'person' }, el('div', { class: 'person-head' }, el('h2', {}, title), remove));
      addRows(fields, person, title);
      remove.addEventListener('click', () => {
        const paths = new Set(fields.map((f) => f.path));
        for (const p of paths) { answers.delete(p); fieldLabels.delete(p); }
        applyShowIf();
        if (card) card.dataset.paths = JSON.stringify(JSON.parse(card.dataset.paths || '[]').filter((p) => !paths.has(p)));
        person.remove();
        refreshBar();
        add.focus();
      });
      form.insertBefore(person, add);
      const firstInput = person.querySelector('.row input, .row button');
      if (firstInput) firstInput.focus();
    });
    form.append(add);
  } else addRows(a.fields, form);
  return form;
}

function control(q, card) {
  const a = q.answer || { kind: 'open' };
  switch (a.kind) {
    case 'group': return groupForm(q, a, card);
    case 'multiselect': return multiselect(q, a);
    case 'checklist': return checklistForm(q, a);
    case 'check': return checkBox(q, a);
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
  applyShowIf();
  if (!saveBtn) return;
  const n = [...answers.entries()].filter(([p, a]) => !a.hidden && !hiddenRow(p)).length;
  saveBtn.disabled = n === 0;
  saveBtn.textContent = n > 1 ? 'Save ' + n + ' answers' : 'Save answer';
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
  fieldLabels.clear();
  if (data.done || questions.length === 0) {
    root.append(el('div', { class: 'done' }, 'All questions are answered. The assistant can calculate your return now.'));
    return;
  }
  const more = data.remaining - questions.length;
  const step = data.phase === 'payments' ? 'Part 3' : data.phase === 'deductions' ? 'Part 2' : 'Part 1';
  root.append(el('div', { class: 'phase' },
    el('span', { class: 'step' }, step),
    el('h1', {}, data.phaseTitle || 'A few questions for your return'),
    ...(data.phaseIntro ? [el('p', {}, data.phaseIntro)] : [])));
  if (more > 0) root.append(el('div', { class: 'head' }, el('span', {}, questions.length + ' shown, ' + more + ' more after these')));
  for (const q of questions) {
    const whyId = 'why-' + Math.random().toString(36).slice(2);
    const card = el('section', { class: 'q', 'aria-label': q.question, ...(q.why ? { 'aria-describedby': whyId } : {}) },
      el('p', {}, q.question),
      ...(q.why ? [el('p', { class: 'why', id: whyId }, q.why)] : []));
    card.dataset.path = q.path;
    card.append(control(q, card), el('p', { class: 'err', hidden: '' }));
    if (q.answer && q.answer.kind === 'multiselect')
      card.dataset.paths = JSON.stringify([...q.answer.options.map((o) => o.path), ...(q.answer.other ? [q.answer.other.path] : [])]);
    if (q.answer && q.answer.kind === 'checklist')
      card.dataset.paths = JSON.stringify([...q.answer.items.map((i) => i.path), q.answer.done.path]);
    root.append(card);
  }
  saveBtn = el('button', { class: 'save', type: 'button', disabled: '' }, 'Save answer');
  saveBtn.addEventListener('click', save);
  statusEl = el('span', { class: 'status', role: 'status' });
  root.append(el('div', { class: 'bar' }, saveBtn, statusEl));
  refreshBar();
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
  // The main-filer switch runs first: the other fields describe the people as shown.
  const entries = [...answers.entries()]
    .filter(([p]) => !hiddenRow(p))
    .sort(([a], [b]) => (b === 'mainFiler') - (a === 'mainFiler'));
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
  // Rejections come back per fact path; show each on its card.
  const rejectedPaths = new Map((env.rejected || []).map((r) => [r.path, r.reason || 'Not accepted']));
  const rejected = new Map();
  for (const [path, why] of rejectedPaths) {
    rejected.set(questionPathFor(path), why);
    const c = cardFor(path);
    if (c) { const e = c.querySelector('.err'); e.textContent = (fieldLabels.get(path) ? fieldLabels.get(path).label + ': ' : '') + why; e.hidden = false; }
  }
  const saved = entries.filter(([p, a]) => !(a.sets ? a.sets.some((x) => rejectedPaths.has(x.path)) : rejectedPaths.has(p)));
  const done = (r) => r.classList.contains('saved') || r.hidden || (fieldLabels.get(r.dataset.path) || {}).optional;
  for (const [p] of saved) {
    answers.delete(p);
    const c = cardFor(p);
    if (!c || c.classList.contains('saved')) continue;
    const row = [...c.querySelectorAll('.row')].find((r) => r.dataset.path === p);
    if (row) {
      // A form: mark the row; the card is done when every row is.
      row.classList.add('saved');
      for (const i of row.querySelectorAll('button, input')) i.setAttribute('disabled', '');
      if ([...c.querySelectorAll('.row')].every(done)) {
        c.classList.add('saved');
        for (const i of c.querySelectorAll('button')) i.setAttribute('disabled', '');
        c.append(el('p', { class: 'ok' }, 'Saved'));
      }
      continue;
    }
    c.classList.add('saved');
    for (const i of c.querySelectorAll('button, input')) i.setAttribute('disabled', '');
    c.append(el('p', { class: 'ok' }, 'Saved'));
  }
  const lines = saved.filter(([, a]) => !a.hidden).map(([p, a]) => {
    const q = questions.find((x) => x.path === p);
    if (q && q.answer && q.answer.kind === 'multiselect') return '- Situations that apply: ' + a.label;
    if (fieldLabels.has(p)) return null; // grouped below, one line per card
    return '- ' + (q ? q.question : p) + ' ' + a.label;
  }).filter(Boolean);
  // A grouped card: one line per card (and person), its fields after it.
  const byCard = new Map();
  for (const [p, a] of saved) {
    const f = fieldLabels.get(p);
    if (!f) continue;
    const head = f.person ? f.card.replace(/\\?$/, '') + ' — ' + f.person : f.card;
    byCard.set(head, [...(byCard.get(head) || []), f.label + ': ' + a.label]);
  }
  for (const [head, parts] of byCard) lines.push('- ' + head + ': ' + parts.join('; '));
  statusEl.textContent = saved.length ? 'Saved ' + saved.length + '.' : '';
  refreshBar();
  if (!saved.length) return;
  // Name what's still open, field by field, so the assistant knows what to ask.
  // Short field names are listed; a card of full questions gets a count.
  // Anything the card can't take is named, so it gets asked in chat.
  const still = [];
  for (const c of root.querySelectorAll('section.q')) {
    if (c.classList.contains('saved')) continue;
    const rows = [...c.querySelectorAll('.row')].filter((r) => !done(r));
    if (!c.querySelector('.row')) { still.push(c.getAttribute('aria-label')); continue; }
    const open = rows.map((r) => ({ f: fieldLabels.get(r.dataset.path), chat: !!r.querySelector('.note') })).filter((x) => x.f);
    const chat = open.filter((x) => x.chat).map((x) => x.f.label.replace(/\\?.*$/, '') + ' (answer in chat)');
    if (open.every((x) => x.f.label.length <= 45)) {
      for (const x of open) still.push((x.f.person ? x.f.person + ' ' : '') + x.f.label + (x.chat ? ' (answer in chat)' : ''));
    } else {
      const n = open.length;
      still.push(c.getAttribute('aria-label') + ': ' + n + (n === 1 ? ' question' : ' questions') + (chat.length ? ', including ' + chat.join(', ') : ''));
    }
  }
  const text = 'I answered in the 1040kit card (saved with profile_set):\\n' + lines.join('\\n') +
    (rejected.size ? '\\nSome answers were not accepted; I will fix them in the card.'
      : still.length ? '\\nStill open: ' + still.join('; ') + '.'
      : '\\nPlease continue.');
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
