// Local stand-in for the Common Auth gateway, for development only.
//
// Proxies http://localhost:8788 to `wrangler dev` on :8787 and injects the
// x-lost-plus-* identity headers the real gateway would. Pick who you are with
// ?as=<name> (remembered in a cookie); each name gets its own subject.
//
//   npm run dev            # terminal 1
//   npm run dev:gateway    # terminal 2, then open http://localhost:8788/?as=marie

import { createServer } from 'node:http';

const UPSTREAM = process.env.UPSTREAM ?? 'http://127.0.0.1:8787';
const PORT = Number(process.env.PORT ?? 8788);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cookie = /(?:^|;\s*)dev_as=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const name = url.searchParams.get('as') ?? (cookie ? decodeURIComponent(cookie) : 'yeowool');

  const headers = { ...req.headers };
  for (const key of Object.keys(headers)) if (key.startsWith('x-lost-plus-')) delete headers[key];
  delete headers.host;
  Object.assign(headers, {
    'x-lost-plus-encoding': 'percent-utf8',
    'x-lost-plus-sub': encodeURIComponent(`dev-${name}`),
    'x-lost-plus-email': encodeURIComponent(`${name}@example.com`),
    'x-lost-plus-name': encodeURIComponent(name),
    'x-lost-plus-role': 'user',
  });

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : req;
  const upstream = await fetch(UPSTREAM + req.url, { method: req.method, headers, body, duplex: 'half', redirect: 'manual' });
  const out = Object.fromEntries(upstream.headers);
  delete out['content-encoding'];
  delete out['content-length'];
  if (url.searchParams.has('as')) out['set-cookie'] = `dev_as=${encodeURIComponent(name)}; Path=/; SameSite=Lax`;
  res.writeHead(upstream.status, out);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}).listen(PORT, () => console.log(`dev gateway on http://localhost:${PORT} -> ${UPSTREAM}`));
