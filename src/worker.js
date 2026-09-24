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
//                         (including /download/mac, the newest Mac app)
//
// Static files in public/ are served before this code runs; see wrangler.jsonc.

import { identityFrom } from '@lpfchan/gateway-identity';
import { ScheduleError, absoluteItems, parseSchedule, serializeSchedule } from '../public/schedule.js';

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
  const current = await person(env, me.sub);
  const next = {
    name: me.name,
    visibility: fields.visibility ?? current?.visibility ?? 'private',
    schedule: fields.schedule ?? current?.schedule ?? '',
    anchor: fields.anchor ?? current?.anchor ?? 0,
  };
  await env.DB.prepare(
    'INSERT INTO people (sub, name, visibility, schedule, anchor, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
      'ON CONFLICT (sub) DO UPDATE SET name = ?2, visibility = ?3, schedule = ?4, anchor = ?5, updated_at = ?6',
  )
    .bind(me.sub, next.name, next.visibility, next.schedule, next.anchor, now)
    .run();
  return { sub: me.sub, ...next, updated_at: now };
}

async function profile(env, me) {
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
  const people = results.map((row) => {
    const items = itemsOf(row);
    const current = items.length && items.at(-1).end > now - BOARD_KEEP_MS;
    return {
      name: row.name,
      me: row.sub === me.sub,
      visibility: row.visibility,
      items: current ? items : [],
    };
  });
  people.sort((a, b) => Number(b.me) - Number(a.me));
  return { now, people };
}

/** The caller's schedule for the watch: [startSec, endSec, name] rows. */
async function watch(env, me) {
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
