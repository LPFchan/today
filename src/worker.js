// today.lost.plus — the API behind the timer, the shared board, and the watch.
//
// This Worker has no public route of its own. The Common Auth gateway holds
// today.lost.plus and reaches it through a service binding, so the
// x-lost-plus-* identity headers read here were put there by the gateway and
// cannot come from a caller. Route policies (LPFchan/auth,
// gateway/config/cloudflare.gateway.json):
//
//   /api/watch  api     — the watch's hub-issued OAuth token, or a browser session
//   /api/board  api     — the same, for the Mac app, or a browser session
//   /pair       public  — the watch pairing mailbox; never reads identity
//   /           oauth   — everything else, browser session only
//
// Static files in public/ are served before this code runs; see wrangler.jsonc.

import { identityFrom } from '@lpfchan/gateway-identity';
import { ScheduleError, absoluteItems, parseSchedule, serializeSchedule } from '../public/schedule.js';

const ORIGIN = 'https://today.lost.plus';
const HUB = 'https://auth.lost.plus';
// The OAuth resource the gateway checks watch tokens against. It is always
// <host>/mcp, whatever the route; see gateway/src/verification.ts.
const RESOURCE = `${ORIGIN}/mcp`;
const TOKEN_SCOPE = 'today';
const PAIR_REDIRECT = `${ORIGIN}/pair/done`;
const PAIR_TTL_MS = 10 * 60_000;
const MAX_PENDING_PAIRS = 200;
const DAY_MS = 24 * 60 * 60_000;
// The board lists a schedule until this long after its last item ends.
const BOARD_KEEP_MS = 12 * 60 * 60_000;
// Watch payload limits: item count, and bytes per name (UTF-8).
const WATCH_ITEMS = 32;
const WATCH_NAME_BYTES = 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/pair' || url.pathname.startsWith('/pair/')) {
        return await pair(request, env, url);
      }
      if (url.pathname.startsWith('/api/')) {
        return await api(request, env, url);
      }
      return json(404, { error: 'not_found' });
    } catch (error) {
      console.error(error);
      return json(500, { error: 'internal' });
    }
  },
};

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

/* ---------- Watch pairing (public) ----------
 *
 * The watch cannot sign in by itself, so pairing borrows a phone:
 *
 *   1. The watch's phone-side JS registers an OAuth client with the hub and
 *      asks POST /pair/new for a pairing. This Worker makes a PKCE pair,
 *      keeps the authorize URL, and returns the verifier to the phone only.
 *   2. The watch shows https://today.lost.plus/pair/<id> as a QR code.
 *      Scanning it redirects to the hub's consent page.
 *   3. The hub sends the browser back to /pair/done with an authorization
 *      code, which waits here.
 *   4. The phone polls POST /pair/poll, takes the code, and exchanges it with
 *      the hub for a token bound to today.lost.plus with scope `today`.
 *
 * The code alone is useless: redeeming it needs the verifier, which only the
 * phone holds. This Worker never sees or checks the resulting token — the
 * gateway verifies it on /api/watch like any other credential.
 */

async function pair(request, env, url) {
  const rest = url.pathname.slice('/pair'.length);
  if (request.method === 'POST' && rest === '/new') return pairNew(request, env);
  if (request.method === 'POST' && rest === '/poll') return pairPoll(request, env);
  if (request.method === 'GET' && rest === '/done') return pairDone(request, env, url);
  const match = /^\/([a-z0-9]{10})$/.exec(rest);
  if (request.method === 'GET' && match) return pairOpen(request, env, match[1]);
  return json(404, { error: 'not_found' });
}

async function prunePairs(env) {
  await env.DB.prepare('DELETE FROM pairings WHERE created_at < ?1').bind(Date.now() - PAIR_TTL_MS).run();
}

async function pairNew(request, env) {
  const body = await request.json().catch(() => null);
  const clientId = body?.client_id;
  if (typeof clientId !== 'string' || !/^lpc_[0-9a-f]{16,128}$/.test(clientId)) {
    return json(400, { error: 'bad_client' });
  }
  await prunePairs(env);
  const pending = await env.DB.prepare('SELECT COUNT(*) AS n FROM pairings').first();
  if ((pending?.n ?? 0) >= MAX_PENDING_PAIRS) return json(429, { error: 'busy' });

  const id = randomId(10);
  const secret = randomHex(32);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const authorize = new URL('/oauth/authorize', HUB);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: PAIR_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: id,
    resource: RESOURCE,
    scope: TOKEN_SCOPE,
  }).toString();

  await env.DB.prepare('INSERT INTO pairings (id, secret_hash, authorize_url, code, created_at) VALUES (?1, ?2, ?3, NULL, ?4)')
    .bind(id, await sha256Hex(secret), authorize.toString(), Date.now())
    .run();

  return json(200, {
    id,
    secret,
    verifier,
    url: `${ORIGIN}/pair/${id}`,
    redirect_uri: PAIR_REDIRECT,
    resource: RESOURCE,
    token_endpoint: `${HUB}/oauth/token`,
    expires_in: PAIR_TTL_MS / 1000,
  });
}

async function livePair(env, id) {
  const row = await env.DB.prepare('SELECT id, secret_hash, authorize_url, code, created_at FROM pairings WHERE id = ?1')
    .bind(id)
    .first();
  if (!row || row.created_at < Date.now() - PAIR_TTL_MS) return null;
  return row;
}

async function pairOpen(request, env, id) {
  const row = await livePair(env, id);
  if (!row || row.code) return page(request, 410, 'expired');
  return new Response(null, { status: 302, headers: { location: row.authorize_url, 'cache-control': 'no-store' } });
}

async function pairDone(request, env, url) {
  const id = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  if (!/^[a-z0-9]{10}$/.test(id)) return page(request, 400, 'expired');
  if (!code) {
    // The hub sends ?error=access_denied when the person declines.
    await env.DB.prepare('DELETE FROM pairings WHERE id = ?1').bind(id).run();
    return page(request, 200, 'declined');
  }
  const result = await env.DB.prepare('UPDATE pairings SET code = ?2 WHERE id = ?1 AND code IS NULL AND created_at >= ?3')
    .bind(id, code.slice(0, 256), Date.now() - PAIR_TTL_MS)
    .run();
  return page(request, result.meta.changes === 1 ? 200 : 410, result.meta.changes === 1 ? 'paired' : 'expired');
}

async function pairPoll(request, env) {
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== 'string' || typeof body?.secret !== 'string') return json(400, { error: 'bad_request' });
  const row = await livePair(env, body.id);
  if (!row) return json(410, { error: 'expired' });
  if ((await sha256Hex(body.secret)) !== row.secret_hash) return json(403, { error: 'forbidden' });
  if (!row.code) return json(202, { pending: true });
  await env.DB.prepare('DELETE FROM pairings WHERE id = ?1').bind(row.id).run();
  return json(200, { code: row.code });
}

/* ---------- helpers ---------- */

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const PAGES = {
  paired: {
    en: ['Watch connected', 'Your schedule is on its way to your wrist. You can close this tab.'],
    ko: ['워치와 연결됐어요', '곧 손목에 시간표가 떠요. 이 탭은 닫아도 돼요.'],
  },
  declined: {
    en: ['Not connected', 'Nothing was shared. Open the app on your watch to try again.'],
    ko: ['연결하지 않았어요', '아무것도 공유되지 않았어요. 다시 하려면 워치에서 앱을 열어주세요.'],
  },
  expired: {
    en: ['This code has expired', 'Open the app on your watch to get a fresh one.'],
    ko: ['코드가 만료됐어요', '워치에서 앱을 다시 열면 새 코드가 떠요.'],
  },
};

/** A small standalone page for the pairing browser tab. */
function page(request, status, key) {
  const lang = (request.headers.get('accept-language') ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
  const [title, body] = PAGES[key][lang];
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${title} · today</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f5;--text:#1a1a1a;--muted:#555c64;--accent:#2f55e8}
@media (prefers-color-scheme:dark){:root{--bg:#151619;--text:#e8eaed;--muted:#afb5bd;--accent:#93a6ff}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);
font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo",Pretendard,sans-serif}
main{max-width:22rem;padding:24px}h1{margin:0 0 6px;font-size:20px;font-weight:650}p{margin:0;color:var(--muted)}
b{display:block;margin-bottom:18px;color:var(--accent);font-size:13px;font-weight:600}
</style></head><body><main><b>today</b><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  });
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId(length) {
  // No 0/o, 1/l/i: the id may be read off a watch screen.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(length))].map((b) => alphabet[b % alphabet.length]).join('');
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
