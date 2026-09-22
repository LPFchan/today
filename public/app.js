import { lang, t, translatePage } from './i18n.js';
import { ScheduleError, absoluteItems, dayState, formatClock, parseSchedule, serializeSchedule } from './schedule.js';

const $ = (selector) => document.querySelector(selector);
const el = {
  tabMine: $('#tabMine'),
  tabEveryone: $('#tabEveryone'),
  viewMine: $('#viewMine'),
  viewEveryone: $('#viewEveryone'),
  focus: $('#focus'),
  dateLabel: $('#dateLabel'),
  kickerLine: $('#kickerLine'),
  visibilityPill: $('#visibilityPill'),
  taskName: $('#taskName'),
  timer: $('#timer'),
  nextLine: $('#nextLine'),
  progressTrack: $('#progressTrack'),
  progressFill: $('#progressFill'),
  progressText: $('#progressText'),
  focusEmpty: $('#focusEmpty'),
  writeButton: $('#writeButton'),
  agendaSection: $('#agendaSection'),
  agendaList: $('#agendaList'),
  editButton: $('#editButton'),
  board: $('#board'),
  editor: $('#editor'),
  editorForm: $('#editorForm'),
  closeEditor: $('#closeEditor'),
  planInput: $('#planInput'),
  planError: $('#planError'),
  startButton: $('#startButton'),
  clearButton: $('#clearButton'),
  visibilityHint: $('#visibilityHint'),
  alertToggle: $('#alertToggle'),
  shiftDialog: $('#shiftDialog'),
  shiftBody: $('#shiftBody'),
  keepTimes: $('#keepTimes'),
  shiftToNow: $('#shiftToNow'),
  watchButton: $('#watchButton'),
  watchDialog: $('#watchDialog'),
  closeWatch: $('#closeWatch'),
  fullscreenButton: $('#fullscreenButton'),
  account: $('#account'),
  avatar: $('#avatar'),
  accountName: $('#accountName'),
  accountEmail: $('#accountEmail'),
  toast: $('#toast'),
};

const MINUTE = 60_000;
const BOARD_REFRESH_MS = 60_000;

const state = {
  me: null, // { sub, name, email }
  visibility: 'private',
  schedule: null, // { text, anchor }
  items: [], // absolute items of my schedule
  board: null, // { people }
  view: location.pathname.startsWith('/everyone') ? 'everyone' : 'mine',
  completed: null,
  pendingStart: null,
  alert: localStorage.getItem('today.alert') !== 'false',
};

/* ---------- time helpers ---------- */

function localMidnight(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const clockFormat = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clock = (ms) => clockFormat.format(ms);
const dateFormat = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

function countdown(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? [pad(h), pad(m), pad(sec)] : [pad(m), pad(sec)];
}

function spokenDuration(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const parts = [];
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) parts.push(t('hours', { n: h }));
  if (m) parts.push(t('minutes', { n: m }));
  if (!parts.length) parts.push(t('seconds', { n: s % 60 }));
  return parts.join(' ');
}

function shortLeft(ms) {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  const h = Math.floor(minutes / 60);
  return h ? t('shortLeft', { h, m: minutes % 60 }) : t('shortLeftMin', { m: minutes });
}

/* ---------- server ---------- */

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error(t('offline'));
  }
  if (response.status === 401) throw new Error(t('signedOut'));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error ? scheduleMessage(data.error, data.line) : t('offline'));
    error.status = response.status;
    throw error;
  }
  return data;
}

function applyProfile(profile) {
  const switched = state.me && state.me.sub !== profile.me.sub;
  state.me = profile.me;
  state.visibility = profile.visibility;
  state.schedule = profile.schedule;
  state.items = profile.schedule ? absoluteItems(parseSchedule(profile.schedule.text), profile.schedule.anchor) : [];
  state.completed = null;
  if (switched) location.reload();
  renderAccount();
  renderVisibility();
  renderMine(true);
}

async function loadProfile() {
  applyProfile(await request('GET', '/api/me'));
}

async function loadBoard() {
  try {
    state.board = await request('GET', '/api/board');
    renderBoard();
  } catch (error) {
    if (!state.board) showToast(error.message);
  }
}

/* ---------- drafts: bound to the signed-in subject ---------- */

const draftKey = () => `today.draft.${state.me?.sub ?? ''}`;

function loadDraft() {
  return state.me ? localStorage.getItem(draftKey()) : null;
}

function saveDraft(text) {
  if (state.me) localStorage.setItem(draftKey(), text);
}

function clearDraft() {
  if (state.me) localStorage.removeItem(draftKey());
}

/* ---------- views ---------- */

function setView(view, push = false) {
  state.view = view;
  if (push) history.pushState(null, '', view === 'everyone' ? '/everyone' : '/');
  el.viewMine.hidden = view !== 'mine';
  el.viewEveryone.hidden = view !== 'everyone';
  for (const [tab, name] of [
    [el.tabMine, 'mine'],
    [el.tabEveryone, 'everyone'],
  ]) {
    if (name === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (view === 'everyone') loadBoard();
  render();
}

function renderAccount() {
  const name = state.me?.name ?? '';
  el.avatar.textContent = [...name.trim()][0]?.toUpperCase() ?? '?';
  el.accountName.textContent = name;
  el.accountEmail.textContent = state.me?.email ?? '';
}

function renderVisibility() {
  el.visibilityPill.dataset.visibility = state.visibility;
  el.visibilityPill.textContent = t(state.visibility);
  el.visibilityPill.title = t(state.visibility === 'public' ? 'publicHint' : 'privateHint');
  el.visibilityHint.textContent = t(state.visibility === 'public' ? 'publicHint' : 'privateHint');
  for (const radio of el.editorForm.elements.visibility) radio.checked = radio.value === state.visibility;
}

function setTimer(parts, label) {
  const visual = document.createElement('span');
  visual.setAttribute('aria-hidden', 'true');
  parts.forEach((part, index) => {
    if (index) visual.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: ':' }));
    visual.append(part);
  });
  el.timer.replaceChildren(visual);
  el.timer.setAttribute('aria-label', label);
}

function renderMine(forceList = false) {
  const now = Date.now();
  const items = state.items;
  const day = dayState(items, now);
  el.dateLabel.textContent = dateFormat.format(now);

  if (state.completed !== null && day.completed > state.completed) flash();
  const listChanged = forceList || state.completed !== day.completed || state.lastIndex !== day.index;
  state.completed = day.completed;
  state.lastIndex = day.index;

  const empty = day.kind === 'empty';
  el.focus.classList.toggle('is-empty', empty);
  el.focusEmpty.hidden = !empty;
  el.agendaSection.hidden = empty;

  if (empty) {
    el.taskName.textContent = t('emptyTitle');
    document.title = t('title');
    return;
  }

  const first = items[0].start;
  const last = items.at(-1).end;
  const percent = Math.round(Math.max(0, Math.min(1, (now - first) / (last - first))) * 100);
  el.progressFill.style.width = `${percent}%`;
  el.progressTrack.setAttribute('aria-valuenow', String(percent));
  el.progressTrack.setAttribute('aria-label', t('progressLabel'));
  el.progressText.textContent = `${percent}%`;

  const item = items[day.index];
  const following = day.kind === 'active' ? items[day.index + 1] : null;
  el.kickerLine.classList.toggle('is-now', day.kind === 'active');
  if (day.kind === 'active') {
    const seconds = Math.ceil((item.end - now) / 1000);
    el.kickerLine.textContent = t('kickerNow');
    el.taskName.textContent = item.name;
    setTimer(countdown(seconds), t('timeLeft', { duration: spokenDuration(seconds) }));
    el.nextLine.textContent = following ? t('nextAt', { time: clock(following.start), name: following.name }) : '';
    document.title = `${countdown(seconds).join(':')} · ${item.name}`;
  } else if (day.kind === 'waiting' || day.kind === 'break') {
    const seconds = Math.ceil((item.start - now) / 1000);
    el.kickerLine.textContent = t(day.kind === 'break' ? 'kickerBreak' : 'kickerWaiting', { time: clock(item.start) });
    el.taskName.textContent = item.name;
    setTimer(countdown(seconds), t('timeUntil', { duration: spokenDuration(seconds) }));
    el.nextLine.textContent = '';
    document.title = `${countdown(seconds).join(':')} → ${item.name}`;
  } else {
    el.kickerLine.textContent = '';
    el.taskName.textContent = t('finishedTitle');
    setTimer([t('finishedTimer')], t('finishedTimer'));
    el.nextLine.textContent = '';
    document.title = t('title');
  }

  if (listChanged) renderAgenda(day);
}

function renderAgenda(day) {
  const rows = state.items.map((item, index) => {
    const li = document.createElement('li');
    const isNow = index === day.index && day.kind === 'active';
    const isDone = index < day.completed;
    li.classList.toggle('is-now', isNow);
    li.classList.toggle('is-done', isDone);
    const status = isNow ? t('active') : isDone ? t('done') : index === day.index ? t('upNext') : '';
    li.append(
      Object.assign(document.createElement('span'), {
        className: 'agenda-time',
        textContent: `${clock(item.start)}–${clock(item.end)}`,
      }),
      Object.assign(document.createElement('span'), { className: 'agenda-name', textContent: item.name }),
      Object.assign(document.createElement('span'), { className: 'agenda-state', textContent: status }),
    );
    if (isNow) li.setAttribute('aria-current', 'step');
    return li;
  });
  el.agendaList.replaceChildren(...rows);
}

/* ---------- everyone ---------- */

const expanded = new Set();

function personStatus(items, now) {
  const day = dayState(items, now);
  const item = items[day.index];
  switch (day.kind) {
    case 'active':
      return { active: true, text: t('personActive', { name: item.name, left: shortLeft(item.end - now) }) };
    case 'break':
      return { text: t('personBreak', { time: clock(item.start), name: item.name }) };
    case 'waiting':
      return { text: t('personWaiting', { time: clock(item.start), name: item.name }) };
    case 'finished':
      return { text: t('dayDone') };
    default:
      return { text: t('noPlan') };
  }
}

/** The visible window: every shown item plus now, whole hours, at least 8 hours wide. */
function boardWindow(people, now) {
  const times = people.flatMap((p) => p.items.flatMap((i) => [i.start, i.end]));
  const hour = 60 * MINUTE;
  let from = Math.floor(Math.min(now, ...times) / hour) * hour;
  let to = Math.ceil(Math.max(now + hour, ...times) / hour) * hour;
  if (to - from < 8 * hour) {
    const pad = 8 * hour - (to - from);
    from -= Math.floor(pad / 2 / hour) * hour;
    to = from + 8 * hour;
  }
  return { from, to, span: to - from, hours: (to - from) / hour };
}

function renderBoard() {
  if (!state.board) return;
  const now = Date.now();
  const people = state.board.people;
  const { from, span, hours } = boardWindow(people, now);
  const pct = (ms) => `${(((ms - from) / span) * 100).toFixed(3)}%`;

  const axis = document.createElement('div');
  axis.className = 'board-axis';
  axis.setAttribute('aria-hidden', 'true');
  const ticks = document.createElement('div');
  ticks.className = 'axis-ticks';
  const step = hours > 14 ? 3 : hours > 9 ? 2 : 1;
  for (let h = 0; h < hours; h += step) {
    const at = from + h * 60 * MINUTE;
    ticks.append(Object.assign(document.createElement('span'), { textContent: clock(at).slice(0, 2), style: `left:${pct(at)}` }));
  }
  axis.append(document.createElement('span'), ticks);

  const list = document.createElement('ul');
  list.className = 'people';
  list.style.setProperty('--hour', `calc(100% / ${hours})`);

  people.forEach((person, index) => {
    const key = person.me ? 'me' : `${person.name}#${index}`;
    const status = personStatus(person.items, now);
    const li = document.createElement('li');
    li.className = 'person';

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'person-summary';
    summary.setAttribute('aria-expanded', String(expanded.has(key)));
    summary.setAttribute('aria-label', `${t('showSchedule', { name: person.name })}. ${status.text}`);
    summary.disabled = !person.items.length;

    const meta = document.createElement('span');
    meta.className = 'person-meta';
    const name = document.createElement('span');
    name.className = 'person-name';
    name.append(Object.assign(document.createElement('span'), { className: 'name', textContent: person.name }));
    if (person.me) name.append(Object.assign(document.createElement('span'), { className: 'you', textContent: t('you') }));
    meta.append(
      name,
      Object.assign(document.createElement('span'), {
        className: `person-status${status.active ? ' is-active' : ''}`,
        textContent: status.text,
      }),
    );

    const lane = document.createElement('span');
    lane.className = 'lane';
    lane.setAttribute('aria-hidden', 'true');
    for (const item of person.items) {
      const block = document.createElement('span');
      block.className = 'block';
      if (now >= item.end) block.classList.add('is-past');
      else if (now >= item.start) block.classList.add('is-now');
      block.style.left = pct(item.start);
      block.style.width = `calc(${pct(item.end)} - ${pct(item.start)})`;
      block.textContent = item.name;
      block.title = `${clock(item.start)}–${clock(item.end)} ${item.name}`;
      lane.append(block);
    }
    lane.append(Object.assign(document.createElement('span'), { className: 'now-mark', style: `left:${pct(now)}` }));

    summary.append(meta, lane);
    summary.addEventListener('click', () => {
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      renderBoard();
    });
    li.append(summary);

    if (expanded.has(key) && person.items.length) {
      const detail = document.createElement('ol');
      detail.className = 'person-detail';
      for (const item of person.items) {
        const row = document.createElement('li');
        if (now >= item.start && now < item.end) row.className = 'is-now';
        row.append(
          Object.assign(document.createElement('span'), {
            className: 'agenda-time',
            textContent: `${clock(item.start)}–${clock(item.end)}`,
          }),
          Object.assign(document.createElement('span'), { textContent: item.name }),
        );
        detail.append(row);
      }
      li.append(detail);
    }
    list.append(li);
  });

  const nodes = [axis, list];
  if (!people.some((p) => !p.me)) {
    nodes.push(Object.assign(document.createElement('p'), { className: 'board-empty', textContent: t('everyoneEmpty') }));
  }
  // Re-rendering replaces the rows; keep keyboard focus on the same person.
  const focusedRow = document.activeElement?.closest?.('.person');
  const focusIndex = focusedRow ? [...el.board.querySelectorAll('.person')].indexOf(focusedRow) : -1;
  el.board.replaceChildren(...nodes);
  if (focusIndex >= 0) el.board.querySelectorAll('.person-summary')[focusIndex]?.focus();
}

/* ---------- editor ---------- */

/** A translated string as nodes, with {placeholders} replaced by elements. */
function fill(key, nodes) {
  return t(key, Object.fromEntries(Object.keys(nodes).map((name) => [name, `{${name}}`])))
    .split(/\{(\w+)\}/)
    .map((part, index) => (index % 2 ? nodes[part] : part));
}

function scheduleMessage(code, line) {
  const message = t(`err_${code}`);
  if (message === `err_${code}`) return t('offline');
  return line ? t('errLine', { line }) + message : message;
}

function showError(message) {
  el.planError.textContent = message;
  el.planError.hidden = false;
  el.planInput.setAttribute('aria-invalid', 'true');
  if (!el.editor.open) openEditor();
  el.planInput.focus();
}

function clearError() {
  el.planError.hidden = true;
  el.planInput.removeAttribute('aria-invalid');
}

function openEditor() {
  if (el.editor.open) return;
  el.planInput.value = loadDraft() ?? state.schedule?.text ?? '';
  el.alertToggle.checked = state.alert;
  renderVisibility();
  el.editor.showModal();
  requestAnimationFrame(() => el.planInput.focus());
}

/** The anchor to count a new plan from: keep a plan that is still running, else today. */
function anchorForEdit(now) {
  if (state.schedule && state.items.length && now < state.items.at(-1).end) return state.schedule.anchor;
  return localMidnight(new Date(now));
}

function requestStart(text) {
  let parsed;
  try {
    parsed = parseSchedule(text);
    if (!parsed.length) throw new ScheduleError('empty');
  } catch (error) {
    if (error instanceof ScheduleError) return showError(scheduleMessage(error.code, error.line));
    throw error;
  }

  const now = Date.now();
  const anchor = anchorForEdit(now);
  const running = state.schedule && anchor === state.schedule.anchor && state.items.length && now < state.items.at(-1).end;
  const currentMinute = Math.floor((now - anchor) / MINUTE);
  // Starting a fresh day late: offer to slide everything to now.
  if (!running && parsed[0].start < currentMinute) {
    const offset = currentMinute - parsed[0].start;
    const lastEnd = parsed.at(-1).end + offset;
    state.pendingStart = { parsed, anchor, offset };
    const strong = (text) => Object.assign(document.createElement('strong'), { textContent: text });
    el.shiftBody.replaceChildren(
      ...fill('shiftBody', {
        from: strong(formatClock(parsed[0].start)),
        to: strong(formatClock(currentMinute)),
        end: strong(`${formatClock(lastEnd)}${lastEnd >= 24 * 60 ? ` ${t('nextDay')}` : ''}`),
      }),
    );
    el.editor.close();
    el.shiftDialog.showModal();
    return;
  }
  commit(parsed, anchor);
}

async function commit(parsed, anchor) {
  const text = serializeSchedule(parsed);
  el.startButton.disabled = true;
  try {
    applyProfile(await request('PUT', '/api/schedule', { text, anchor }));
    clearDraft();
    clearError();
    if (el.editor.open) el.editor.close();
    showToast(t('saved'));
    if (state.view === 'everyone') loadBoard();
  } catch (error) {
    showError(error.message);
  } finally {
    el.startButton.disabled = false;
  }
}

async function clearPlan() {
  try {
    applyProfile(await request('DELETE', '/api/schedule'));
    clearDraft();
    el.planInput.value = '';
    el.editor.close();
    showToast(t('cleared'));
  } catch (error) {
    showToast(error.message);
  }
}

async function setVisibility(visibility) {
  if (visibility === state.visibility) return;
  try {
    applyProfile(await request('PUT', '/api/visibility', { visibility }));
    showToast(t(visibility === 'public' ? 'nowPublic' : 'nowPrivate'));
    if (state.view === 'everyone') loadBoard();
  } catch (error) {
    showToast(error.message);
    renderVisibility();
  }
}

/* ---------- alert: flash and chime ---------- */

let audio = null;

function unlockAudio() {
  if (!state.alert) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch {
    // The flash still works without sound.
  }
}

function chime() {
  if (!audio || audio.state !== 'running') return;
  const startAt = audio.currentTime + 0.02;
  [
    [0, 880],
    [0.2, 1174],
  ].forEach(([delay, frequency]) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const at = startAt + delay;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.11, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.36);
  });
}

let flashTimeout;
function flash() {
  if (!state.alert) return;
  document.body.classList.remove('is-flashing');
  void document.body.offsetWidth;
  document.body.classList.add('is-flashing');
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => document.body.classList.remove('is-flashing'), 1300);
  chime();
}

/* ---------- misc ---------- */

let toastTimeout;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.toast.classList.remove('is-visible'), 2400);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      if (state.view !== 'mine') setView('mine', true);
      await document.documentElement.requestFullscreen();
    }
  } catch {
    showToast(t('fullscreenFailed'));
  }
}

function render() {
  if (state.view === 'mine') renderMine();
  else renderBoard();
}

/* ---------- wiring ---------- */

for (const [tab, view] of [
  [el.tabMine, 'mine'],
  [el.tabEveryone, 'everyone'],
]) {
  tab.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (state.view !== view) setView(view, true);
  });
}
addEventListener('popstate', () => setView(location.pathname.startsWith('/everyone') ? 'everyone' : 'mine'));

el.writeButton.addEventListener('click', openEditor);
el.editButton.addEventListener('click', openEditor);
el.visibilityPill.addEventListener('click', openEditor);
el.closeEditor.addEventListener('click', () => el.editor.close());
el.editor.addEventListener('click', (event) => {
  if (event.target === el.editor) el.editor.close();
});
el.editorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  requestStart(el.planInput.value);
});
el.planInput.addEventListener('input', () => {
  clearError();
  saveDraft(el.planInput.value);
});
el.planInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    requestStart(el.planInput.value);
  }
});
el.clearButton.addEventListener('click', clearPlan);
el.editorForm.addEventListener('change', (event) => {
  if (event.target.name === 'visibility') setVisibility(event.target.value);
  if (event.target === el.alertToggle) {
    state.alert = el.alertToggle.checked;
    localStorage.setItem('today.alert', String(state.alert));
    if (state.alert) unlockAudio();
  }
});

el.keepTimes.addEventListener('click', () => {
  const pending = state.pendingStart;
  el.shiftDialog.close();
  if (pending) commit(pending.parsed, pending.anchor);
});
el.shiftToNow.addEventListener('click', () => {
  const pending = state.pendingStart;
  el.shiftDialog.close();
  if (pending) {
    const shifted = pending.parsed.map((item) => ({ ...item, start: item.start + pending.offset, end: item.end + pending.offset }));
    commit(shifted, pending.anchor);
  }
});
el.shiftDialog.addEventListener('close', () => (state.pendingStart = null));

el.watchButton.addEventListener('click', () => el.watchDialog.showModal());
el.closeWatch.addEventListener('click', () => el.watchDialog.close());
el.watchDialog.addEventListener('click', (event) => {
  if (event.target === el.watchDialog) el.watchDialog.close();
});
el.fullscreenButton.addEventListener('click', toggleFullscreen);

document.addEventListener('click', (event) => {
  if (el.account.open && !el.account.contains(event.target)) el.account.open = false;
});
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', (event) => {
  unlockAudio();
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector('dialog[open]') || event.target.closest('input, textarea, select, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  if (key === 'e') {
    event.preventDefault();
    openEditor();
  } else if (key === 'f') {
    event.preventDefault();
    toggleFullscreen();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  loadProfile().catch(() => {});
  if (state.view === 'everyone') loadBoard();
});

setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  // The board changes by the minute; the timer by the second.
  if (state.view === 'mine') renderMine();
  else if (new Date().getSeconds() % 15 === 0) renderBoard();
}, 1000);
setInterval(() => {
  if (document.visibilityState === 'visible' && state.view === 'everyone') loadBoard();
}, BOARD_REFRESH_MS);

translatePage();
setView(state.view);
loadProfile().catch((error) => showToast(error.message));
