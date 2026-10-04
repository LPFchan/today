// today.lost.plus — the API behind the timer, the shared board, and the watch.
//
// This Worker has no public route of its own. The Common Auth gateway holds
// today.lost.plus and reaches it through a service binding, so the
// x-lost-plus-* identity headers read here were put there by the gateway and
// cannot come from a caller. Route policies (LPFchan/auth,
// gateway/config/cloudflare.gateway.json):
//
//   /api/watch  api     — the watch's hub-issued access token, or a browser session
//   /api/board  api     — the same, for the Mac app, or a browser session
//   /           oauth   — everything else, browser session only
//                         (including /api/routine, /api/routine/start,
//                          /api/routine/done, /api/keepout and /download/mac)
//
// Static files in public/ are served before this code runs; see wrangler.jsonc.

import { identityFrom } from '@lpfchan/gateway-identity';
import { ScheduleError, absoluteItems, parseSchedule, serializeSchedule } from '../public/schedule.js';
import {
  DEFAULT_PLACE, DEFAULT_ROUTINE, RoutineError, itemPhase, keepoutState,
  parseRoutine, placeRoutine, routineDay, routineSchedule, zonedDate,
} from '../public/routine.js';

const DAY_MS = 24 * 60 * 60_000;
// The board lists a schedule until this long after its last item ends.
const BOARD_KEEP_MS = 12 * 60 * 60_000;
// Watch payload limits: item count, and bytes per name (UTF-8).
const WATCH_ITEMS = 32;
const WATCH_NAME_BYTES = 60;
// Mac releases aren't GitHub's "latest" (the watch owns that link), so the
// newest Mac download is read from the Sparkle feed, which lists newest first.
const MAC_FEED = 'https://raw.githubusercontent.com/LPFchan/today/mac-appcast/appcast.xml';
const MAC_RELEASES = 'https://github.com/LPFchan/today/releases/';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        return await api(request, env, url);
      }
      if (url.pathname === '/download/mac') {
        return await macDownload();
      }
      return json(404, { error: 'not_found' });
    } catch (error) {
      console.error(error);
      return json(500, { error: 'internal' });
    }
  },
};

async function macDownload() {
  const feed = await fetch(MAC_FEED, { cf: { cacheTtl: 300 } });
  const latest = feed.ok ? /<enclosure url="([^"]+)"/.exec(await feed.text())?.[1] : null;
  const to = latest?.startsWith(`${MAC_RELEASES}download/`) ? latest : MAC_RELEASES;
  return Response.redirect(to, 302);
}

/* ---------- API (identity required) ---------- */

async function api(request, env, url) {
  const me = identityFrom(request.headers, { maxNameLength: 80 });
  if (!me) return json(401, { error: 'unauthenticated' });
  const route = `${request.method} ${url.pathname}`;

  switch (route) {
    case 'GET /api/me':
      return json(200, await profile(env, me));
    case 'PUT /api/schedule':
      return saveSchedule(request, env, me);
    case 'DELETE /api/schedule':
      await upsertPerson(env, me, { schedule: '', anchor: 0 });
      return json(200, await profile(env, me));
    case 'PUT /api/visibility':
      return saveVisibility(request, env, me);
    case 'GET /api/board':
      return json(200, await board(env, me));
    case 'GET /api/watch':
      return json(200, await watch(env, me));
    case 'GET /api/routine':
      return json(200, await routineProfile(env, me));
    case 'PUT /api/routine':
      return saveRoutine(request, env, me);
    case 'POST /api/routine/start':
      return routineStatus(request, env, me, 'start');
    case 'POST /api/routine/done':
      return routineStatus(request, env, me, 'done');
    case 'GET /api/keepout': {
      const now = Date.now();
      const routine = await currentRoutine(env, me, now);
      return json(200, { now, keepout: routine.today?.keepout ?? null });
    }
    default:
      return json(404, { error: 'not_found' });
  }
}

async function person(env, sub) {
  return env.DB.prepare('SELECT sub, name, visibility, schedule, anchor, updated_at FROM people WHERE sub = ?1')
    .bind(sub)
    .first();
}

/** Insert or update the caller's row. The display name follows the hub. */
async function upsertPerson(env, me, fields = {}) {
  const now = Date.now();
  const updates = ['updated_at = ?6'];
  if (fields.schedule == null && fields.anchor == null) updates.push('name = ?2');
  if (fields.visibility != null) updates.push('visibility = ?3');
  if (fields.schedule != null) updates.push('schedule = ?4');
  if (fields.anchor != null) updates.push('anchor = ?5');
  await env.DB.prepare(
    'INSERT INTO people (sub, name, visibility, schedule, anchor, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
      `ON CONFLICT (sub) DO UPDATE SET ${updates.join(', ')}`,
  )
    .bind(me.sub, me.name, fields.visibility ?? 'private', fields.schedule ?? '', fields.anchor ?? 0, now)
    .run();
  return person(env, me.sub);
}

async function profile(env, me) {
  await currentRoutine(env, me);
  let row = await person(env, me.sub);
  if (!row || row.name !== me.name) row = await upsertPerson(env, me);
  return {
    me: { sub: me.sub, name: me.name, email: me.email },
    visibility: row.visibility,
    schedule: row.schedule ? { text: row.schedule, anchor: row.anchor } : null,
  };
}

async function saveSchedule(request, env, me) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== 'string' || !Number.isSafeInteger(body.anchor)) {
    return json(400, { error: 'bad_request' });
  }
  // The anchor is the client's local midnight. It has to be near now: a day
  // either side covers every timezone and a schedule started just after midnight.
  if (Math.abs(body.anchor - Date.now()) > 2 * DAY_MS) {
    return json(400, { error: 'bad_anchor' });
  }
  let items;
  try {
    items = parseSchedule(body.text);
  } catch (error) {
    if (error instanceof ScheduleError) return json(422, { error: error.code, line: error.line });
    throw error;
  }
  if (!items.length) return json(422, { error: 'empty', line: 0 });
  await upsertPerson(env, me, { schedule: serializeSchedule(items), anchor: body.anchor });
  return json(200, await profile(env, me));
}

async function saveVisibility(request, env, me) {
  const body = await request.json().catch(() => null);
  if (body?.visibility !== 'public' && body?.visibility !== 'private') {
    return json(400, { error: 'bad_request' });
  }
  await upsertPerson(env, me, { visibility: body.visibility });
  return json(200, await profile(env, me));
}

/* ---------- opt-in routine ---------- */

async function savedRoutine(env, sub) {
  return env.DB.prepare('SELECT * FROM routines WHERE sub = ?1').bind(sub).first();
}

function routineInstance(row, now, earliestDay = row.materialized_day) {
  const place = { tz: row.tz, lat: row.lat, lon: row.lon };
  const items = parseRoutine(row.text, place, { validate: false });
  const day = routineDay(items, now, place);
  // Moving the first start later must not bring yesterday's instance back.
  return earliestDay && day.day < earliestDay ? placeRoutine(items, earliestDay, place) : day;
}

/** Place the current instance; unavailable routines leave the day plan alone. */
async function currentRoutine(env, me, now = Date.now()) {
  let row = await savedRoutine(env, me.sub);
  const result = { row, today: null, materialized: false };
  if (!row || (!row.enabled && !row.pending_text)) return result;
  let day;
  try {
    let pendingDay = null;
    if (row.pending_text !== null && row.pending_from !== null) {
      try {
        pendingDay = routineInstance({ ...row, text: row.pending_text }, now, null);
      } catch (error) {
        if (!(error instanceof RoutineError)) throw error;
      }
    }
    if (pendingDay && pendingDay.day >= row.pending_from) {
      await env.DB.prepare(
        'UPDATE routines SET text = pending_text, pending_text = NULL, pending_from = NULL, ' +
          'materialized_day = NULL WHERE sub = ?1 AND pending_from <= ?2',
      ).bind(me.sub, pendingDay.day).run();
      row = await savedRoutine(env, me.sub);
      result.row = row;
    }
    day = routineInstance(row, now);
  } catch (error) {
    if (error instanceof RoutineError) return result;
    throw error;
  }
  if (!row.enabled) return result;
  // Opting in skips ended slots; open windows and ongoing items stay owed.
  day.items = day.items.map((item) => item.end <= row.enabled_at
    ? { ...item, keepout: false } : item);
  if (row.materialized_day !== day.day) {
    const schedule = routineSchedule(day);
    await env.DB.prepare('INSERT OR IGNORE INTO people (sub, name, updated_at) VALUES (?1, ?2, ?3)')
      .bind(me.sub, me.name, now).run();
    const [, claim] = await env.DB.batch([
      env.DB.prepare(
        'UPDATE people SET schedule = ?3, anchor = ?4, updated_at = ?5 WHERE sub = ?1 ' +
          'AND EXISTS (SELECT 1 FROM routines WHERE sub = ?1 AND materialized_day IS NOT ?2)',
      ).bind(me.sub, day.day, serializeSchedule(parseSchedule(schedule.text)), schedule.anchor, now),
      env.DB.prepare(
        'UPDATE routines SET materialized_day = ?2 WHERE sub = ?1 AND materialized_day IS NOT ?2',
      ).bind(me.sub, day.day),
    ]);
    if (claim.meta.changes) {
      const yesterday = new Date(Date.parse(`${day.day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
      await env.DB.prepare('DELETE FROM routine_status WHERE sub = ?1 AND day < ?2')
        .bind(me.sub, yesterday).run();
      result.materialized = true;
    }
  }
  const { results } = await env.DB.prepare(
    'SELECT key, started_at, done_at FROM routine_status WHERE sub = ?1 AND day = ?2',
  ).bind(me.sub, day.day).all();
  const statuses = Object.fromEntries(results.map((status) => [status.key, {
    startedAt: status.started_at, doneAt: status.done_at,
  }]));
  result.day = day;
  result.statuses = statuses;
  result.today = {
    day: day.day,
    items: day.items.map((item) => ({
      ...item, startedAt: statuses[item.key]?.startedAt ?? null,
      doneAt: statuses[item.key]?.doneAt ?? null,
      phase: itemPhase(day, item, statuses[item.key], now),
    })),
    keepout: keepoutState(day, statuses, now),
  };
  return result;
}

function routineValue(routine) {
  return {
    enabled: Boolean(routine.row?.enabled),
    text: routine.row?.pending_text ?? routine.row?.text ?? DEFAULT_ROUTINE,
    pendingFrom: routine.row?.pending_from ?? null,
    tz: routine.row?.tz ?? DEFAULT_PLACE.tz,
    today: routine.today,
  };
}

async function routineProfile(env, me) {
  return routineValue(await currentRoutine(env, me));
}

async function saveRoutine(request, env, me) {
  const body = await request.json().catch(() => null);
  if (!body || Array.isArray(body) || typeof body !== 'object'
      || (!Object.hasOwn(body, 'text') && !Object.hasOwn(body, 'enabled'))
      || (Object.hasOwn(body, 'text') && typeof body.text !== 'string')
      || (Object.hasOwn(body, 'enabled') && typeof body.enabled !== 'boolean')) {
    return json(400, { error: 'bad_request' });
  }
  const now = Date.now();
  const current = await currentRoutine(env, me, now);
  const text = body.text ?? current.row?.pending_text ?? current.row?.text ?? DEFAULT_ROUTINE;
  const enabled = body.enabled ?? Boolean(current.row?.enabled);
  if (current.row?.enabled && body.enabled === false) {
    return json(409, { error: 'ask_hermes' });
  }
  if (Object.hasOwn(body, 'text')) {
    const place = current.row ?? DEFAULT_PLACE;
    try {
      parseRoutine(text, place);
    } catch (error) {
      if (error instanceof RoutineError) return json(422, { error: error.code, line: error.line });
      throw error;
    }
  }
  if (current.row?.enabled) {
    if (Object.hasOwn(body, 'text')) {
      const day = current.day?.day ?? zonedDate(now, current.row.tz);
      const pendingFrom = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
      await env.DB.prepare(
        'UPDATE routines SET pending_text = ?2, pending_from = ?3, updated_at = ?4 WHERE sub = ?1',
      ).bind(me.sub, text, pendingFrom, now).run();
    }
    return json(200, await routineProfile(env, me));
  }
  await env.DB.prepare(
    'INSERT INTO routines (sub, text, enabled, updated_at, enabled_at) VALUES (?1, ?2, ?3, ?4, ?5) ' +
      'ON CONFLICT (sub) DO UPDATE SET text = ?2, enabled = ?3, updated_at = ?4, ' +
      'pending_text = NULL, pending_from = NULL, ' +
      'enabled_at = CASE WHEN enabled = 0 AND ?3 = 1 THEN ?4 ELSE enabled_at END, ' +
      'materialized_day = CASE WHEN enabled = 0 AND ?3 = 1 ' +
        'THEN NULL ELSE materialized_day END',
  ).bind(me.sub, text, Number(enabled), now, enabled ? now : 0).run();
  if (current.row && text !== current.row.text) {
    await env.DB.prepare('DELETE FROM routine_status WHERE sub = ?1').bind(me.sub).run();
  }
  return json(200, await routineProfile(env, me));
}

async function routineStatus(request, env, me, action) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.day !== 'string' || typeof body.key !== 'string') {
    return json(400, { error: 'bad_request' });
  }
  const now = Date.now();
  const routine = await currentRoutine(env, me, now);
  const unavailable = action === 'start' ? 'not_open' : 'not_due';
  if (!routine.day || body.day !== routine.day.day) return json(409, { error: unavailable });
  const item = routine.day.items.find((item) => item.key === body.key);
  if (!item) return json(action === 'start' ? 404 : 409, {
    error: action === 'start' ? 'not_found' : 'not_due',
  });
  const status = routine.statuses[item.key];
  if (action === 'start') {
    const lock = routine.today.keepout;
    if (lock && lock.key !== item.key) return json(409, { error: 'locked' });
    if (status?.startedAt != null || status?.doneAt != null) return json(409, { error: 'already' });
    if (!item.keepout || item.kind !== 'window' || now < item.start || now >= item.end) {
      return json(409, { error: 'not_open' });
    }
    const written = await env.DB.prepare(
      'INSERT INTO routine_status (sub, day, key, started_at) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT (sub, day, key) DO UPDATE SET started_at = ?4 ' +
        'WHERE started_at IS NULL AND done_at IS NULL',
    ).bind(me.sub, body.day, body.key, now).run();
    if (!written.meta.changes) return json(409, { error: 'already' });
  } else {
    const lock = routine.today.keepout;
    if (lock && lock.key !== item.key) return json(409, { error: 'locked' });
    if (!item.keepout || !item.until.length
        || itemPhase(routine.day, item, status, now) !== 'locked') {
      return json(409, { error: 'not_due' });
    }
    if (now < lock.doneAfter) return json(409, { error: 'too_soon' });
    await env.DB.prepare(
      'INSERT INTO routine_status (sub, day, key, done_at) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT (sub, day, key) DO UPDATE SET done_at = ?4',
    ).bind(me.sub, body.day, body.key, now).run();
  }
  return json(200, await routineProfile(env, me));
}

/** Absolute items of a stored schedule, or [] when it is blank or unreadable. */
function itemsOf(row) {
  if (!row?.schedule) return [];
  try {
    return absoluteItems(parseSchedule(row.schedule), row.anchor);
  } catch {
    return [];
  }
}

async function board(env, me) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT sub, name, visibility, schedule, anchor FROM people WHERE visibility = 'public' OR sub = ?1 ORDER BY name",
  )
    .bind(me.sub)
    .all();
  const people = [];
  for (let row of results) {
    const routine = await currentRoutine(env, row, now);
    if (routine.materialized) row = await person(env, row.sub);
    const items = itemsOf(row);
    const current = items.length && items.at(-1).end > now - BOARD_KEEP_MS;
    people.push({
      name: row.name,
      me: row.sub === me.sub,
      visibility: row.visibility,
      items: current ? items : [],
    });
  }
  people.sort((a, b) => Number(b.me) - Number(a.me));
  return { now, people };
}

/** The caller's schedule for the watch: [startSec, endSec, name] rows. */
async function watch(env, me) {
  await currentRoutine(env, me);
  const row = await person(env, me.sub);
  const items = itemsOf(row).slice(0, WATCH_ITEMS);
  return {
    now: Math.floor(Date.now() / 1000),
    items: items.map((item) => [
      Math.floor(item.start / 1000),
      Math.floor(item.end / 1000),
      truncateUtf8(item.name, WATCH_NAME_BYTES),
    ]),
  };
}

function truncateUtf8(text, maxBytes) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = '';
  for (const char of text) {
    if (encoder.encode(out + char + '…').length > maxBytes) break;
    out += char;
  }
  return out + '…';
}

/* ---------- helpers ---------- */

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
