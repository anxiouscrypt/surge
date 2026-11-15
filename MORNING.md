# Demo-day checklist (Sunday morning)

## 1. Start everything (2 minutes)

`pnpm demo` may still be running from last night; its public link only lasts while it runs. If you're not sure, stop it (Ctrl-C in its terminal, or just restart the laptop) and run:

```bash
cd ~/Desktop/hackathon\ ideas/Surge
pnpm demo
```

It builds the app, opens a public HTTPS link, starts the API and points the voice agent at it. Wait for **Surge is live.** Then:

- Open `http://localhost:8787` on the laptop (the dashboard). Use localhost, not the public link: **Clear all calls** and **Replay a surge** only work from the laptop itself.
- Click **Call from phone**: the QR code opens the caller page on any phone.
- Click **Clear all calls** to remove last night's test calls.

The public link changes every time you run `pnpm demo`. Print or screenshot the QR code **after** starting.

## 2. Test before judges arrive (5 minutes)

1. Scan the QR with your phone → **Talk to Surge** → allow microphone and location. Say "my car hit a pole at" + an address. The pin should appear where you're standing with a GPS chip.
2. Send a photo from the caller page. Within a few seconds the dashboard shows it with an AI description.
3. On the dashboard, open your call → **Take over call** (allow the laptop mic). Your phone should say "Connecting you to a dispatcher" and you should hear each other.
4. Try **Can't talk? Text instead → No, someone could hear me**. The card goes P1 with "Silent" and "Do not call back".
5. **Call from phone → Replay a surge** once, to see six calls play out. Then **Clear all calls**.

If the live audio takeover fails on the venue wifi (some networks block peer-to-peer audio), the panel says so after 20 s and falls back to "call back". The phone hotspot usually works.

## 3. Things that need you

- **Twilio** (optional): upgrading the trial (~$20) gives a real phone number, live phone transfer and the "text me a location link" tool. Steps in [docs/SETUP-KEYS.md](docs/SETUP-KEYS.md). Then rerun `pnpm demo`.
- **Backup video** (MLH: under 3 minutes): screen-record **Replay a surge** while narrating, plus one real call with GPS and a takeover. Script in [docs/04-DEMO-AND-JUDGES.md](docs/04-DEMO-AND-JUDGES.md).
- **Devpost**: paste from [docs/DEVPOST.md](docs/DEVPOST.md). If the NVIDIA classifier lands, add a line about it under "How we built it".
- **Push to GitHub**: nothing from last night is pushed yet (`git push origin main` when you're ready).

## 4. What changed overnight

- **Caller phone page** (`/c`): talk or text to Surge in the browser, live GPS on the map, battery level, scene photos described by Gemini, silent mode for callers who can't speak.
- **Browser takeover**: live audio (WebRTC) or chat with the caller, no phone system needed.
- **Dispatcher panel**: caller's phone section, photos, same-incident groups ("2 callers"), nearest fire station and hospital, a Timeline tab, translated transcripts.
- **Dashboard**: P1 chime + flashing card + toast (mute button top right), more header stats, **Call from phone** QR dialog, **Replay a surge**, **Clear all calls**.
- **Agent model** is now `gemini-3.5-flash` (was 2.5-flash): 2.5 failed the Spanish and covert tests about half the time; 3.5 passed 10/10. If voice replies feel slow on your test call, set it back in `apps/api/agent/config.ts` (`llm:`) and run `pnpm agent:setup`.
- **Agent**: never hangs up because the caller says bye; closes non-urgent reports with a callback; knows about GPS and photos from the caller page. Five simulated-caller tests pass against the live agent (`pnpm --filter @surge/api agent:test`).
- **Hardening (later in the night)**:
  - The dashboard through the public link needs a key: `pnpm demo` prints a private "Dashboard (other device)" link. Without the key you get a locked page that points to the caller page. The laptop (localhost) never needs it.
  - Rate limits: 8 calls per device per 10 minutes, 20 photos per call; request size limits.
  - Calls are saved to disk and survive an API restart (`apps/api/data/incidents.json`, not committed).
  - A crash shows a Reload button instead of a blank page; the caller's screen stays awake during a call.
  - The post-call webhook checks ElevenLabs' signature when `ELEVENLABS_WEBHOOK_SECRET` is set, and fills facts the agent missed (never overwriting what the caller confirmed).
- **More features**:
  - **Steer the AI**: on a caller-page call, type a question in the panel ("Are there pets inside?") and the AI asks it next.
  - Suggested units (Fire / EMS / Police) from Gemini on cards and in the panel; the wait timer turns amber at 2 min and red at 5.
  - **Next call** button at the top of the queue (or press N) opens the most urgent waiting call.
  - **Copy for CAD** in the call panel copies a structured summary; **Download all calls (CSV)** in the Call from phone dialog.
  - Callers can press **It's getting worse**: the call moves up, triage reruns, the AI asks what changed.
  - Phone and talk-to-link calls now show a live transcript too, and flip to "ended" when the caller hangs up, with any missed facts filled in from ElevenLabs' post-call analysis.
  - If the public link dies (wifi blip), `pnpm demo` opens a new one by itself and re-points the agent; reopen **Call from phone** for the new QR code.
  - The caller page speaks Spanish and Arabic (right to left) when the phone does. Add `?lang=es` or `?lang=ar` to the link to show it on any phone.
- **Reliability**: `pnpm demo` one-command start; demo controls blocked over the public link; intersections ("Main and Washtenaw") look up the crossing in OpenStreetMap, or pin approximately when that server is busy.

## Known limits (be upfront if asked)

- The map tiles take ~10 s to appear on first load. Open the dashboard a minute early.
- The ElevenLabs "talk-to" link still works for voice, but has no GPS or photos; use the QR caller page.
- The dashboard key is in the "Dashboard (other device)" link that `pnpm demo` prints. Don't share that link; share only the QR (`/c`).
