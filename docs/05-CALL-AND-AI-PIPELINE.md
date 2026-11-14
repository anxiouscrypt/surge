# Surge: Call and AI Pipeline

How a 911 overflow call becomes a triaged pin on the dashboard. This doc replaces the short versions in 03 sections 5-7.

---

## 1. The pipeline at a glance

```
Caller
  -> Twilio number -> ElevenLabs voice agent (talks, asks questions)
       |  every new fact: tool call update_incident { partial JSON }
       v
  Backend (Node)
    1. Validate against the schema (reject junk, keep unknowns as null)
    2. Merge into the incident (only non-null fields overwrite)
    3. Geocode the address (Nominatim, biased to the dispatch area)
    4. Add live NASA context (near a FIRMS fire? inside an EONET event?)
    5. Rules floor: instant P1-P4 from hard facts (milliseconds)
    6. LLM triage (Gemini, structured output): priority, reasons, units, summary
    7. Classifier second opinion (Brev): can only raise
    8. Final priority = the most urgent of 5, 6, 7
    9. Reply to the agent: what is still missing -> next question
       |
       v  WebSocket incident.upsert
  Dashboard: pin on the map, card with priority + reasons, sorted queue
       |
       v  dispatcher clicks "Take over" -> live call transferred
```

Two design choices carry the whole thing:
- **Extract live, not after the call.** The pin shows up while the caller is still talking. The post-call webhook only cleans up.
- **The backend owns the checklist.** The agent does not decide what is "enough." Every `update_incident` reply tells the agent which essential fields are still missing, so the conversation stays on track and the output is predictable.

---

## 2. What the AI must collect (essential fields)

Ordered the way real dispatch protocols do it: **location first** (if the call drops, you can still send someone), then callback, then what happened.

| # | Field | Why it matters | Essential? |
|---|---|---|---|
| 1 | Location (address, or cross streets, or landmark) | Without it nobody can be sent | Yes |
| 2 | Callback number | Call drops are common in disasters | Yes (Twilio caller ID pre-fills it; agent confirms) |
| 3 | What is happening (type) | Decides fire / EMS / police | Yes |
| 4 | Anyone not breathing or unconscious? | Top P1 trigger | Yes if anyone is hurt |
| 5 | Fire, smoke, weapon, someone trapped? | Other P1 triggers | Yes |
| 6 | Number of people involved / hurt | Resource sizing | Yes |
| 7 | Is the caller safe right now? | Changes what the dispatcher does first | Yes |
| 8 | Vulnerable people (child, elderly, disabled, pregnant) | Raises score | Ask if relevant |
| 9 | Caller language | Dispatcher knows if they need an interpreter | Auto-detected |

The call is "triage complete" when 1, 3, 4/5 and 7 are known. The agent then keeps the caller on the line and fills the rest.

---

## 3. The structured JSON (incident schema v1)

`null` means "not known yet." **Unknown is never the same as no.** The rules treat an unknown critical field as a reason to ask, and for some combinations as a reason to escalate (see section 5).

```json
{
  "schema_version": 1,
  "call_id": "conv_abc123",
  "received_at": "2026-11-14T21:04:12Z",
  "caller": {
    "phone": "+17345550142",
    "callback_confirmed": true,
    "language": "es",
    "relation": "bystander",
    "caller_safe": true
  },
  "location": {
    "spoken": "the corner of Cross and Huron, by the gas station",
    "address": "Cross St & N Huron St, Ypsilanti, MI",
    "unit_or_floor": null,
    "landmark": "gas station",
    "lat": 42.2465,
    "lng": -83.6188,
    "geocode_confidence": "high",
    "read_back_confirmed": true
  },
  "incident": {
    "type": "fire",
    "subtype": "structure_fire",
    "description": "Smoke coming out of second floor windows of a house",
    "started": "just now"
  },
  "people": {
    "involved": 3,
    "injured": 1,
    "trapped": true,
    "vulnerable": ["child"]
  },
  "patient": {
    "conscious": null,
    "breathing": null,
    "severe_bleeding": null
  },
  "hazards": {
    "fire_or_smoke": true,
    "weapon": false,
    "violence_ongoing": false,
    "gas_leak": null,
    "downed_power_lines": null,
    "flood_water": false
  },
  "call_state": {
    "stage": "collecting",
    "missing": ["patient.conscious", "patient.breathing"],
    "caller_requested_human": false
  }
}
```

**Backend-only fields** (the agent never writes these): `location.lat/lng/geocode_confidence`, `nasa_context`, `triage`, `final_priority`, `timeline`.

```json
"nasa_context": {
  "nearest_fire_km": 0.8,
  "fire_detected_minutes_ago": 14,
  "inside_event": { "id": "EONET_20387", "title": "Tower Wildfire" }
},
"triage": {
  "rules":      { "priority": 1, "reasons": ["Someone trapped", "Fire or smoke with people inside"] },
  "llm":        { "priority": 1, "reasons": ["..."], "units": ["fire", "ems"], "summary": "...", "confidence": 0.86 },
  "classifier": { "priority": 1, "p1_probability": 0.93 }
},
"final_priority": 1,
"final_reasons": ["Someone trapped", "Fire or smoke with people inside", "0.8 km from a NASA fire detection 14 min ago"]
```

**Allowed values** (enums, so the dashboard and rules never see free text where they need a category):
- `incident.type`: `fire`, `medical`, `crime`, `traffic`, `hazard`, `water_rescue`, `other`
- `caller.relation`: `self`, `family`, `bystander`, `unknown`
- `geocode_confidence`: `high`, `medium`, `low`, `none`
- `call_state.stage`: `collecting`, `triage_complete`, `waiting_for_dispatcher`, `transferred`, `ended`

Validation: one schema file (zod) shared by the backend and the dashboard types. Anything that fails validation is logged and ignored, never shown.

---

## 4. The voice agent (ElevenLabs)

### Tools the agent has

| Tool | Type | When | Backend reply |
|---|---|---|---|
| `update_incident` | Server webhook | After every new fact. Sends only the fields it learned (partial JSON in the schema above) | `{ "ok": true, "missing": [...], "say": "optional short line", "escalate": false }` |
| `get_status` | Server webhook | Caller asks "is help coming?" | One honest sentence: "A dispatcher can see your location and your call is marked highest priority." Never an ETA |
| `transfer_to_number` | ElevenLabs system tool | Backend signals take-over | Live call moves to the dispatcher |

The agent's `end_call` tool is **off**. The AI never hangs up on a 911 caller; only the caller or a dispatcher ends the call.

### How the reply drives the conversation

```
Caller: "There's smoke coming out of my neighbor's house!"
Agent -> update_incident { incident: { type: "fire", description: "smoke from neighbor's house" }, hazards: { fire_or_smoke: true } }
Backend <- { missing: ["location", "people.trapped"], say: null }
Agent: "What's the address of the house?"
```

The backend computes `missing` from the essential-fields table, in priority order. The agent asks for the first missing item. This keeps the agent's prompt small and the behavior testable.

### System prompt (core rules)
1. First sentence discloses it is automated: "911. All dispatchers are helping other callers. I'm an automated assistant and a dispatcher can see this call. What's the address of your emergency?"
2. One short question at a time. Plain words. No small talk.
3. Read the address back and wait for a yes before marking it confirmed.
4. Call `update_incident` after every new fact, then ask the first item in `missing`.
5. Never give medical, rescue or safety instructions. Only: "Stay on the line. If you're in danger, move somewhere safe." (Hackathon rule: no medical advice. In production, certified pre-arrival instructions would come from the human dispatcher.)
6. Never promise a time. Never say "don't worry."
7. If the reply has `escalate: true`, say: "I'm marking this as the highest priority right now. Stay on the line." and keep collecting.
8. Answer in the caller's language. Send `caller.language` on the first update.
9. If the caller can't talk freely (whispering, says "I can't talk"), switch to yes/no questions.
10. If the caller asks for a person: "A dispatcher has been alerted and will take your call as soon as one is free."

### Question flow by type (after location and "what's happening")
| Type | Follow-ups |
|---|---|
| Medical | Awake? Breathing normally? Bleeding a lot? Age roughly? |
| Fire | Anyone inside or trapped? Which floor? Is the fire spreading? |
| Crime / violence | Is it happening now? Any weapons? Are you somewhere safe? Where is the suspect? |
| Traffic | How many cars? Anyone hurt or trapped? Blocking the road? Fuel leaking? |
| Water / flood | Anyone in the water or stranded? How deep? Is the water rising? |
| Other | Anyone in danger right now? |

### Agent LLM settings
- Pick a fast model in the ElevenLabs agent settings (voice latency matters more than reasoning here; triage happens in the backend).
- Turn on ElevenLabs **Data Collection** with the same field names. After the call, the post-call webhook gives a second extraction from the full transcript. The backend uses it only to fill fields that are still null, never to overwrite confirmed ones.

---

## 5. Triage (three layers, most urgent wins)

### Layer 1: Rules floor (instant, deterministic)
Runs on every update in milliseconds. Same table as 03 section 7, plus unknown handling:

| Condition | Result |
|---|---|
| `breathing == false` or `conscious == false` | P1 + escalate |
| `trapped == true`, or `weapon`/`violence_ongoing == true`, or fire with people inside | P1 + escalate |
| Someone injured and `breathing == null` and `conscious == null` | P2 for now, ask both next |
| Within 1 km of a FIRMS detection or inside an open EONET event | at least P2 |
| Caller not safe (`caller_safe == false`) | at least P2 |

The rules can only set a minimum. They are the safety net: even if the LLM is wrong or slow, a P1 fact produces a P1 within a second.

### Layer 2: LLM triage (Gemini)
- **When it runs:** whenever a critical field changes (type, people, patient, hazards, location), debounced 2 seconds, plus once at call end. Not on every word.
- **Input:** the incident JSON, the last ~20 transcript lines, the NASA context, and the rules result.
- **Output:** forced JSON (structured output with a response schema, temperature 0):

```json
{
  "priority": 1,
  "reasons": [
    { "text": "Child reported inside a burning house", "evidence_field": "people.vulnerable" }
  ],
  "units": ["fire", "ems"],
  "summary": "House fire, smoke on 2nd floor, 1 child possibly trapped. Caller is a neighbor, safe.",
  "contradictions": ["Caller first said nobody was inside, later mentioned a child"],
  "confidence": 0.86
}
```

- **Rules for the prompt:** every reason must point to a field or a transcript line (`evidence_field`). No reason without evidence. If the transcript contradicts the JSON, report it in `contradictions` and use the more urgent reading.
- **What the LLM adds over rules:** it reads nuance (a calm caller describing something severe), writes the one-line summary the dispatcher reads, suggests units, and flags contradictions.
- **If it fails or times out (3 s):** the card shows the rules priority with "AI triage pending." Nothing blocks.

### Layer 3: Classifier second opinion (NVIDIA Brev)
Unchanged from 03 section 7. Can raise to P1, never lowers.

### Final priority
`final_priority = min(rules, llm, classifier)` (lower number = more urgent). The card shows where it came from:
> **P1** · Someone trapped (rule) · Child inside a burning house (AI) · 0.8 km from NASA fire detection

The AI can never lower a rules P1. A dispatcher can change any priority by hand, and that override is logged.

---

## 6. Sending it to the dashboard

**WebSocket event `incident.upsert`** (one event type for create and update keeps the client simple):

```json
{
  "type": "incident.upsert",
  "incident": { "...full incident JSON with triage..." },
  "changed": ["final_priority", "people.trapped"],
  "seq": 14
}
```

Plus `call.transcript` (live lines for the open card) and `call.ended`.

**What the dashboard does with it:**
- New `call_id`: drop a pin with a pulse; fly to it if P1.
- `final_priority` changed: re-sort the queue; flash the card if it went up.
- `geocode_confidence` low: show a dashed circle instead of a pin, labeled "approximate."
- Fields still null show as grey "unknown," not blank, so the dispatcher knows what wasn't asked yet.
- `seq` lets the client ignore out-of-order updates.

**Persistence:** every merged update is saved to Mongo as a timeline entry (`field`, `old`, `new`, `source: agent | postcall | dispatcher`, `at`). This gives the dispatcher an audit trail and gives the demo a replay.

---

## 7. Latency budget (target)

| Step | Target |
|---|---|
| Caller says the address -> agent tool call | ~1 s |
| Validate + merge + rules | <50 ms |
| Geocode | <1 s (cache repeated addresses) |
| WebSocket to dashboard | <100 ms |
| **Pin on the map** | **under 3 s from the caller saying it** |
| LLM triage refresh | 2-4 s after a critical fact |

---

## 8. Edge cases

| Case | Handling |
|---|---|
| Caller doesn't know the address | Ask cross streets, then a landmark, then "what do you see around you?" Low-confidence pin + flag for the dispatcher |
| Call drops mid-way | Incident stays with whatever was collected; card shows "call dropped, callback +1..." |
| Two callers, same fire | Kept as separate incidents for MVP; duplicate grouping is the stretch in 03 |
| Non-emergency / prank | LLM gives P4 with reason; agent stays polite and on the line; dispatcher decides |
| Caller switches language | Agent follows; `caller.language` updates |
| Caller asks for medical help ("what do I do?") | "A dispatcher will help you with that. Stay on the line." Card gets flag `needs_instructions` and moves up within its priority |
| Tool call fails | Agent keeps talking; backend fills gaps from the post-call extraction |

---

## 9. Testing plan

1. **Golden scripts:** 20 short scripted calls (synthetic) covering every type, two languages, a calm-severe caller, a panicked-minor caller, a contradiction, an unknown address. Each has the expected JSON and expected priority.
2. **Schema test:** replay each script's tool calls against the backend without voice. The final JSON must match expected fields.
3. **Triage test:** run the LLM triage on the 20 final JSONs. Report P1 recall (must be 100% with the rules floor) and overall agreement.
4. **Live test:** call the number and run 5 of the scripts by voice. Measure time to pin.
5. **Demo script calls** (04) are a subset of these, rehearsed.

---

## 10. Build order for this part

1. Schema file (zod) + types shared with the dashboard.
2. `update_incident` endpoint: validate, merge, `missing` reply. Test with curl.
3. ElevenLabs agent: first message, prompt, `update_incident` tool. Call it and watch the JSON fill.
4. Rules floor + `escalate` reply.
5. Geocode + `incident.upsert` over WebSocket (pin on the map).
6. Gemini triage with structured output + timeout fallback.
7. Post-call webhook + Data Collection backfill.
8. Classifier hook (after it's trained).

Steps 1-5 are the MVP. If only those work, the demo still shows a call becoming a pin with a priority and reasons.
