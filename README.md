# KRYX public source

Public source copy of the KRYX browser game. Play the hosted game at https://kryx.live/.

## Play locally

Install Node.js 22.12 or newer (including npm), then run:

```sh
git clone https://github.com/NotHereButAfk/KRYX-public.git
cd KRYX-public
npm ci
npm ci --prefix server
npm start
```

Open the local URL printed in the terminal (normally http://127.0.0.1:5173), then click to play. Keep the terminal open. Press Ctrl+C to stop.

`npm start` (or `npm run dev`) starts both the frontend and a local authoritative multiplayer server with bots. Deathmatch and survival are available. No database, environment file, Discord token or wallet credentials are needed. This is guest play: production accounts, saved progression, purchases, tournament services and payouts are not connected. Multiple browser tabs can join the local server. The server listens only on your computer.

If port 5173 is already used, Vite prints a different port; use that printed URL. The game server selects a free port automatically. If dependencies are missing, run both `npm ci` commands again.

## Development

`npm run build` builds the frontend into `dist`. `npm run dev:client` starts only Vite and does not start the local game server. Optional account services require your own configuration; see `server/README.md` and the blank examples. Never commit credentials.

Development and production deployment are maintained in a separate private repository. This copy has a new history and excludes production credentials, private configuration, internal deployment workflows and operator documents. Updates to the private repository do not automatically publish here.

Public visibility is not a license grant for third-party assets. Existing asset notices and provenance remain applicable.
