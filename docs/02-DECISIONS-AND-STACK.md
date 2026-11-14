# Surge: Decisions, Stack, and Prizes

Internal notes for the team. Hack The Nest, EMU, Nov 14-15, 2026.

## 1. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Positioning | Replaces the hold queue, not the dispatcher | Honest, safe, hard to argue against |
| When AI answers | Only when every dispatcher is busy | Humans stay first; AI is overflow |
| Who decides priority | AI extracts facts, **our code scores** | Explainable, testable, safe. "The AI listens, our code decides" |
| Medical instructions | Never | Safety and hackathon rule ("no medical advice") |
| Dispatcher dashboard | **Web app** (React, TypeScript) | Dispatchers work at desktop screens; a link is easy for judges to open; big map on a big monitor |
| Responder view | Phone-friendly page in the same web app | Stretch |
| Demo calls | Real phone calls to a real number | The live moment is the whole demo |
| NASA data | **Live**: FIRMS fire detections (URT under 1 min in the US), EONET active events, GIBS satellite imagery | Real data from today drives proximity alerts and incident tagging |
| NVIDIA | Fine-tuned priority model + private model on Brev | Technical depth; "data stays inside the 911 center" |

## 2. Competition and our angle

- **Aurelian** (YC, $14M Series A), **Hyper** ($6.3M seed), **Prepared**: AI for 911 centers, focused on everyday non-emergency calls (noise, parking, lost wallets).
- **Surge's difference:** emergency calls that would otherwise wait on hold, a live map with hazard data, explainable priority, duplicate grouping, and one-tap live handoff.
- One line for judges: "They handle non-emergency lines. Surge handles emergency callers stuck in the queue, and always hands them to a human."

## 3. Tech stack

| Layer | Choice |
|---|---|
| Dispatcher dashboard | Vite + React + TypeScript, Mapbox GL JS (satellite style, 3D fly-to), served from Vultr |
| Responder view (stretch) | `/responder` route, mobile layout |
| Voice agent | ElevenLabs Agents (multilingual), Twilio phone number |
| Live data from calls | ElevenLabs agent **server tools** (webhooks) the agent calls as it learns facts, plus post-call webhook |
| Backend | Node + TypeScript (Hono or Fastify), WebSocket for live updates |
| Hosting | Vultr |
| Database | MongoDB Atlas (incidents, calls, dispatchers) |
| Time series | Tiger Data (call volume, wait times, priority mix over time) |
| Summaries and grouping | Gemini API (incident summary, "same incident?" check) |
| Priority model | Rules engine (TypeScript) + fine-tuned classifier on NVIDIA Brev |
| Private model (stretch) | Open-weight model served on Brev (NIM or vLLM) for extraction |
| Geocoding | Geocoding API on backend (address to lat/long) |
| Live NASA data | FIRMS area API (CSV, free MAP_KEY), EONET v3 (GeoJSON, no key), GIBS WMTS tiles (no key) |
| Login | SSOJet (dispatcher sign-in with agency SSO) |
| Domain | GoDaddy Registry via MLH |
| Tests | Vitest (scoring rules), Python eval notebook (classifier) |

## 4. Prize entries

| Prize | How Surge uses it | Priority |
|---|---|---|
| **Future of Intelligence** (main track) | An agent that answers, gathers facts and acts; no human staff scales to every waiting caller | Core |
| **Best Use of ElevenLabs** | The voice agent is the front line; voice is the product | Core |
| **Best Use of SSOJet** | Dispatchers sign in with their agency's SSO | Medium |
| **Beyond the Horizon** | Live NASA FIRMS, EONET and GIBS data drive alerts and incident tagging | Medium-high |
| **MLH: Gemini API** | Incident summaries, duplicate grouping | Core |
| **MLH: MongoDB Atlas** | Incidents and calls | Core |
| **MLH: Tiger Data** | Live call-volume and wait-time charts | Medium |
| **MLH: Vultr** | Backend hosting | Easy |
| **MLH: GoDaddy Registry** | Project domain | Easy |
| **MLH: DEV Writing** | Post after the weekend | Easy |
| **MLH: SpaceXSI raffle** | Use Cursor + Grok bot, say so on Devpost | Easy |
| **Overall** | Every team | |

Only one main track prize can be won. Confirm with organizers that borrowing other tracks' tools is fine.

## 5. Team

**Yazan builds everything, solo.** Work in this order so a demo-able version exists early:

1. Voice agent + phone number (no code, ElevenLabs dashboard)
2. Backend: agent tool endpoint, priority rules, live updates
3. Web dashboard: map, pins, queue, take-over
4. NASA hazard layer, Gemini summaries, MongoDB
5. Priority classifier on Brev + benchmark
6. Tiger Data chart, SSOJet login, duplicate grouping, responder view

Judges may ask you to walk through any part of the code, so keep it simple enough to explain end to end.

## 6. Scope rules

- **Never cut:** AI answers, facts captured, pin on map, priority with reason, dispatcher takes over.
- **Cut order if behind:** responder app, private model, SSOJet, duplicate grouping, Tiger Data charts, NASA layer.
- **Feature freeze:** Sunday 9:00 AM. After that, fixes and rehearsal only.
