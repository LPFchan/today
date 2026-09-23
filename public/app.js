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
  previewGuide: $('#previewGuide'),
  previewList: $('#previewList'),
  previewTotal: $('#previewTotal'),
  alertButton: $('#alertButton'),
  shiftDialog: $('#shiftDialog'),
  shiftBody: $('#shiftBody'),
  keepTimes: $('#keepTimes'),
  shiftToNow: $('#shiftToNow'),
  appsButton: $('#appsButton'),
  appsDialog: $('#appsDialog'),
  closeApps: $('#closeApps'),
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
  el.visibilityHint.textContent = t(`visibilityShort_${state.visibility}`);
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
const HOUR = 60 * MINUTE;
const SECONDS_BELOW = 5 * MINUTE;

/** Time left: whole minutes, or minutes and seconds in the last five. */
function remaining(ms) {
  if (ms < SECONDS_BELOW) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) ? t('shortLeftSec', { m: Math.floor(s / 60), s: s % 60 }) : t('shortSec', { s });
  }
  return shortLeft(ms);
}

/** What someone is doing now, and what comes next. */
function personNow(items, now) {
  const day = dayState(items, now);
  const item = items[day.index];
  switch (day.kind) {
    case 'active': {
      const next = items[day.index + 1];
      return {
        active: true,
        title: item.name,
        left: remaining(item.end - now),
        urgent: item.end - now < SECONDS_BELOW,
        next: next ? t('nextAt', { time: clock(next.start), name: next.name }) : '',
      };
    }
    case 'waiting':
    case 'break':
      return {
        title: t(day.kind === 'break' ? 'onBreak' : 'notStarted'),
        left: t('startsIn', { left: remaining(item.start - now) }),
        urgent: item.start - now < SECONDS_BELOW,
        next: t('nextAt', { time: clock(item.start), name: item.name }),
      };
    case 'finished':
      return { title: t('dayDone') };
    default:
      return { title: t('noPlan') };
  }
}

/** The lane shows a window around now: an hour behind, the rest ahead. */
function laneWindow(now) {
  const hours = matchMedia('(max-width: 720px)').matches ? 6 : 12;
  const from = Math.floor((now - HOUR) / HOUR) * HOUR;
  return { from, to: from + hours * HOUR, hours };
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderLane(items, now, range) {
  const pct = (ms) => `${(((ms - range.from) / (range.to - range.from)) * 100).toFixed(3)}%`;
  const lane = node('div', 'lane');
  lane.setAttribute('aria-hidden', 'true');
  lane.style.setProperty('--hours', range.hours);
  for (const item of items) {
    if (item.end <= range.from || item.start >= range.to) continue;
    const start = Math.max(item.start, range.from);
    const end = Math.min(item.end, range.to);
    const block = node('span', 'block', item.name);
    if (now >= item.end) block.classList.add('is-past');
    else if (now >= item.start) block.classList.add('is-now');
    block.style.left = pct(start);
    block.style.width = `calc(${pct(end)} - ${pct(start)})`;
    block.title = `${clock(item.start)}–${clock(item.end)} ${item.name}`;
    lane.append(block);
  }
  lane.append(Object.assign(node('span', 'now-mark'), { style: `left:${pct(now)}` }));

  const ticks = node('div', 'lane-ticks');
  ticks.setAttribute('aria-hidden', 'true');
  const step = range.hours > 8 ? 2 : 1;
  for (let h = step; h < range.hours; h += step) {
    const at = range.from + h * HOUR;
    ticks.append(Object.assign(node('span', '', clock(at).slice(0, 2)), { style: `left:${pct(at)}` }));
  }
  return [lane, ticks];
}

function renderBoard() {
  if (!state.board) return;
  const now = Date.now();
  const range = laneWindow(now);
  // You first, then whoever has something going on, then everyone else.
  const busy = (person) => ['active', 'waiting', 'break'].includes(dayState(person.items, now).kind);
  const people = [...state.board.people].sort((a, b) => Number(b.me) - Number(a.me) || Number(busy(b)) - Number(busy(a)));

  const list = node('ul', 'people');
  people.forEach((person, index) => {
    const key = person.me ? 'me' : `${person.name}#${index}`;
    const status = personNow(person.items, now);
    const hasPlan = status.left !== undefined;
    const open = expanded.has(key) && person.items.length > 0;

    const li = node('li', `person${hasPlan ? '' : ' is-idle'}`);
    const summary = node('button', 'person-summary');
    summary.type = 'button';
    summary.disabled = !person.items.length;
    summary.setAttribute('aria-expanded', String(open));
    summary.setAttribute('aria-label', [t('showSchedule', { name: person.name }), status.title, status.left, status.next].filter(Boolean).join('. '));

    const who = node('span', 'person-name');
    who.append(node('span', 'name', person.name));
    if (person.me) who.append(node('span', 'you', t('you')));

    const current = node('span', 'person-now');
    current.append(node('span', `person-title${status.active ? ' is-active' : ''}`, status.title));
    if (status.left) current.append(node('span', `person-left${status.urgent ? ' is-urgent' : ''}`, status.left));

    summary.append(who, current);
    if (status.next) summary.append(node('span', 'person-next', status.next));
    if (person.items.some((item) => item.end > range.from && item.start < range.to)) {
      summary.append(...renderLane(person.items, now, range));
    }
    summary.addEventListener('click', () => {
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      renderBoard();
    });
    li.append(summary);

    if (open) {
      const detail = node('ol', 'person-detail');
      for (const item of person.items) {
        const row = node('li', now >= item.end ? 'is-past' : now >= item.start ? 'is-now' : '');
        row.append(node('span', 'agenda-time', `${clock(item.start)}–${clock(item.end)}`), node('span', '', item.name));
        detail.append(row);
      }
      li.append(detail);
    }
    list.append(li);
  });

  const nodes = [list];
  if (!people.some((p) => !p.me)) nodes.push(node('p', 'board-empty', t('everyoneEmpty')));
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
  if (!el.editor.open) openEditor();
  el.previewGuide.hidden = true;
  el.previewList.hidden = true;
  el.previewTotal.hidden = true;
  el.planError.textContent = message;
  el.planError.hidden = false;
  el.planInput.setAttribute('aria-invalid', 'true');
  el.planInput.focus();
}

function clearError() {
  el.planError.hidden = true;
  el.planInput.removeAttribute('aria-invalid');
}

function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return t('durationMinutes', { m });
  return m ? t('duration', { h, m }) : t('durationHours', { h });
}

/** Show what the text in the editor turns into, or the format guide when it is blank. */
function renderPreview() {
  const text = el.planInput.value;
  clearError();
  el.previewList.hidden = true;
  el.previewTotal.hidden = true;
  el.previewGuide.hidden = Boolean(text.trim());
  if (!text.trim()) return;

  let items;
  try {
    items = parseSchedule(text);
  } catch (error) {
    if (!(error instanceof ScheduleError)) throw error;
    el.planError.textContent = scheduleMessage(error.code, error.line);
    el.planError.hidden = false;
    el.planInput.setAttribute('aria-invalid', 'true');
    return;
  }
  if (!items.length) {
    el.previewGuide.hidden = false;
    return;
  }
  el.previewList.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      li.append(
        Object.assign(document.createElement('span'), {
          className: 'preview-time',
          textContent: `${formatClock(item.start)}–${formatClock(item.end)}`,
        }),
        Object.assign(document.createElement('span'), { className: 'preview-name', textContent: item.name }),
        Object.assign(document.createElement('span'), { className: 'preview-length', textContent: duration(item.end - item.start) }),
      );
      return li;
    }),
  );
  el.previewTotal.textContent = t('previewTotal', {
    count: items.length,
    from: formatClock(items[0].start),
    to: formatClock(items.at(-1).end),
  });
  el.previewList.hidden = false;
  el.previewTotal.hidden = false;
}

function openEditor() {
  if (el.editor.open) return;
  el.planInput.value = loadDraft() ?? state.schedule?.text ?? '';
  const running = anchorForEdit(Date.now()) === state.schedule?.anchor;
  el.startButton.textContent = t(running ? 'save' : 'start');
  renderVisibility();
  renderPreview();
  el.editor.showModal();
  requestAnimationFrame(() => el.planInput.focus());
}

function renderAlert() {
  el.alertButton.setAttribute('aria-pressed', String(state.alert));
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
  renderPreview();
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
});
el.alertButton.addEventListener('click', () => {
  state.alert = !state.alert;
  localStorage.setItem('today.alert', String(state.alert));
  renderAlert();
  if (state.alert) unlockAudio();
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

el.appsButton.addEventListener('click', () => el.appsDialog.showModal());
el.closeApps.addEventListener('click', () => el.appsDialog.close());
el.appsDialog.addEventListener('click', (event) => {
  if (event.target === el.appsDialog) el.appsDialog.close();
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
  // The board changes by the minute, and by the second in anyone's last five.
  if (state.view === 'mine') renderMine();
  else if (new Date().getSeconds() % 15 === 0 || el.board.querySelector('.is-urgent')) renderBoard();
}, 1000);
setInterval(() => {
  if (document.visibilityState === 'visible' && state.view === 'everyone') loadBoard();
}, BOARD_REFRESH_MS);

translatePage();
renderAlert();
setView(state.view);
loadProfile().catch((error) => showToast(error.message));
