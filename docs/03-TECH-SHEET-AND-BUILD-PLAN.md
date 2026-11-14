# Surge: Tech Sheet and Build Plan

Solo build. Lock sections 4 and 5 (data model and API) first, then build in the order of section 11.

---

## 1. System overview

```
Caller dials Surge number (Twilio)
   -> ElevenLabs voice agent answers (when dispatchers busy)
        - asks: address, what happened, people, injuries, danger, callback
        - calls our server tool `update_incident` each time it learns a fact
        - can transfer the live call to a dispatcher phone
   -> Backend (Node, Vultr)
        - geocode address -> lat/long
        - priority engine (rules + classifier) -> priority + reasons
        - live NASA check: nearest FIRMS fire detection, inside an open EONET event?
        - Gemini: short summary, "same incident?" grouping
        - store in MongoDB, metrics in Tiger Data
        - push events over WebSocket
   -> Web dashboard (React, in the browser)
        - live map: hazard layer + call pins by priority
        - ranked queue with reasons and wait time
        - tap -> take over call (transfer) with summary on screen
```

### Dispatcher availability ("all busy")
- **MVP (build this):** the Surge number goes straight to the AI agent. The dashboard has a dispatcher status panel; in the demo, all dispatchers show "On call." State this honestly as simulated routing.
- **Stretch:** a Twilio front door (TwiML webhook) checks dispatcher availability in our backend: free dispatcher -> ring them; all busy -> connect to the ElevenLabs agent.

---

## 2. Repo structure

```
surge/
├── apps/
│   ├── web/                     # Vite + React + TypeScript dashboard
│   │   ├── src/
│   │   │   ├── pages/Dashboard.tsx   # Map + queue (main screen)
│   │   │   ├── pages/Login.tsx       # SSOJet (stretch)
│   │   │   ├── pages/Responder.tsx   # Mobile responder view (stretch)
│   │   │   ├── components/           # Map, HazardLayer, QueueCard, IncidentPanel, PriorityBadge, StatusBar
│   │   │   ├── lib/socket.ts         # WebSocket client
│   │   │   └── lib/mock.ts           # Mock incidents until backend is live
│   └── api/                     # Node backend
│       ├── src/
│       │   ├── index.ts         # HTTP + WebSocket server
│       │   ├── routes/          # tools, webhooks, incidents, dispatchers
│       │   ├── priority/        # rules.ts, classifier.ts (calls Brev endpoint)
│       │   ├── hazards/firms.ts # NASA FIRMS fetch + cache + distance
│       │   ├── geo/geocode.ts
│       │   ├── ai/gemini.ts     # summaries, grouping
│       │   └── db/              # mongo.ts, tiger.ts
│       └── test/priority.test.ts
├── ml/                          # priority classifier
│   ├── synth/                   # synthetic transcript generation + labels
│   ├── train.ipynb              # fine-tune on Brev
│   ├── eval.ipynb               # benchmark
│   └── serve/                   # model server (FastAPI) on Brev
└── packages/shared/types.ts
```

---

## 3. Accounts and keys (hour 0)

| Service | Needed |
|---|---|
| ElevenLabs | Creator plan (free month via packet code), API key, agent ID |
| Twilio | Account, one US number imported into ElevenLabs; verify demo phones if on trial |
| Gemini | API key (AI Studio) |
| MongoDB Atlas | Free cluster, URI |
| Tiger Data | Free tier instance |
| NASA FIRMS | Free MAP_KEY (https://firms.modaps.eosdis.nasa.gov/api/map_key/) |
| NASA EONET, GIBS | No key needed |
| NVIDIA Brev | Post in #operation-qa-participants, tag @Matt Cool (now) |
| Geocoding | API key (or free service with rate limit) |
| Vultr | Small instance, HTTPS; serves backend and built dashboard |
| GoDaddy Registry | Domain via MLH claim code |
| SSOJet | Free plan (stretch) |
| Mapbox | Free account, public access token for the map |

Never commit keys to GitHub (hackathon rule).

---

## 4. Data model (MongoDB)

```ts
type Priority = 1 | 2 | 3 | 4;   // 1 = immediate life threat

type Incident = {
  _id: string;
  status: "ai_on_call" | "waiting" | "taken" | "dispatched" | "closed";
  priority: Priority;
  score: number;                  // for ordering within a priority
  reasons: string[];              // ["Person not breathing", "Waiting 2 min"]
  address: string | null;
  location: { lat: number; lng: number } | null;
  locationConfidence: "high" | "low" | "none";
  category: "medical" | "fire" | "crash" | "violence" | "flood" | "hazard" | "other";
  facts: {
    peopleCount: number | null;
    injuries: string | null;
    notBreathingOrUnconscious: boolean | null;
    fireOrSmokeInside: boolean | null;
    weaponOrViolence: boolean | null;
    trapped: boolean | null;
    vulnerablePerson: boolean | null;   // child, elderly, disabled
    callbackNumber: string | null;
    language: string | null;
  };
  hazard: { nearestFireKm: number | null; detectedAt: string | null } | null;
  summary: string | null;          // Gemini, 1-2 sentences
  groupId: string | null;          // duplicate grouping
  callIds: string[];
  createdAt: Date;
  firstAnsweredAt: Date;           // when AI picked up
  takenBy: string | null;          // dispatcher id
  takenAt: Date | null;
};

type Call = {
  _id: string;
  incidentId: string;
  conversationId: string;          // ElevenLabs
  fromNumber: string;
  transcript: { role: "agent" | "caller"; text: string; at: Date }[];
  startedAt: Date;
  endedAt: Date | null;
  transferredTo: string | null;
};

type Dispatcher = {
  _id: string;
  name: string;
  phone: string;                   // transfer target
  status: "available" | "on_call" | "offline";
};
```

Tiger Data hypertable `call_metrics(time, active_ai_calls, waiting, avg_wait_s, p1_count, p2_count, p3_count, p4_count)`, written every 10 s.

---

## 5. API and events

### Called by the ElevenLabs agent (server tools)
| Tool | When the agent calls it | Body |
|---|---|---|
| `update_incident` | Every time it learns a new fact | `{ conversation_id, address?, category?, people_count?, injuries?, not_breathing?, fire_inside?, weapon?, trapped?, vulnerable?, callback_number?, language? }` |
| `get_status` | Caller asks "Is help coming?" | `{ conversation_id }` -> short status text |

Agent tool responses stay short ("Got it") so the conversation flows.

### Webhooks
| Route | From |
|---|---|
| `POST /webhooks/elevenlabs/post-call` | ElevenLabs post-call transcript and summary (verify signature) |

### Dashboard API
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/incidents?status=open` | Initial load |
| `POST` | `/incidents/:id/take` | Dispatcher takes over (triggers transfer) |
| `POST` | `/incidents/:id/status` | Dispatched / closed |
| `GET` | `/hazards/fires?bbox=` | Cached FIRMS points |
| `GET` | `/dispatchers` / `POST /dispatchers/:id/status` | Availability panel |
| `GET` | `/metrics?window=1h` | Tiger Data chart |

### WebSocket events (server -> app)
`incident.created`, `incident.updated`, `incident.priority_changed`, `incident.grouped`, `call.transcript`, `call.ended`, `dispatcher.updated`

---

## 6. Voice agent spec (ElevenLabs)

**First message:**
"911. All dispatchers are helping other callers. I'm an automated assistant and I'll get you to a dispatcher as fast as possible. What is the address of your emergency?"

**Order of questions:**
1. Address (repeat it back to confirm; ask for cross streets or a landmark if unclear)
2. "Tell me what's happening."
3. "Is anyone hurt? Is anyone not breathing or unconscious?"
4. "Is there fire, smoke, a weapon, or anyone trapped?"
5. "How many people are with you?"
6. "What number can we call you back on?"

**Rules in the prompt:**
- Disclose it is automated in the first sentence.
- Call `update_incident` after every new fact.
- Never give medical or safety instructions beyond "stay on the line, a dispatcher will be with you shortly." (Hackathon rule: no medical advice.)
- If the caller reports someone not breathing, a weapon, fire inside, or someone trapped: say "I'm marking this as the highest priority right now," call `update_incident`, and stay on the line.
- Detect and answer in the caller's language.
- If the caller asks for a human, say a dispatcher has been alerted and will take the call as soon as one is free.

**Transfer:** configure the agent's transfer-to-number tool. When the dashboard sends "take over," the backend tells the agent to transfer the live call to that dispatcher's phone. **Verify in hour 1 that this works.** Fallback: the dispatcher calls the callback number from the dashboard.

---

## 7. Priority engine

### Rules (deterministic, always on)
| Priority | Triggers |
|---|---|
| **1 Immediate** | Not breathing or unconscious, fire or smoke inside with people, weapon or violence in progress, someone trapped (water, vehicle, building) |
| **2 Urgent** | Injury but conscious, fire with no one inside, crash with injuries, downed power lines, caller within 1 km of an active fire detection |
| **3 Standard** | Crash without injuries, property damage, hazard without people at risk |
| **4 Low** | Information only, non-emergency |

**Modifiers (score within a priority):** +vulnerable person, +people count, +hazard proximity, +1 point per minute waiting (prevents anyone being stuck forever).

Every rule that fires adds a human-readable reason shown on the card.

### Classifier (NVIDIA Brev)
1. **Synthetic dataset:** 1,000-2,000 short call transcripts generated with an LLM across categories, languages and severities, labeled P1-P4. Include tricky cases (calm caller with a severe emergency; panicked caller with a minor one). Synthetic only.
2. **Fine-tune** a small text classifier (e.g. a compact transformer) on Brev.
3. **Benchmark** on a held-out set: rules only vs. rules + classifier. Report overall accuracy and **recall on P1** (missing a P1 is the worst error).
4. **Serve** behind a small FastAPI endpoint. Backend uses it as a second opinion: if the classifier says P1 and the rules don't, raise to P1 and add reason "Model flagged as possible life threat." Never lower a rule-based P1.

### Private model (stretch)
Serve an open-weight model on Brev and point extraction or summaries at it. Pitch: "In production the triage brain runs inside the 911 center. No caller data leaves the building."

---

## 8. Live NASA data

Three live NASA feeds, each shown with a freshness label ("detected 4 min ago", "imagery from 2 h ago"). Never claim more than the data says.

| Layer | Source | How fresh | Use in Surge |
|---|---|---|---|
| **Active fire detections** | NASA FIRMS (US/Canada), area API | NRT within ~3 h globally; **RT ~20-30 min and URT under 1 min** after a satellite pass in the US | Orange dots on the map, color by time since detection. Caller within 1 km of a detection -> raise to P2 + warning |
| **Active natural events** | NASA EONET v3 (`/api/v3/events?status=open&bbox=...`), GeoJSON, no key | Curated near real time | Event outlines/markers (wildfires, severe storms, floods, volcanoes). Incidents inside an open event get tagged with it ("Part of: Tower Wildfire") |
| **Satellite imagery** | NASA GIBS WMTS tiles (e.g. VIIRS / MODIS true color, VIIRS day/night band) | NRT within ~3.5 h | Toggle layer under the pins: today's actual satellite view of the area |

### Details
- **FIRMS:** `/api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]`. Poll every 5 minutes. Check the FIRMS API source list for the US/Canada RT/URT sources; NRT sources (e.g. `VIIRS_NOAA20_NRT`, `VIIRS_SNPP_NRT`) are the fallback. URT detections only appear right after a satellite passes overhead, and roll off after ~6 hours as NRT replaces them.
- **EONET:** `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&bbox=<west,north,east,south>` (upper-left, lower-right). Poll every 10 minutes. Categories: `wildfires`, `severeStorms`, `floods`, `volcanoes`.
- **GIBS:** WMTS tiles from `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/` as a raster source in Mapbox. Today's tiles may be partly empty (satellites still passing), so default to the most recent complete day and label the date.
- **Proximity:** haversine distance from each incident to the nearest fire detection and whether it falls inside an open EONET event.

### Demo region: stay live and real
Michigan in November may have no active fires. The dashboard gets a region switcher:
- **Home: Washtenaw County.** Live feeds for the actual area (likely quiet).
- **Live event view:** jumps to any currently open EONET wildfire or severe storm in the US, with that day's FIRMS detections and GIBS imagery. On demo day, pick whichever event is active, and have judge callers give addresses inside it.

Pitch line: "Everything on this map is live NASA data from today, not a recording."

---

## 9. Web dashboard

**Main screen (desktop browser, full screen, 1080p or larger):**
- **Left 2/3: map.** Mapbox satellite-streets style. Fire detections as orange dots, incident pins colored by priority (red P1, orange P2, yellow P3, gray P4), pulsing while the AI is on the call, grouped pins show a count. A new P1 triggers a smooth fly-to (3D tilt) on its street.
- **Right 1/3: queue.** Cards sorted by priority then score: priority badge, summary, address, live wait timer, reason chips, "AI on call" indicator. A new P1 slides to the top with a sound.
- **Top bar:** dispatcher status (Available / On call), active AI calls, longest wait, Tiger Data sparkline of calls per minute.

**Incident panel (click a card or pin):** slides in over the queue. Summary, facts, reasons, hazard distance, live transcript, **Take over call** (primary), Mark dispatched, Close.

**Design:** dark command-center theme, large type, high contrast, keyboard shortcuts (J/K to move through the queue, Enter to open, T to take over). Every color also has a text label.

**Responder view (stretch):** `/responder` route, mobile layout: assigned incident, address, map, Mark arrived / Mark safe.

---

## 10. Testing

- `priority.test.ts`: each P1 trigger yields P1; waiting time raises score; classifier can raise but never lower P1; reasons always present.
- Classifier eval: confusion matrix and P1 recall slide.
- Load test: 3 simultaneous calls to the real number.
- Transfer test: take over a live call.
- Language test: Spanish and Arabic callers.

---

## 11. Build plan (solo, Sat 12:00 PM to Sun 12:00 PM)

| Time | Build | Checkpoint |
|---|---|---|
| **12:00-1:00** | Brev credits request. **Concurrency + transfer test:** ElevenLabs agent, Twilio number, 3 phones at once, transfer to a phone. FIRMS key | **Go/no-go on calls** |
| **1:00-3:00** | Backend: `update_incident` tool, priority rules + tests, in-memory store, WebSocket. Connect the agent tool | A real call updates an incident |
| **3:00-5:00** | Web dashboard: map with pins, queue, live updates over WebSocket | **First real call appears on the map** |
| **5:00-7:00** | Geocoding, incident panel, take-over flow, post-call transcript | Take-over works end to end |
| **7:00-9:00** | Deploy backend + dashboard to Vultr, domain, MongoDB, Gemini summaries | Live URL works from a phone |
| **9:00-11:00** | Live NASA: FIRMS + EONET layers, proximity alerts, region switcher; GIBS imagery toggle. Start synthetic dataset generation (runs in background) | Live NASA data on the map |
| **11:00-12:00** | Devpost draft | **Draft due midnight** |
| **12:00-3:00 AM** | Fine-tune priority classifier on Brev, benchmark, wire as second opinion | P1 recall number |
| **3:00-6:00 AM** | **Sleep** (set alarms) | |
| **6:00-9:00 AM** | Tiger Data chart, duplicate grouping, polish (fly-to, sounds, P1 animation). SSOJet if time | **Feature freeze 9:00 AM** |
| **9:00-11:00 AM** | Record backup demo video (3 min max). Rehearse demo and safety answers 3 times | Video uploaded |
| **11:00-12:00 PM** | Final Devpost: every track, AI tools listed, public repo, video | **Final submission 12:00 PM** |
| **1:00-1:15 PM** | Table: laptop (or external monitor) with dashboard full screen, 3 phones charged, number printed on a card | **Judging 1:15 PM** |

Solo cut order if behind: responder view, SSOJet, duplicate grouping, Tiger Data chart, GIBS imagery layer, classifier (keep rules only). Keep FIRMS + EONET live. Never cut: AI answers, facts captured, pin on map, priority with reason, take-over.

Optional sessions: MLH Gemini workshop 3:00 PM (Room 320), Devpost draft workshop 9:00 PM, demo video workshop Sunday 10:00 AM.

---

## 12. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Only 1-2 simultaneous calls (Twilio limits on new accounts) | Try ElevenLabs-provided number or web widget calls; demo with 2 live + backup video |
| Transfer doesn't work | Dispatcher calls back the caller from the dashboard |
| Geocoding misses | Agent asks for cross streets; dispatcher can drag the pin |
| Classifier not ready | Rules-only priority (still explainable); show benchmark from notebook |
| Brev credits not granted | Train a small model on the laptop or skip; rules engine is enough |
| No active fires in Michigan | Live event view: jump to a currently open EONET wildfire or storm |
| Venue Wi-Fi | Backend and dashboard on Vultr; laptop on phone hotspot |

---

## 13. Devpost checklist

- Name, one-line description, problem it solves
- Public GitHub repo, every teammate added
- Demo video 3 minutes or less
- Main track: Future of Intelligence
- Partner tracks: ElevenLabs, SSOJet (if built), Beyond the Horizon
- MLH: Gemini, MongoDB Atlas, Tiger Data, Vultr, GoDaddy Registry, DEV, SpaceXSI raffle (if Cursor + Grok used)
- AI tools used (required)
- Safety section: overflow only, human handoff, no medical advice, synthetic data only
