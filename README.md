# KRYX public source snapshot

Public source snapshot of the KRYX browser game. Play at https://kryx.live/.

Development and production deployment are maintained in a separate private repository. This copy has a new history and excludes production credentials, private configuration, internal deployment workflow, and operator documents. Updates to the private repository do not automatically publish here.

## Local build

Requires Node.js and npm.

```sh
npm ci
npm run dev
npm run build
```

Optional server services require your own configuration. See `server/README.md` and the blank example configuration files. No production bot, wallet, database, or deployment credentials are provided.

Public visibility is not a license grant for third-party assets. Existing asset notices and provenance remain applicable.
