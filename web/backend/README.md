# @haven/backend: knowledge layer

Coping cards and keyword retrieval (RAG) for Haven.

- Pure TypeScript package, **no server and no network**. It runs in the user's browser, imported by `web/frontend`.
- This is deliberate: retrieval takes the user's chat message, so it must never leave the device.
- Data lives in `data/` (coping cards JSON, added in Phase 3). Code lives in `src/`.
- Knows nothing about React, Next.js, or Firebase.
