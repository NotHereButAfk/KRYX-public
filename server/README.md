# kryx.live server

The production entry point is the authoritative WebSocket server. It also
serves the compiled Vite frontend from `../dist`, allowing Nginx to proxy the
entire `kryx.live` origin to one Node process.

Movement, combat, ammo, damage, respawns, and abilities are server-owned.
Clients retain prediction and interpolation for responsive presentation.

## Deployment model

The compiled site and server remain separate directories, but one Node process
serves both. This requires an always-on host such as a VPS; shared static
hosting cannot run the authoritative simulation.

- A VPS (including a Hostinger VPS, if you have one — plain shared hosting
  does not support this)
- Render.com — "Web Service" (the **paid** tier; the free tier sleeps after
  15 minutes of inactivity, which defeats "24/7")
- Railway.app
- Fly.io
- Any small always-on Linux box you already have

## Deploy

1. `cd server && npm install`
2. Build the frontend in the repository root with `npm run build`.
3. `npm start` (reads `PORT` from the environment, defaults to 8788)
4. Point your host's process at `server/` as the working directory with
   `npm start` as the run command.
5. Set `ALLOWED_ORIGINS` to the exact public HTTPS origin.
6. Once deployed, the same origin serves HTTP and WebSocket traffic.

Set `ALLOWED_ORIGINS` to the exact comma-separated browser origins allowed to
connect, for example:

```
ALLOWED_ORIGINS=https://kryx.live PORT=8788 npm start
```

When `ALLOWED_ORIGINS` is absent, `authserver.mjs` accepts loopback browser
origins only. An explicit `*` is available for isolated development but must
not be used on a public server.

## Wire the client to it

In the repo root, set `VITE_AUTH_WS_URL` to the server's `wss://` URL (see
`.env.example`). The VPS GitHub Action passes the matching repository secret
through to Vite. Leaving it unset keeps the local/offline behavior.

## Local testing

```
cd server
npm install
npm start
```

Then in the repo root, create `.env.local` with:

```
VITE_AUTH_WS_URL=ws://localhost:8788
```

and run the usual dev server (`npx vite --port 5999 --host`). Open two
browser tabs — both should show the same countdown and each other's kills.

## Account request limits and proxies

Account endpoints allow 12 authentication attempts per client address per minute.
Password login also allows 12 attempts per account per ten minutes, shared across
username/email aliases and source addresses. Limit storage is bounded and expires
automatically. These limits currently apply per server process.

`ACCOUNT_TRUSTED_PROXIES` is a comma-separated list of immediate/intermediate
proxy IP addresses. It defaults to `loopback` for nginx on the same host. An empty
value trusts no proxy. For a container or another proxy host, list its exact IP;
do not list arbitrary client networks. Forwarded addresses from untrusted peers
are ignored. Trusted chains are read from right to left until the first untrusted
address, preventing client-supplied prefixes from bypassing limits. The proxy must
append the real client address or replace the header with it. This setting is
separate from `E_TRUST_PROXY`, which controls economy network grouping.

Password recovery uses single-use six-digit codes with five verification attempts
and a ten-minute expiry/cooldown. A successful reset revokes sessions and prevents
an old-password login already in flight from creating a new session afterward.

## Backend authorization checks

Run `npm run test:security` from the repository root after installing root and
server dependencies. The suite uses disposable account data and local sockets to
check session ownership, reward eligibility, duplicate claims, administrator
authorization, forged commands, connection limits and password recovery.
The normal private deployment runs these checks before publishing; public pull
requests and main pushes run the same suite without deployment credentials.
Passing these checks covers the tested cases, not every possible vulnerability.
