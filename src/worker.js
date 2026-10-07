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
  DEFAULT_PLACE, DEFAULT_ROUTINE, RoutineError, itemPhase, keepoutState, remainingNeeds,
  parseRoutine, placeRoutine, progress, reportInstance, routineDay, routineSchedule, zonedDate,
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
      await currentRoutine(env, me);
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
    case 'PUT /api/routine/away':
      return saveAway(request, env, me);
    case 'POST /api/routine/start':
      return routineStatus(request, env, me, 'start');
    case 'POST /api/routine/done':
      return routineStatus(request, env, me, 'done');
    case 'POST /api/routine/proof':
      return routineProof(request, env, me);
    case 'POST /api/routine/snooze':
      return routineSnooze(request, env, me);
    // Gateway MUST route this exact POST as mcp (machine credentials only,
    // today scope/visibility). The shared token does not identify Hermes.
    case 'POST /api/routine/affordance':
      return routineAffordance(request, env, me);
    case 'GET /api/routine/report':
      return routineReport(env, me, url);
    case 'GET /api/keepout': {
      const now = Date.now();
      const routine = await currentRoutine(env, me, now);
      // Harness hooks ask for one plain line: empty when free.
      if (request.headers.get('accept')?.includes('text/plain')) {
        return new Response(keepoutText(routine), {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      const result = { now, day: routine.today?.day ?? null, keepout: routine.today?.keepout ?? null };
      // Proof collectors need an open window before it becomes a lock.
      const proof = url.searchParams.get('proof');
      if (proof !== null) {
        if (!['wake', 'photo', 'away'].includes(proof)) return json(400, { error: 'bad_request' });
        const item = proofItem(routine, proof, now);
        result.item = item && !Object.hasOwn(progress(routine.day, item, routine.statuses[item.key], now).proofs, proof)
          ? { key: item.key, start: item.start, end: item.end, awayMinutes: item.awayMinutes } : null;
      }
      return json(200, result);
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
  const routine = await currentRoutine(env, me);
  let row = await person(env, me.sub);
  if (!row || row.name !== me.name) row = await upsertPerson(env, me);
  return {
    me: { sub: me.sub, name: me.name, email: me.email },
    visibility: row.visibility,
    routineEnabled: Boolean(routine.row?.enabled),
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
  await currentRoutine(env, me);
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
  result.day = day;
  const away = await env.DB.prepare('SELECT day FROM routine_away WHERE sub = ?1 AND day = ?2')
    .bind(me.sub, day.day).first();
  if (away) {
    await observeRoutine(env, me.sub, row, day, now, true);
    result.today = { day: day.day, items: [], keepout: null };
    return result;
  }
  // Opting in skips ended slots; open windows and ongoing items stay owed.
  day.items = day.items.map((item) => (item.start === item.end
    ? item.start < row.enabled_at : item.end <= row.enabled_at)
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
  const fresh = await savedRoutine(env, me.sub);
  if (fresh.text !== row.text || fresh.enabled !== row.enabled || fresh.instance !== row.instance
      || fresh.enabled_at !== row.enabled_at
      || fresh.tz !== row.tz || fresh.lat !== row.lat || fresh.lon !== row.lon) {
    return currentRoutine(env, me, now);
  }
  row = fresh;
  result.row = row;
  await observeRoutine(env, me.sub, row, day, now, false);
  const observed = await env.DB.prepare(
    'SELECT stopped_at FROM routine_days WHERE sub = ?1 AND day = ?2 AND instance = ?3',
  ).bind(me.sub, day.day, row.instance).first();
  if (observed?.stopped_at != null) {
    // Hermes skipped the rest of this day: nothing locks until the next one.
    result.today = { day: day.day, items: [], keepout: null, skipped: true };
    return result;
  }
  const { results } = await env.DB.prepare(
    'SELECT key, started_at, done_at, proofs, snoozed_until FROM routine_status WHERE sub = ?1 AND day = ?2',
  ).bind(me.sub, day.day).all();
  const statuses = Object.fromEntries(results.map((status) => [status.key, {
    startedAt: status.started_at, doneAt: status.done_at, proofs: JSON.parse(status.proofs),
    snoozedUntil: status.snoozed_until,
  }]));
  const { results: bypasses } = await env.DB.prepare(
    "SELECT day, key, at, reason FROM routine_affordances WHERE sub = ?1 AND day = ?2 AND instance = ?3 AND action = 'bypass'",
  ).bind(me.sub, day.day, row.instance).all();
  for (const bypass of bypasses) statuses[bypass.key] = { ...statuses[bypass.key], bypass };
  result.day = day;
  result.statuses = statuses;
  result.today = {
    day: day.day,
    items: day.items.map((item) => ({
      ...item, startedAt: statuses[item.key]?.startedAt ?? null,
      doneAt: statuses[item.key]?.doneAt ?? null,
      proofs: progress(day, item, statuses[item.key], now).proofs,
      phase: itemPhase(day, item, statuses[item.key], now),
      ...(statuses[item.key]?.bypass ? { bypass: statuses[item.key].bypass } : {}),
    })),
    keepout: keepoutState(day, statuses, now),
  };
  return result;
}

// Seven elapsed days, pruned per subject on routine observation/report reads.
const REPORT_KEEP_MS = 7 * DAY_MS;

async function trimRoutineHistory(env, sub, now) {
  await env.DB.prepare('DELETE FROM routine_days WHERE sub = ?1 AND ends < ?2')
    .bind(sub, now - REPORT_KEEP_MS).run();
  await env.DB.prepare('DELETE FROM routine_affordances WHERE sub = ?1 AND at < ?2 AND NOT EXISTS ' +
    '(SELECT 1 FROM routine_days WHERE sub = ?1 AND day = routine_affordances.day)')
    .bind(sub, now - REPORT_KEEP_MS).run();
}

async function observeRoutine(env, sub, row, day, now, away) {
  // INSERT SELECT copies progress inside the same statement as the snapshot.
  // A first observation after a deadline cannot establish a known miss.
  await env.DB.prepare(
    'INSERT INTO routine_days (sub, day, enabled_at, observed_at, ends, data, statuses, instance) ' +
      'SELECT ?1, ?2, ?3, ?4, ?5, ?6, COALESCE((SELECT json_group_object(key, json_object(' +
      "'startedAt', started_at, 'doneAt', done_at, 'proofs', json(proofs))) FROM routine_status " +
      'WHERE sub = ?1 AND day = ?2), \'{}\'), instance FROM routines WHERE sub = ?1 AND enabled = 1 AND revision = ?7 ' +
      'ON CONFLICT (sub, day, instance) DO UPDATE SET data = excluded.data, observed_at = excluded.observed_at, ' +
      "statuses = excluded.statuses WHERE json_extract(routine_days.data, '$.away') = 1 AND json_extract(excluded.data, '$.away') = 0",
  ).bind(sub, day.day, row.enabled_at, now, day.ends, JSON.stringify({ day, away }), row.revision).run();
  await trimRoutineHistory(env, sub, now);
}

function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const epoch = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === day;
}

function affordanceReceipt(row) {
  return { requestId: row.request_id, action: row.action, day: row.day,
    key: row.key, reason: row.reason, at: row.at, instance: row.instance };
}

/** POST /api/routine/affordance contract (gateway: exact mcp route, today scope).
 * Request: {action:'bypass'|'skip_day'|'off', day:'YYYY-MM-DD', key?:string,
 *   reason:string, requestId:UUID}. Bypass requires key (1..100 UTF-16 units);
 * skip_day and off omit key. skip_day ends today's locks and keeps the routine on. Reason is nonblank, <=200 Unicode code points. No extra fields.
 * 200: {receipt:{requestId,action,day,key:string|null,reason,at:epochMs,instance}}.
 * Receipts are first-write, subject-scoped and stable across rollover/off.
 * 400 bad_request; 401 unauthenticated; 409 not_due|locked|state_changed|
 * request_conflict. A state_changed rejection creates no receipt; re-read state.
 * Browser denial belongs to the gateway. Neither identity nor this shared token
 * identifies Hermes; the worker does not inspect stripped credentials.
 */
async function routineAffordance(request, env, me) {
  const body = await request.json().catch(() => null);
  if (!body || Array.isArray(body) || !['bypass', 'skip_day', 'off'].includes(body.action) || !validDay(body.day)
      || typeof body.reason !== 'string' || !body.reason.trim() || [...body.reason].length > 200
      || typeof body.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
      || (body.action === 'bypass' && (typeof body.key !== 'string' || !body.key || body.key.length > 100))
      || (body.action !== 'bypass' && Object.hasOwn(body, 'key'))
      || Object.keys(body).some((key) => !['action', 'day', 'key', 'reason', 'requestId'].includes(key))) {
    return json(400, { error: 'bad_request' });
  }
  const requestId = body.requestId.toLowerCase();
  const key = body.action === 'bypass' ? body.key : null;
  const payload = JSON.stringify({ action: body.action, day: body.day, key, reason: body.reason });
  const readReceipt = () => env.DB.prepare('SELECT * FROM routine_affordances WHERE sub = ?1 AND request_id = ?2')
    .bind(me.sub, requestId).first();
  const receiptResponse = (receipt) => receipt.payload === payload
    ? json(200, { receipt: affordanceReceipt(receipt) }) : json(409, { error: 'request_conflict' });
  const previous = await readReceipt();
  if (previous) return receiptResponse(previous);
  const routine = await currentRoutine(env, me, Date.now());
  const now = Date.now();
  if (!routine.row?.enabled || !routine.day || body.day !== routine.day.day || now >= routine.day.ends
      || (routine.today?.skipped && body.action !== 'off')) {
    return json(409, { error: 'not_due' });
  }
  if (body.action === 'bypass') {
    if (!routine.statuses) return json(409, { error: 'not_due' });
    const item = routine.day.items.find((entry) => entry.key === key);
    if (!item?.keepout || !item.until.length) return json(409, { error: 'not_due' });
    const lock = keepoutState(routine.day, routine.statuses, now);
    if (lock && lock.key !== key) return json(409, { error: 'locked' });
    const phase = itemPhase(routine.day, item, routine.statuses[key], now);
    if (phase !== 'locked' && !(phase === 'open' && item.kind === 'window')) {
      return json(409, { error: 'not_due' });
    }
  }
  // Revision changes on every relevant state write. Eligibility evaluated above
  // remains valid only if that entire state is unchanged at transaction time.
  const insert = env.DB.prepare(
    'INSERT OR IGNORE INTO routine_affordances ' +
      '(sub, request_id, payload, action, day, key, reason, at, enabled_at, instance) ' +
      'SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, enabled_at, instance FROM routines ' +
      'WHERE sub = ?1 AND enabled = 1 AND revision = ?9 AND enabled_at = ?10',
  ).bind(me.sub, requestId, payload, body.action, body.day, key, body.reason, now,
    routine.row.revision, routine.row.enabled_at);
  const statements = [insert];
  if (body.action === 'skip_day') {
    statements.push(env.DB.prepare(
      'UPDATE routine_days SET stopped_at = ?4 WHERE sub = ?1 AND day = ?5 AND instance = ?6 ' +
        'AND stopped_at IS NULL AND EXISTS (SELECT 1 FROM routine_affordances WHERE sub = ?1 ' +
        'AND request_id = ?2 AND payload = ?3 AND at = ?4)',
    ).bind(me.sub, requestId, payload, now, body.day, routine.row.instance));
  }
  if (body.action === 'off') {
    // The event, stop boundary and off switch commit together, or not at all.
    const accepted = 'EXISTS (SELECT 1 FROM routine_affordances WHERE sub = ?1 AND request_id = ?2 ' +
      'AND payload = ?3 AND at = ?4 AND instance = ?5) ' +
      'AND EXISTS (SELECT 1 FROM routines WHERE sub = ?1 AND revision = ?7)';
    statements.push(
      env.DB.prepare('UPDATE routine_days SET stopped_at = ?4 WHERE sub = ?1 AND day = ?6 ' +
        `AND instance = ?5 AND stopped_at IS NULL AND ${accepted}`)
        .bind(me.sub, requestId, payload, now, routine.row.instance, body.day, routine.row.revision + 1),
      env.DB.prepare(`UPDATE routines SET enabled = 0, updated_at = ?4 WHERE sub = ?1 AND instance = ?5 AND ${accepted}`)
        .bind(me.sub, requestId, payload, now, routine.row.instance, body.day, routine.row.revision + 1),
    );
  }
  const [written] = await env.DB.batch(statements);
  const receipt = await readReceipt();
  if (receipt) return receiptResponse(receipt);
  return json(409, { error: written.meta.changes ? 'not_due' : 'state_changed' });
}

/** GET /api/routine/report?day=YYYY-MM-DD contract (gateway: api, today scope).
 * 200: {day, completed:true|null, coverage:'complete'|'partial'|'missing',
 *   instances:[{instance,enabledAt,observedAt,starts,ends,stoppedAt:number|null,
 *     away:boolean,items:[{key,name,deadline,outcome,missedDeadline,
 *       proofs?:{[proof]:{at,note}},doneAt?:number|null}]}],
 *   missed:[{...item,instance}], events:[receipt]}.
 * Outcomes: skipped|released|bypassed|done|missed|unknown; missedDeadline is
 * boolean|null (null means insufficient evidence). All times are epoch ms.
 * complete describes data coverage, not successful completion of all items.
 * No snapshot: completed:null, coverage:missing, empty arrays; never a miss.
 * 400 bad_request; 401 unauthenticated; 409 day_incomplete (original ends).
 * History is observed only, retained seven elapsed days after instance ends;
 * associated receipts remain until their snapshots expire. No backfilling.
 */
async function routineReport(env, me, url) {
  const date = url.searchParams.get('day');
  if (!validDay(date)) return json(400, { error: 'bad_request' });
  const now = Date.now();
  const current = await currentRoutine(env, me, now);
  await trimRoutineHistory(env, me.sub, now);
  const { results: rows } = await env.DB.prepare(
    'SELECT * FROM routine_days WHERE sub = ?1 AND day = ?2 ORDER BY instance',
  ).bind(me.sub, date).all();
  if (rows.some((row) => row.ends > now) || (!rows.length && date >= currentRoutineDay(current, now))) {
    return json(409, { error: 'day_incomplete' });
  }
  const { results: events } = await env.DB.prepare(
    'SELECT * FROM routine_affordances WHERE sub = ?1 AND day = ?2 ORDER BY at, request_id',
  ).bind(me.sub, date).all();
  const instances = rows.map((row) => {
    const data = JSON.parse(row.data);
    const statuses = JSON.parse(row.statuses);
    for (const event of events) if (event.action === 'bypass' && event.instance === row.instance) {
      statuses[event.key] = { ...statuses[event.key], bypass: affordanceReceipt(event) };
    }
    return { instance: row.instance, enabledAt: row.enabled_at, observedAt: row.observed_at,
      starts: data.day.items[0].start, ends: row.ends, stoppedAt: row.stopped_at,
      away: data.away,
      items: reportInstance({ ...data, statuses, observedAt: row.observed_at, stoppedAt: row.stopped_at }) };
  });
  const items = instances.flatMap((instance) => instance.items.map((item) => ({ ...item, instance: instance.instance })));
  return json(200, { day: date, completed: rows.length ? true : null,
    coverage: !rows.length ? 'missing'
      : items.some((item) => item.outcome === 'unknown' || item.missedDeadline === null) ? 'partial' : 'complete',
    instances, missed: items.filter((item) => item.outcome === 'missed' || item.missedDeadline === true),
    events: events.map(affordanceReceipt) });
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

function currentRoutineDay(routine, now = Date.now()) {
  if (routine.day) return routine.day.day;
  const row = { ...DEFAULT_PLACE, text: DEFAULT_ROUTINE, ...routine.row };
  try {
    return routineInstance(row, now, null).day;
  } catch (error) {
    if (!(error instanceof RoutineError)) throw error;
    return zonedDate(now, row.tz);
  }
}

async function routineProfile(env, me) {
  const routine = await currentRoutine(env, me);
  const { results: away } = await env.DB.prepare(
    'SELECT day, reason FROM routine_away WHERE sub = ?1 AND day >= ?2 ORDER BY day',
  ).bind(me.sub, currentRoutineDay(routine)).all();
  return { ...routineValue(routine), away };
}

async function saveAway(request, env, me) {
  const body = await request.json().catch(() => null);
  const epoch = typeof body?.day === 'string' ? Date.parse(`${body.day}T00:00:00Z`) : NaN;
  if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(body.day) || !Number.isFinite(epoch)
      || new Date(epoch).toISOString().slice(0, 10) !== body.day
      || typeof body.away !== 'boolean' || (body.reason ?? '') !== String(body.reason ?? '')
      || [...(body.reason ?? '')].length > 200) return json(400, { error: 'bad_request' });
  const routine = await currentRoutine(env, me);
  const day = currentRoutineDay(routine);
  if (body.away && body.day <= day) return json(409, { error: 'too_late' });
  if (body.away) {
    await env.DB.prepare(
      'INSERT INTO routine_away (sub, day, reason, created_at) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT (sub, day) DO UPDATE SET reason = ?3',
    ).bind(me.sub, body.day, body.reason ?? '', Date.now()).run();
  } else {
    await env.DB.prepare('DELETE FROM routine_away WHERE sub = ?1 AND day = ?2')
      .bind(me.sub, body.day).run();
  }
  return json(200, await routineProfile(env, me));
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
  let revisedDay;
  if (Object.hasOwn(body, 'text')) {
    const place = current.row ?? DEFAULT_PLACE;
    try {
      const items = parseRoutine(text, place);
      if (current.row?.enabled) revisedDay = routineDay(items, now, place).day;
    } catch (error) {
      if (error instanceof RoutineError) return json(422, { error: error.code, line: error.line });
      throw error;
    }
  }
  if (current.row?.enabled) {
    if (Object.hasOwn(body, 'text')) {
      const day = current.day?.day ?? zonedDate(now, current.row.tz);
      const laterDay = day > revisedDay ? day : revisedDay;
      const pendingFrom = new Date(Date.parse(`${laterDay}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
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
  if (!routine.day || !routine.statuses || body.day !== routine.day.day) return json(409, { error: unavailable });
  const item = routine.day.items.find((item) => item.key === body.key);
  if (!item) return json(action === 'start' ? 404 : 409, {
    error: action === 'start' ? 'not_found' : 'not_due',
  });
  const status = routine.statuses[item.key];
  if (action === 'start') {
    const lock = routine.today.keepout;
    if (lock && lock.key !== item.key) return json(409, { error: 'locked' });
    if (status?.startedAt != null || status?.doneAt != null
        || progress(routine.day, item, status, now).done
        || progress(routine.day, item, status, now).bypassed) return json(409, { error: 'already' });
    if (!item.keepout || item.kind !== 'window' || now < item.start || now >= item.end) {
      return json(409, { error: 'not_open' });
    }
    const written = await env.DB.prepare(
      'INSERT INTO routine_status (sub, day, key, started_at) SELECT ?1, ?2, ?3, ?4 ' +
        routineWriteGuard(5, 6) + ' ' +
        'ON CONFLICT (sub, day, key) DO UPDATE SET started_at = ?4 ' +
        'WHERE started_at IS NULL AND done_at IS NULL',
    ).bind(me.sub, body.day, body.key, now, routine.row.instance, routine.row.text).run();
    if (!written.meta.changes) return json(409, { error: 'already' });
  } else {
    const lock = routine.today.keepout;
    if (lock && lock.key !== item.key) return json(409, { error: 'locked' });
    // A keepout window can also be finished while open, before it locks.
    const phase = itemPhase(routine.day, item, status, now);
    const early = phase === 'open' && item.kind === 'window';
    if (!item.keepout || !item.until.length || (phase !== 'locked' && !early)) {
      return json(409, { error: 'not_due' });
    }
    // Proof items unlock only through their proofs or a Hermes affordance;
    // Done finishes an `until done` item once its other proofs are in.
    if (!item.until.includes('done')) return json(409, { error: 'not_needed' });
    const proofs = progress(routine.day, item, status, now).proofs;
    if (!item.until.every((need) => need === 'done' || Object.hasOwn(proofs, need))) {
      return json(409, { error: 'needs_proof' });
    }
    if (!early && now < lock.doneAfter) return json(409, { error: 'too_soon' });
    const written = await env.DB.prepare(
      'INSERT INTO routine_status (sub, day, key, done_at) SELECT ?1, ?2, ?3, ?4 ' +
        routineWriteGuard(5, 6) + ' ' +
        'ON CONFLICT (sub, day, key) DO UPDATE SET done_at = COALESCE(done_at, ?4)',
    ).bind(me.sub, body.day, body.key, now, routine.row.instance, routine.row.text).run();
    if (!written.meta.changes) return json(409, { error: 'state_changed' });
  }
  return json(200, await routineProfile(env, me));
}

function routineWriteGuard(instance, text) {
  return 'FROM routines WHERE sub = ?1 AND enabled = 1 AND materialized_day = ?2 ' +
    `AND instance = ?${instance} AND text = ?${text} ` +
    'AND NOT EXISTS (SELECT 1 FROM routine_away WHERE sub = ?1 AND day = ?2) ' +
    "AND NOT EXISTS (SELECT 1 FROM routine_affordances WHERE sub = ?1 AND day = ?2 AND key = ?3 AND instance = routines.instance AND action = 'bypass') " +
    "AND NOT EXISTS (SELECT 1 FROM routine_affordances WHERE sub = ?1 AND day = ?2 AND instance = routines.instance AND action = 'skip_day')";
}

/** Silence a ringing wake alarm; the lock stays until the wake proof. */
async function routineSnooze(request, env, me) {
  const body = await request.json().catch(() => null);
  if (!body || ![5, 30, 60].includes(body.minutes)) return json(400, { error: 'bad_request' });
  const now = Date.now();
  const routine = await currentRoutine(env, me, now);
  const lock = routine.today?.keepout;
  if (!lock || !lock.needs.includes('wake') || lock.have.includes('wake')) return json(409, { error: 'not_needed' });
  const written = await env.DB.prepare(
    'INSERT INTO routine_status (sub, day, key, snoozed_until) SELECT ?1, ?2, ?3, ?4 ' +
      routineWriteGuard(5, 6) + ' ' +
      'ON CONFLICT (sub, day, key) DO UPDATE SET snoozed_until = ?4',
  ).bind(me.sub, routine.day.day, lock.key, now + body.minutes * 60_000,
    routine.row.instance, routine.row.text).run();
  if (!written.meta.changes) return json(409, { error: 'state_changed' });
  const updated = await currentRoutine(env, me, now);
  return json(200, { now, day: updated.today?.day ?? null, keepout: updated.today?.keepout ?? null });
}

/** Select the current proof-bearing item without skipping an earlier lock. */
function proofItem(routine, proof, now) {
  if (!routine.statuses) return null;
  const lock = routine.today.keepout;
  if (lock) return routine.day.items.find((item) => item.key === lock.key && item.until.includes(proof)) ?? null;
  return routine.day.items.find((item) => item.keepout && item.kind === 'window'
    && item.until.includes(proof)
    && itemPhase(routine.day, item, routine.statuses[item.key], now) === 'open') ?? null;
}

/** Record a caller-verified proof. */
async function routineProof(request, env, me) {
  const body = await request.json().catch(() => null);
  const explicit = body && (Object.hasOwn(body, 'day') || Object.hasOwn(body, 'key'));
  if (!body || !['wake', 'photo', 'away'].includes(body.proof)
      || (Object.hasOwn(body, 'note') && (typeof body.note !== 'string' || [...body.note].length > 200))
      || (explicit && (typeof body.day !== 'string' || typeof body.key !== 'string'))) {
    return json(400, { error: 'bad_request' });
  }
  const now = Date.now();
  const routine = await currentRoutine(env, me, now);
  if (!routine.day || !routine.statuses || (explicit && body.day !== routine.day.day)) {
    return json(409, { error: explicit ? 'not_due' : 'not_needed' });
  }
  const lock = routine.today.keepout;
  const item = explicit ? routine.day.items.find((item) => item.key === body.key)
    : proofItem(routine, body.proof, now)
      ?? routine.day.items.find((item) => item.keepout && item.kind === 'window'
        && item.until.includes(body.proof)
        && itemPhase(routine.day, item, routine.statuses[item.key], now) === 'open');
  if (!item) return json(409, { error: explicit ? 'not_due' : 'not_needed' });
  if (!item.keepout || !item.until.includes(body.proof)) return json(409, { error: 'not_needed' });
  const status = routine.statuses[item.key];
  const p = progress(routine.day, item, status, now);
  if (p.bypassed) return json(409, { error: 'not_due' });
  const response = async () => {
    const updated = await routineProfile(env, me);
    return json(200, { ...updated, item: updated.today?.items.find((entry) => entry.key === item.key) ?? null,
      keepout: updated.today?.keepout ?? null });
  };
  // Retrying an accepted proof preserves its first timestamp and note, even after completion.
  if (Object.hasOwn(p.proofs, body.proof)) return response();
  if (lock && lock.key !== item.key) return json(409, { error: 'locked' });
  const phase = itemPhase(routine.day, item, status, now);
  const early = phase === 'open' && item.kind === 'window';
  if (phase !== 'locked' && !early) return json(409, { error: 'not_due' });
  if (!early && now < p.doneAfter) return json(409, { error: 'too_soon' });
  // Merge in SQL so simultaneous different proofs cannot overwrite each other.
  // The WHERE also makes retries preserve the original proof.
  const written = await env.DB.prepare(
    'INSERT INTO routine_status (sub, day, key, proofs) SELECT ?1, ?2, ?3, json_object(?4, json(?5)) ' +
      routineWriteGuard(7, 8) + ' ' +
      'ON CONFLICT (sub, day, key) DO UPDATE SET proofs = json_set(proofs, ?6, json(?5)) ' +
      'WHERE json_extract(proofs, ?6) IS NULL',
  ).bind(me.sub, routine.day.day, item.key, body.proof,
    JSON.stringify({ at: now, note: body.note ?? '' }), `$.${body.proof}`,
    routine.row.instance, routine.row.text).run();
  if (!written.meta.changes) {
    const row = await env.DB.prepare('SELECT proofs FROM routine_status WHERE sub = ?1 AND day = ?2 AND key = ?3')
      .bind(me.sub, routine.day.day, item.key).first();
    if (!row || !Object.hasOwn(JSON.parse(row.proofs), body.proof)) return json(409, { error: 'state_changed' });
  }
  return response();
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
    if (routine.row?.enabled) row = await person(env, row.sub);
    const items = itemsOf(row);
    const current = items.length && items.at(-1).end > now - BOARD_KEEP_MS;
    // Your own keepouts only; friends see plain items.
    const locks = row.sub === me.sub ? boardLocks(routine.today) : null;
    people.push({
      name: row.name,
      me: row.sub === me.sub,
      visibility: row.visibility,
      items: !current ? [] : locks ? items.map((item) => {
        const lock = locks.get(`${item.start} ${item.end} ${item.name}`);
        return lock === undefined ? item : { ...item, lock };
      }) : items,
    });
  }
  people.sort((a, b) => Number(b.me) - Number(a.me));
  return { now, people };
}

/** When each still-owed keepout locks, keyed like a board item; as on the routine page. */
function boardLocks(today) {
  const locks = new Map();
  for (const item of today?.items ?? []) {
    if (!item.keepout || ['bypassed', 'done', 'past'].includes(item.phase)) continue;
    locks.set(`${item.start} ${item.end} ${item.name}`, item.kind === 'window' ? item.end : item.start);
  }
  return locks;
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

function keepoutText(routine) {
  const keepout = routine.today?.keepout;
  if (!keepout) return '';
  const name = keepout.name.replace(/\s+/g, ' ').trim();
  const needs = remainingNeeds(keepout);
  if (needs.join() === 'done') return `today keepout: ${name}. mark it done on today.lost.plus to unlock.\n`;
  if (needs.length) return `today keepout: ${name}. send its proof to Hermes to unlock.\n`;
  if (!keepout.until) return `today keepout: ${name}.\n`;
  const time = new Intl.DateTimeFormat('en-CA', {
    timeZone: routine.row?.tz ?? DEFAULT_PLACE.tz,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(keepout.until);
  return `today keepout: ${name} until ${time}. try again then.\n`;
}

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
