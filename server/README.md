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
