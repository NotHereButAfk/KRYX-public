# Baked bot navigation

Arena bots route through server/navigation/*.json, generated from each map's production collision mesh. The directed graph represents one-metre walkable connections, stairs, ramps, separate floors and safe drops of up to four metres. A map checksum prevents loading stale routes against changed geometry.

Bots choose only reachable destinations, remember their own visits, prefer continuing forward, and avoid peers' destinations. Each bot owns its A* job and route. One room-wide search budget controls CPU work. A short local escape is used after physical blockage, then the bot replans its route. Progress is checked every 0.25 seconds; three blocked checks trigger recovery. Remaining within 2.5 metres for three seconds also triggers recovery, even if the bot is shuffling. A second failure temporarily excludes that destination. Bots brake for tight corners and do not attack one another.

Regenerate after map geometry or collision changes:

    npm run bake:bot-navigation
    npm run test:bots

Reproduce the measured match simulation and its interactive replay:

    node tools/bot_navigation_simulation.mjs final 180
    node tools/bot_simulation_check.mjs
    node tools/bot_navigation_report.mjs

The report tool compares artifacts/bot-navigation-before.json with the final run. Both files contain actual authoritative simulation trajectories; the report does not represent recorded human gameplay. Open artifacts/bot-navigation-report.html through Vite.

The regression gate checks every spawn can reach a district and samples collision edges across all four maps. The simulation gate requires all 32 bots to move at least 75% of the run, never stall for 2.5 seconds, complete at least four distinct routes, and enter at least 16 map sectors in three minutes.
