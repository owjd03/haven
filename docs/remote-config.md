# Remote Config notes

Haven reads two optional parameters from Firebase Remote Config. Both have safe local defaults, so the app works with no template published, offline, or if the fetch fails.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `cloud_enabled` | boolean | `true` | When `false`, every cloud feature (cloud chat fallback, Insights, message drafter) refuses to run and Haven stays fully on-device. |
| `hotlines_json` | JSON string | empty (uses bundled `web/backend/data/hotlines.json`) | Replaces the crisis-screen hotline list without redeploying. Must match the shape of `hotlines.json`; invalid JSON is ignored. |

## Publishing
In Firebase console > Remote Config, add the parameters above and publish. (Or use `npx -y firebase-tools@latest remoteconfig:get` / `deploy --only remoteconfig`; review the template before deploying.)

## Behavior
- Fetched once on app start (`web/frontend/lib/remoteConfig.ts`), with a 4 second timeout. In development the minimum fetch interval is 0; otherwise one hour.
- The crisis screen waits at most 1.5 seconds for remote hotlines, then uses the bundled list.
- Remote Config values contain no data about the user.
