import { lang, t, translatePage } from './i18n.js';

translatePage();
document.title = `${t('routineTitle')} · today`;

const $ = (id) => document.getElementById(id);
const enabled = $('routineEnabled');
const editor = $('routineText');
const save = $('routineSave');
const message = $('routineMessage');
const errorLine = $('routineError');
const retry = $('routineRetry');
const toggleGroup = $('routineToggleGroup');
const disableHint = $('routineDisableHint');
let hintPinned = false;
let hintHovered = false;
let hintDismissed = false;
let lastPointerType = 'mouse';
let routine = null;
let busy = false;
let signedOut = false;

function dirty() {
  return routine !== null && editor.value !== routine.text;
}

function updateControls() {
  enabled.checked = routine?.enabled ?? false;
  enabled.disabled = busy || !routine || signedOut || routine.enabled;
  const showHintTrigger = Boolean(routine?.enabled);
  toggleGroup.tabIndex = showHintTrigger ? 0 : -1;
  if (showHintTrigger) {
    toggleGroup.setAttribute('role', 'button');
    toggleGroup.setAttribute('aria-label', t('routineEnabled'));
    toggleGroup.setAttribute('aria-describedby', 'routineDisableHint');
  } else {
    toggleGroup.removeAttribute('role');
    toggleGroup.removeAttribute('aria-label');
    toggleGroup.removeAttribute('aria-describedby');
    hintPinned = false;
  }
  updateHint();
  editor.disabled = !routine || signedOut;
  save.disabled = busy || !routine || signedOut || !dirty();
  retry.disabled = busy;
  $('routineDraft').hidden = !dirty();
  $('routineMain').setAttribute('aria-busy', String(busy));
  updateCountdowns();
}

function updateHint() {
  const hover = hintHovered;
  const focus = toggleGroup.contains(document.activeElement);
  const visible = Boolean(routine?.enabled) && !hintDismissed && (hintPinned || hover || focus);
  disableHint.hidden = !visible;
  if (routine?.enabled) toggleGroup.setAttribute('aria-expanded', String(visible));
  else toggleGroup.removeAttribute('aria-expanded');
}

function pendingDate(day) {
  const [year, month, date] = day.split('-').map(Number);
  // A date-only API value is a calendar date, not a UTC midnight timestamp.
  const start = new Date(year, month - 1, date);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = start.getFullYear() === tomorrow.getFullYear()
    && start.getMonth() === tomorrow.getMonth() && start.getDate() === tomorrow.getDate();
  const formatted = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(start);
  return isTomorrow ? t('routineTomorrow', { date: formatted }) : formatted;
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

function unlockSentence(needs) {
  const phrases = needs.map((need, index) => t(`routineUnlockNeed_${need}_${index === needs.length - 1 ? 'last' : 'then'}`));
  const instructions = lang === 'ko' || phrases.length < 2
    ? phrases.join(' ')
    : `${phrases.slice(0, -1).join(', ')} and ${phrases.at(-1)}`;
  return t('routineUnlockSentence', { instructions });
}

function actionButton(action, item, canAct, doneAfter = 0) {
  const isCurrentKeepout = routine.today.keepout?.key === item.key;
  const button = node('button', isCurrentKeepout ? 'btn primary' : 'btn', t(action === 'start' ? 'start' : 'done'));
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
  $('routinePending').textContent = routine.pendingFrom ? t('routinePending', { date: pendingDate(routine.pendingFrom) }) : '';

  $('routineItemsEmpty').hidden = Boolean(today?.items.length);
  $('routineItemsEmpty').textContent = t(routine.enabled ? 'routineNoItems' : 'routineOff');
  const list = $('routineItems');
  list.replaceChildren();
  for (const item of today?.items ?? []) {
    const isKeepoutNow = keepout?.key === item.key;
    const row = node('li', `routine-item is-${item.phase}${isKeepoutNow ? ' is-keepout-now' : ''}`);
    const times = node('div', 'routine-item-time');
    times.append(node('span', '', `${clock(item.start)}–${clock(item.end)}`));
    const details = node('div', 'routine-item-details');
    details.append(node('span', 'routine-item-name', item.name));
    if (isKeepoutNow) {
      const unlocks = keepout.needs.length
        ? unlockSentence(keepout.needs)
        : keepout.until !== null
          ? t('routineUnlockAt', { time: clock(keepout.until) })
          : t('routineWaitingUnlock');
      const status = node('p', 'routine-item-unlocks');
      status.append(
        node('span', 'routine-keepout-label', t('routineKeepoutActive')),
        document.createTextNode(' · '),
        node('span', 'routine-muted', unlocks),
      );
      details.append(status);
    } else {
      const status = node('div', 'routine-item-status');
      if (item.phase !== 'past' && item.phase !== 'upcoming' && item.phase !== 'open') {
        status.append(node('span', '', t(`routinePhase_${item.phase}`)));
      }
      if (item.keepout) {
        const beforeLock = item.phase === 'upcoming' || item.phase === 'open';
        status.append(node('span', 'routine-tag', t('routineKeepout')));
        if (beforeLock) {
          status.append(
            node('span', '', '·'),
            node('span', '', t('routineLockFrom', { time: clock(item.kind === 'window' ? item.end : item.start) })),
          );
        }
      }
      if (status.childElementCount) details.append(status);
    }
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
  // Commit the first checked state before allowing switch transitions.
  if (!document.body.classList.contains('routine-ready')) {
    void enabled.offsetWidth;
    document.body.classList.add('routine-ready');
  }
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
      ? routine.pendingFrom ? t('routinePending', { date: pendingDate(routine.pendingFrom) }) : t('routineSaved')
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

toggleGroup.addEventListener('pointerenter', (event) => {
  if (event.pointerType === 'mouse') {
    hintHovered = true;
    hintDismissed = false;
    updateHint();
  }
});
toggleGroup.addEventListener('pointerleave', () => {
  hintHovered = false;
  if (!hintPinned) hintDismissed = false;
  updateHint();
});
toggleGroup.addEventListener('pointerdown', (event) => { lastPointerType = event.pointerType; });
toggleGroup.addEventListener('focusin', () => {
  hintDismissed = false;
  updateHint();
});
toggleGroup.addEventListener('focusout', () => {
  hintPinned = false;
  updateHint();
});
toggleGroup.addEventListener('click', (event) => {
  if (!routine?.enabled) return;
  event.preventDefault();
  if (lastPointerType === 'touch' || event.detail === 0) {
    hintPinned = !hintPinned;
    hintDismissed = !hintPinned;
    updateHint();
  }
});
toggleGroup.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hintPinned = false;
    hintDismissed = true;
    updateHint();
  } else if (event.target === toggleGroup && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    hintPinned = !hintPinned;
    hintDismissed = !hintPinned;
    updateHint();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!toggleGroup.contains(event.target)) {
    hintPinned = false;
    hintDismissed = true;
    updateHint();
  }
});

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
