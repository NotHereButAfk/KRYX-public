# Evasion and Depot imports

Downloaded 2026-10-04 at the owner's request. The binaries are unchanged imports, not original KYX map designs.

- Evasion: https://ev.io/node/131 — https://ev.io/sites/default/files/maps/HUT8Evasion_0.evmap
- Depot: https://ev.io/node/634 — https://ev.io/sites/default/files/maps/Depot_2.evmap
- Loading images: https://ev.io/sites/default/files/map_large_image/evasion-min.jpg and https://ev.io/sites/default/files/map_large_image/depot-min.jpg

Evasion's older spawn records contain four floats (including yaw) without a flags byte. Depot contains team-only spawns; when no free-for-all spawns exist the shared loader uses its authored team pads. Client and server read the same assets.

The baked navigation system permits bots to descend up to four metres onto verified ground, allowing them to leave raised spawn platforms. Unsupported edges remain forbidden. See BOT-NAVIGATION.md for regeneration and simulation checks.

## Five additional maps, October 8, 2026

Downloaded from the official public map pages at the owner's request. These
remain ev.io imports, not original KYX artwork. Binary geometry is unchanged.

| Map | Source page | Shipped binary | Loading image filename |
|---|---|---|---|
| Gypsum | https://ev.io/node/232 | HUT8Gypsum_2.evmap | GypsumJPEG.jpg |
| Checkpoint | https://ev.io/node/132 | HUT8Checkpoint_0.evmap | Checkpoint%202-min.jpg |
| Fractal | https://ev.io/node/449 | FractalPawnv3_1.evmap | Fractal%201-min.jpg |
| Ancient | https://ev.io/node/519 | Ancient23.evmap | AncientJPEG23.jpg |
| Little Town 2065 | https://ev.io/node/223 | _map_little_town_4.evmap | Littletown-min.jpg |

Binary downloads use `https://ev.io/sites/default/files/maps/`; loading images
use `https://ev.io/sites/default/files/map_large_image/`. Each has its own
registry entry, loading picture, server collision and baked bot navigation.
Fractal's active spawn index 25 is excluded in both client and server: it sits
on an isolated ledge with only two reachable patrol destinations. The remaining
28 pads are retained. The other four maps keep their authored enabled pads.

Server collision maps load on demand through a three-arena cache (two live modes plus a transition). This avoids retaining all nine collision octrees. Active simulation callbacks remain valid after cache eviction.
