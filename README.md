# Surge

When every 911 dispatcher is busy, Surge answers, finds out what's wrong, and puts the most urgent call at the top of the map.

Surge replaces the hold queue, not the dispatcher. An ElevenLabs voice agent answers overflow calls, sends facts to the backend as it learns them, the backend scores priority with explainable rules (plus Gemini triage and a classifier second opinion that can only raise priority), and the dispatcher dashboard shows every waiting call ranked on a live map with NASA hazard data. One tap hands the live call to a human.

## Layout

```
apps/api         Node + TypeScript backend (Hono, WebSocket)
apps/web         Dispatcher dashboard (Vite + React + TypeScript, Mapbox GL)
packages/shared  Incident schema v1 (zod) + event types, shared by api and web
ml/              Priority classifier (synthetic data, training, serving on NVIDIA Brev)
docs/            Planning docs (05 is the source of truth for the call pipeline)
```

## Run locally

```bash
pnpm install
cp .env.example .env   # fill in keys
pnpm dev               # api on :8787, web on :5173
pnpm test
```

Try the agent tool without a phone:

```bash
curl -s localhost:8787/tools/update_incident \
  -H 'content-type: application/json' -H 'x-surge-secret: change-me' \
  -d '{"call_id":"conv_test","incident":{"type":"medical"},"patient":{"breathing":false}}'
```

## Safety

- AI answers only when every dispatcher is busy, and says it is automated in its first sentence.
- No medical, rescue or safety instructions from the AI.
- Priority comes from deterministic rules; AI layers can only raise it, never lower it.
- Every call ends with a human. Only synthetic data was used for the classifier.
