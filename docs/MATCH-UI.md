The map loading screen uses a full-screen image of the selected playable map,
with its name, server, mode, population, readiness status and a gameplay tip in
a dark left rail. Images in `public/images/maps` are renders of the existing
Daytime Rook and Winter-Graveyard assets. The portrait is rendered from the
existing EV default character. Source asset attribution remains in
`docs/EV-DEFAULT-CHARACTER.md` and the map asset documentation.

Hold Tab for the centered live scoreboard. Left/right arrows switch between
Leaderboard, Earn and Performance while pointer lock remains active. Tabs are
also clickable when the pointer is available. Refreshes preserve the selected
tab. Player names are inserted as text, never HTML. Assists and spectators use
an em dash when the game does not provide them; no stats are invented.

The bundled Rajdhani 500/600 fonts keep these screens consistent while offline.
They are distributed under the SIL Open Font License in `public/fonts/OFL.txt`.

Run `npm run test:match-ui` for a self-contained Vite/Chromium check covering both
map images, table data, name escaping, portraits, tabs and mobile fit. Set
`MATCH_UI_SHOTS` to an output directory to save desktop and mobile screenshots.
