import { t, translatePage } from './i18n.js';

translatePage();
document.title = `${t('routineTitle')} · today`;

const $ = (id) => document.getElementById(id);
const enabled = $('routineEnabled');
const editor = $('routineText');
const save = $('routineSave');
const message = $('routineMessage');
const errorLine = $('routineError');
const retry = $('routineRetry');
let routine = null;
let busy = false;
let signedOut = false;

function dirty() {
  return routine !== null && editor.value !== routine.text;
}

function updateControls() {
  enabled.checked = routine?.enabled ?? false;
  enabled.disabled = busy || !routine || signedOut || routine.enabled;
  $('routineDisableHint').hidden = !routine?.enabled;
  editor.disabled = !routine || signedOut;
  save.disabled = busy || !routine || signedOut || !dirty();
  retry.disabled = busy;
  $('routineDraft').hidden = !dirty();
  $('routineMain').setAttribute('aria-busy', String(busy));
  updateCountdowns();
}

// Use the browser's local clock, but always render 24-hour ASCII HH:MM.
function clock(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function actionButton(action, item, canAct, doneAfter = 0) {
  const button = node('button', 'btn', t(action === 'start' ? 'start' : 'done'));
  button.type = 'button';
  button.dataset.allowed = String(canAct);
  button.dataset.action = action;
  button.dataset.doneAfter = String(doneAfter);
  button.setAttribute('aria-label', t(action === 'start' ? 'routineStartItem' : 'routineDoneItem', { name: item.name }));
  // Bind the day from this response, not whatever day a later refresh returns.
  const day = routine.today.day;
  button.addEventListener('click', () => mutate('POST', `/api/routine/${action}`, { day, key: item.key }));
  return button;
}

function keepoutActions(container, state) {
  if (state.canStart) container.append(actionButton('start', state, true));
  // Keep the Done control visible while its minimum duration is counting down.
  if (state.canDone || state.doneAfter > Date.now()) {
    container.append(actionButton('done', state, state.canDone, state.doneAfter));
  }
}

function render() {
  const today = routine.today;
  const keepout = today?.keepout;
  $('routineToday').hidden = false;
  $('routinePending').hidden = !routine.pendingFrom;
  $('routinePending').textContent = routine.pendingFrom ? t('routinePending', { date: routine.pendingFrom }) : '';

  $('routineDay').textContent = today ? t('routineDayZone', { day: today.day, tz: routine.tz }) : '';
  $('routineItemsEmpty').hidden = Boolean(today?.items.length);
  $('routineItemsEmpty').textContent = t(routine.enabled ? 'routineNoItems' : 'routineOff');
  const list = $('routineItems');
  list.replaceChildren();
  for (const item of today?.items ?? []) {
    const isKeepoutNow = keepout?.key === item.key;
    const row = node('li', `routine-item is-${item.phase}${isKeepoutNow ? ' is-keepout-now' : ''}`);
    const times = node('div', 'routine-item-time');
    times.append(node('span', '', `${clock(item.start)}–${clock(item.end)}`));
    if (new Date(item.start).toDateString() !== new Date(item.end).toDateString()) {
      times.append(node('span', 'routine-muted', t('nextDay')));
    }
    if (item.kind === 'window') times.append(node('span', 'routine-muted', t('routineWindow')));
    const details = node('div', 'routine-item-details');
    details.append(node('span', 'routine-item-name', item.name));
    if (isKeepoutNow) {
      const unlocks = keepout.needs.length
        ? t('routineUnlocks', { needs: keepout.needs.map((need) => t(`routineNeed_${need}`)).join(', ') })
        : keepout.until !== null
          ? t('routineUnlockAt', { time: clock(keepout.until) })
          : t('routineWaitingUnlock');
      details.append(node('p', 'routine-item-unlocks routine-muted', unlocks));
    }
    const status = node('div', 'routine-item-status');
    status.append(node('span', '', t(isKeepoutNow ? 'routineKeepoutActive' : `routinePhase_${item.phase}`)));
    if (item.keepout && !isKeepoutNow) status.append(node('span', 'routine-tag', t('routineKeepout')));
    details.append(status);
    const buttons = node('div', 'routine-actions');
    if (isKeepoutNow) {
      keepoutActions(buttons, keepout);
    } else if (item.phase === 'open' && item.doneAt === null && item.kind === 'window' && item.startedAt === null) {
      buttons.append(actionButton('start', item, true));
    }
    row.append(times, details, buttons);
    list.append(row);
  }
  updateControls();
}

function updateCountdowns() {
  let reachedMinimum = false;
  document.querySelectorAll('.routine-actions button[data-action]').forEach((button) => {
    const seconds = Math.max(0, Math.ceil((Number(button.dataset.doneAfter) - Date.now()) / 1000));
    if (button.dataset.waiting === 'true' && seconds === 0) reachedMinimum = true;
    button.dataset.waiting = String(seconds > 0);
    button.disabled = busy || signedOut || button.dataset.allowed !== 'true' || seconds > 0;
    button.textContent = seconds > 0
      ? t('routineDoneIn', { left: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` })
      : t(button.dataset.action === 'start' ? 'start' : 'done');
  });
  // Permissions come from the server; reaching zero is not itself permission.
  if (reachedMinimum && !busy && !document.hidden) refresh();
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(t('offline'));
  }
  if (response.status === 401) {
    signedOut = true;
    throw new Error(t('signedOut'));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const key = `routineErr_${data.error}`;
    const translated = t(key);
    const error = new Error(translated === key ? t('offline') : translated);
    error.status = response.status;
    error.line = data.line;
    throw error;
  }
  return data;
}

function accept(data, savedText) {
  const preserveDraft = savedText === undefined ? dirty() : editor.value !== savedText;
  routine = data;
  signedOut = false;
  if (!preserveDraft) editor.value = routine.text;
  render();
}

function reportError(error, inEditor = false) {
  const text = (error.line ? t('errLine', { line: error.line }) : '') + error.message;
  if (inEditor) {
    errorLine.textContent = text;
    errorLine.hidden = false;
    editor.setAttribute('aria-invalid', String(error.status === 422));
    if (Number.isInteger(error.line) && error.line > 0) {
      const lines = editor.value.split('\n');
      const start = lines.slice(0, error.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
      editor.focus();
      editor.setSelectionRange(start, start + (lines[error.line - 1]?.length ?? 0));
    }
  } else {
    message.textContent = text;
    message.classList.add('is-error');
  }
  retry.hidden = signedOut;
}

async function refresh() {
  if (busy || signedOut) return;
  busy = true;
  updateControls();
  try {
    accept(await request('GET', '/api/routine'));
    retry.hidden = true;
    if (message.dataset.failure === 'true' || message.dataset.t === 'routineLoading') {
      message.textContent = '';
      message.classList.remove('is-error');
      delete message.dataset.t;
      delete message.dataset.failure;
    }
  } catch (error) {
    reportError(error);
    message.dataset.failure = 'true';
  } finally {
    busy = false;
    updateControls();
  }
}

async function mutate(method, path, body, inEditor = false) {
  if (busy || signedOut) return;
  busy = true;
  errorLine.hidden = true;
  editor.removeAttribute('aria-invalid');
  message.textContent = '';
  message.classList.remove('is-error');
  updateControls();
  try {
    accept(await request(method, path, body), body.text);
    message.textContent = body.text !== undefined
      ? routine.pendingFrom ? t('routinePending', { date: routine.pendingFrom }) : t('routineSaved')
      : t(method === 'PUT' ? 'routineTurnedOn' : 'routineUpdated');
    retry.hidden = true;
  } catch (error) {
    reportError(error, inEditor);
    // A rejected action may mean time moved on or another client changed state.
    if (error.status === 409) {
      try { accept(await request('GET', '/api/routine')); } catch (refreshError) { reportError(refreshError); }
    }
  } finally {
    busy = false;
    updateControls();
  }
}

enabled.addEventListener('change', () => {
  if (!routine?.enabled && enabled.checked) mutate('PUT', '/api/routine', { enabled: true });
  else updateControls();
});
$('routineForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (dirty()) mutate('PUT', '/api/routine', { text: editor.value }, true);
});
editor.addEventListener('input', () => {
  errorLine.hidden = true;
  editor.removeAttribute('aria-invalid');
  updateControls();
});
retry.addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
setInterval(() => { if (!document.hidden) updateCountdowns(); }, 1000);
refresh();
