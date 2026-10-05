import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as schedule from '../public/schedule.js';

// Exercise the editor's real state/actions without starting the page's timers.
function editor() {
  const elements = new Map();
  const storage = new Map();
  const requests = [];
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', open: false, hidden: false, disabled: false,
      classList: { toggle() {} },
      setAttribute() {}, removeAttribute() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      focus() { this.focused = true; },
    });
    return elements.get(selector);
  }
  element('#editorForm').elements = { visibility: [] };
  const context = vm.createContext({
    ...schedule,
    lang: 'en', t: (key) => key,
    document: { querySelector: element },
    location: { pathname: '/', reload() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    Intl, Date, console,
    requestAnimationFrame: (fn) => fn(),
  });
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').split('/* ---------- wiring ---------- */')[0];
  vm.runInContext(source + `
    renderAccount = renderVisibility = renderMine = renderPreview = showToast = () => {};
    loadProfile = async () => {};
    request = async (method, path, body) => {
      requests.push({ method, path, body });
      return profile;
    };
    globalThis.editor = { state, applyProfile, openEditor, requestStart, commit, clearPlan, renderEditorRoutine };
  `, Object.assign(context, { requests, profile: profile(false) }));
  return { ...context.editor, elements, storage, requests, context };
}

function profile(enabled) {
  return {
    me: { sub: 'owner', name: 'Owner', email: 'owner@example.com' },
    visibility: 'private', routineEnabled: enabled,
    schedule: { text: '09:00-10:00 Server plan', anchor: Date.now() },
  };
}

const input = (e) => e.elements.get('#planInput');
const button = (e, name) => e.elements.get(`#${name}Button`);

test('unknown routine state disables every schedule action but keeps settings reachable', async () => {
  const e = editor();
  e.openEditor();
  assert.equal(input(e).disabled, true);
  assert.equal(button(e, 'clear').disabled, true);
  assert.equal(button(e, 'start').disabled, true);
  assert.equal(e.elements.get('#routineSettings').focused, true);
  e.requestStart('09:00-10:00 Test');
  await e.commit(schedule.parseSchedule('09:00-10:00 Test'), Date.now());
  await e.clearPlan();
  assert.equal(e.requests.length, 0);
});

test('enabled routine shows the server plan, preserves manual draft, and blocks submit/clear', async () => {
  const e = editor();
  e.applyProfile(profile(true));
  e.storage.set('today.draft.owner', '09:00-10:00 Manual draft');
  e.openEditor();
  assert.equal(input(e).value, '09:00-10:00 Server plan');
  assert.equal(input(e).disabled, true);
  assert.equal(e.elements.get('#editorRoutineHint').hidden, false);
  assert.equal(e.elements.get('#editorRoutineLabel').textContent, 'editorRoutineOn');
  e.requestStart(input(e).value);
  await e.clearPlan();
  await e.commit(schedule.parseSchedule(input(e).value), Date.now());
  assert.equal(e.requests.length, 0);
  assert.equal(e.storage.get('today.draft.owner'), '09:00-10:00 Manual draft');
});

test('off routine restores normal draft editing, save, and clear', async () => {
  const e = editor();
  e.applyProfile(profile(false));
  e.storage.set('today.draft.owner', '09:00-10:00 Manual draft');
  e.openEditor();
  assert.equal(input(e).value, '09:00-10:00 Manual draft');
  assert.equal(input(e).disabled, false);
  assert.equal(button(e, 'start').disabled, false);
  assert.equal(e.elements.get('#editorRoutineHint').hidden, true);
  await e.commit(schedule.parseSchedule(input(e).value), Date.now());
  assert.equal(e.requests[0].method, 'PUT');
  assert.equal(e.storage.has('today.draft.owner'), false);
  await e.clearPlan();
  assert.equal(e.requests[1].method, 'DELETE');
});

test('profile refresh updates the open editor and closes pending manual start when enabled', () => {
  const e = editor();
  e.applyProfile(profile(false));
  e.storage.set('today.draft.owner', '09:00-10:00 Manual draft');
  e.openEditor();
  e.elements.get('#shiftDialog').open = true;
  e.applyProfile(profile(true));
  assert.equal(input(e).disabled, true);
  assert.equal(input(e).value, '09:00-10:00 Server plan');
  assert.equal(e.elements.get('#shiftDialog').open, false);
  e.applyProfile(profile(false));
  assert.equal(input(e).disabled, false);
  assert.equal(input(e).value, '09:00-10:00 Manual draft');
  e.applyProfile(profile(undefined));
  assert.equal(input(e).disabled, true);
  assert.equal(e.elements.get('#editorRoutineLabel').textContent, 'editorRoutineUnknown');
});

test('a profile refresh cannot re-enable Start while a save is still pending', () => {
  const e = editor();
  e.state.savingPlan = true;
  e.applyProfile(profile(false));
  assert.equal(button(e, 'start').disabled, true);
  assert.equal(button(e, 'clear').disabled, true);
});
