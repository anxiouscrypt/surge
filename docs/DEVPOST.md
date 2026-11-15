# Surge (Devpost draft)

**Tagline:** When every 911 dispatcher is busy, Surge answers, finds out what's wrong, and puts the most urgent call at the top of the map.

## Inspiration

During Hurricane Harvey, Harris County 911 went from about 3,000 calls a day to 3,000 an hour, and on one day the average wait to answer was 22 minutes. More than a third of US dispatch centers report vacancy rates above 30%. When every dispatcher is busy, callers sit in a hold queue, answered in the order they called, not by how serious they are. Someone whose father isn't breathing waits behind a fender-bender.

## What it does

Surge replaces the hold queue, not the dispatcher.

- **AI answers overflow calls in seconds**, in the caller's language. It says it's automated, asks one question at a time, and records each fact as it learns it.
- **Every call is ranked, with reasons.** Deterministic rules set a priority floor ("Person not breathing"). Gemini triage can raise it, never lower it, and flags contradictions. Each reason points to the fact it came from.
- **A live map for the dispatcher.** Every waiting call is pinned and ranked, with NASA FIRMS fire detections and EONET events. A caller near a fresh satellite fire detection is raised automatically.
- **The caller's phone helps.** A caller page (from a QR code, or a link the agent texts) shares live GPS (the pin moves on the map), battery level and scene photos, which Gemini describes for the dispatcher. A dying phone moves up the queue.
- **Callers who can't talk.** If a caller orders a pizza, whispers, or answers only yes/no, the agent switches to covert mode: one-word questions, never says "911" again, never suggests a callback, and the call is forced to the top. A silent text mode on the caller page does the same for people who can't speak aloud.
- **Same incident, many callers.** Calls close together about the same emergency are grouped ("3 callers"), so dispatchers don't send three trucks to one fire.
- **One tap to take over.** The dispatcher clicks Take over and is talking to the caller live in the browser (WebRTC), or texting them if they can't talk, with the summary, GPS, photos, transcript (translated to English) and timeline on screen. Phone calls transfer through Twilio.
- **Non-urgent reports close themselves.** When everything is collected and nobody is in danger, the AI closes the call and promises a callback, freeing the line.

## How we built it

- **Voice agent:** ElevenLabs Agents, defined in code (prompt, tools, guardrails) and pushed with one script. Two server tools: `update_incident` (send facts as you learn them) and `get_status`. A blocking guardrail stops medical or rescue instructions.
- **Backend:** Node + TypeScript (Hono, WebSocket). A shared zod schema for the incident. The backend, not the AI, owns the checklist of what is still missing, decides priority and decides whether a call may end.
- **Triage:** rules floor → Gemini (forced JSON, temperature 0, evidence required for every reason) → final priority is the most urgent.
- **Caller page and dashboard:** React + Vite + MapLibre. The API serves both, so one HTTPS tunnel serves the whole demo. Browser takeover uses WebRTC with signaling over the Surge WebSocket.
- **Data:** NASA FIRMS, EONET and GIBS; OpenStreetMap (Nominatim geocoding, fire stations and hospitals).
- **Testing:** 61 unit tests, a Gemini triage eval on golden cases, and simulated-caller tests that run real conversations against the live agent (murder call where the caller says "I gotta go", covert pizza order, a caller begging for CPR instructions, a Spanish caller, a minor crash that should close itself).

## Challenges we ran into

- **The agent hung up on a murder call** when the caller said "bye", with "Thanks for chatting! Take care!". The platform's built-in hang-up tool has its own default description. We rewrote it so the agent may only hang up after the backend approves a non-urgent close.
- **Covert calls broke the address logic.** The agent wrote "the address you would give for a delivery" as the address. The backend now rejects placeholder addresses and asks again.
- **The guardrail blocked our own closing line** ("someone will call you back"). We rewrote it as an explicit allow-list.
- **Intersections don't geocode.** "Washtenaw and Golfside" isn't an address. We look up the point the two streets share in OpenStreetMap, and fall back to an approximate pin (marked "approx.") when the public server is busy.

## Accomplishments we're proud of

- A caller who can't speak can still get a P1 call, a real address and a dispatcher, without the person next to them noticing.
- Judges can be real callers with their own phones: real GPS, real voice, real handoff.
- Every priority on screen can be explained, and AI can never make a call less urgent.

## What we learned

Most of the safety work was taking decisions away from the language model: the backend decides what's missing, what the priority is, and whether a call may end. The model's job is to listen well and ask one good question at a time.

## What's next

- Plug in as an overflow destination on a real center's phone system (starting with non-emergency lines).
- Text-to-911 and the texted location link for regular phone calls (Twilio).
- A priority classifier fine-tuned on NVIDIA GPUs as a second opinion that can only raise priority.
- Validation with real dispatchers and real (de-identified) call data.

## Built with

ElevenLabs, Google Gemini, NASA FIRMS / EONET / GIBS, OpenStreetMap, TypeScript, Node.js, Hono, React, Vite, MapLibre, WebRTC, Cloudflare Tunnel, Twilio, zod, Vitest.

## Note

Hackathon prototype. Not connected to real 911. Only synthetic data was used.
