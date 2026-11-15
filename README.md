# Surge

When every 911 dispatcher is busy, Surge answers, finds out what's wrong, and puts the most urgent call at the top of the map.

Surge replaces the hold queue, not the dispatcher. An ElevenLabs voice agent answers overflow calls, sends facts to the backend as it learns them, the backend scores priority with explainable rules (plus Gemini triage and a classifier second opinion that can only raise priority), and the dispatcher dashboard shows every waiting call ranked on a live map with NASA hazard data. One tap hands the live call to a human.

## What it does

- **Answers in seconds.** An ElevenLabs voice agent picks up when every dispatcher is busy, in the caller's language, and collects the facts with one tool call per fact.
- **Ranks every call, with reasons.** Deterministic rules set a floor; Gemini triage (and a classifier) can only raise it. Every reason points to the field it came from.
- **Caller phone page** (`/c`, opened from a QR code or a texted link): talk or text to Surge from the browser, share **live GPS** (the pin moves on the map), **battery level** and **scene photos** that Gemini describes for the dispatcher.
- **Callers who can't talk.** Covert mode (pizza-order calls, whispering) and a **silent text mode** with yes/no answers, dark screen, no sounds. Forced P1, never a callback.
- **One-tap takeover.** A dispatcher takes over a caller-page call in the browser (live audio over WebRTC, or chat for text callers). Phone calls transfer through Twilio.
- **Same-incident grouping.** Calls close together about the same emergency are linked ("3 callers"), on the map and in the panel.
- **Dispatcher context.** Live transcript with English translation, a timeline of every fact and priority change, nearest fire station and hospital, NASA fire and event data, P1 alert chime.
- **Non-urgent reports close themselves.** When everything is collected and nobody is in danger, the AI closes the call and promises a callback.

## Demo in one command

```bash
pnpm demo
```

Builds the dashboard and caller page, opens a public HTTPS tunnel, starts the API and points the voice agent at it. Open `http://localhost:8787`, click **Call from phone** for the QR code, or **Replay a surge** for six scripted calls through the real pipeline. See [MORNING.md](MORNING.md) for the demo-day checklist.

## Layout

```
apps/api         Node + TypeScript backend (Hono, WebSocket)
apps/web         Dispatcher dashboard (/) and caller phone page (/c) (Vite + React + TypeScript, MapLibre)
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
pnpm --filter @surge/api agent:test   # simulated callers against the live agent (ElevenLabs agent testing)
pnpm --filter @surge/api eval:triage  # golden cases through Gemini triage
```

Try the agent tool without a phone:

```bash
curl -s localhost:8787/tools/update_incident \
  -H 'content-type: application/json' -H 'x-surge-secret: change-me' \
  -d '{"call_id":"conv_test","incident":{"type":"medical"},"patient":{"breathing":false}}'
```

## Voice agent (ElevenLabs)

The agent is defined in code: [prompt](apps/api/agent/prompt.md), [tools and settings](apps/api/agent/config.ts).
`pnpm agent:setup` creates or updates the tools and agent (and imports the Twilio number if `TWILIO_PHONE_NUMBER` is set).

1. `npx -y @elevenlabs/cli@latest onboard init` once, to put `ELEVENLABS_API_KEY` in `.env`.
2. Expose the API: `cloudflared tunnel --url http://localhost:8787` and set `PUBLIC_BASE_URL` in `.env` (or use the Vultr URL).
3. `pnpm agent:setup` and put the printed `ELEVENLABS_AGENT_ID` in `.env`. Re-run after changing the prompt, tools or tunnel URL.

Take-over: calls from the caller page switch to live browser audio with the dispatcher (WebRTC, signaled over the Surge WebSocket). Phone calls are redirected through Twilio (captured from `system__call_sid`) to `DISPATCHER_PHONE`.

## Safety

- AI answers only when every dispatcher is busy, and says it is automated in its first sentence.
- No medical, rescue or safety instructions from the AI.
- Priority comes from deterministic rules; AI layers can only raise it, never lower it.
- Every call ends with a human. Only synthetic data was used for the classifier.
- The caller page shares location, battery and photos only with the dispatcher for that one call (each request carries a per-call ticket). Nearest stations come from a one-time area download, so no caller location goes to a third party for that.
- The caller page says plainly that this is a hackathon demo and not real 911.

## Security and reliability

- **Dispatcher data stays private.** Calls, transcripts, photos and the live feed are open on the demo laptop (localhost) but need the dashboard key through the public link; `pnpm demo` generates it and prints a private link. Without it, the public dashboard shows a locked page that points to the caller page.
- **Per-call tickets.** A caller page can only post GPS, photos and messages for its own call.
- **Origins.** Only Surge's own pages (localhost, the current public link) may call the API or open the live feed. Agent tools use a shared secret; the post-call webhook checks ElevenLabs' signature when `ELEVENLABS_WEBHOOK_SECRET` is set.
- **Limits.** 8 caller sessions per device per 10 minutes, 20 photos per call, request size limits.
- **Survives restarts and network blips.** Calls are saved to `apps/api/data/` and restored on start; `pnpm demo` opens a new public link by itself if the old one stops answering.
- **Falls back, never blocks.** Gemini down: the rules priority stands ("AI triage pending"). Geocoding fails: the caller's GPS or an approximate pin. Live audio blocked: the dispatcher calls back.

## NASA Earth data

Surge combines NASA EONET event observations, GIBS/Worldview VIIRS NOAA-20 imagery, and FIRMS thermal-anomaly detections for regional context and caller proximity. Dates, dataset sources, coverage, and limits are shown in the map controls. See [NASA data and setup](docs/NASA-DATA.md) for API contracts and the separate FIRMS key requirement.

Supported by the Michigan Space Grant Consortium, NASA grant 80NSSC20M0124.
