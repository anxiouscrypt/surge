# Surge: Demo Script and Judge Prep

## Table setup

- Laptop with the dashboard full screen (`http://localhost:8787` after `pnpm demo`), brightness max, sound on (P1 chime)
- The **Call from phone** QR code ready to show (button top right). Judges use their own phones; no number needed
- A printed card with the QR code as a backup (screenshot it after `pnpm demo`, the link changes each run)
- Backup video on the laptop
- Headphones or the laptop mic ready for the takeover (the browser asks for the mic the first time)

## 2-minute demo

1. **(0:00) The problem.** "When every 911 dispatcher is busy, callers wait on hold, and nobody knows who is having a heart attack and who has a fender-bender. During Hurricane Harvey, Harris County went from 3,000 calls a day to 3,000 an hour."
2. **(0:15) The dashboard.** "This is a dispatcher's view: live NASA fire detections and every overflow call on one map. Every dispatcher is on a call."
3. **(0:20) The surge.** "Scan this and report an emergency, anything you like." Judges scan the QR code and tap **Talk to Surge**. The AI answers each one in seconds, in their language.
4. **(0:45) The map fills.** Their phones share GPS: pins drop exactly where they are standing, with an accuracy circle. Someone says a person isn't breathing: chime, the card turns red, jumps to the top with the reason.
5. **(1:05) Can't talk?** One judge taps **Can't talk? Text instead → No, someone could hear me**. Silent mode: dark screen, yes/no answers, forced P1, "Do not call back" on the card. "This came from a mentor: what if the caller is being held and can't speak?"
6. **(1:20) The handoff.** Tap the red card, **Take over call**. The judge's phone says "Connecting you to a dispatcher" and you're talking to them live, with the summary, GPS and timeline already on screen.
7. **(1:40) Under the hood.** "The AI only listens and asks questions. Rules decide priority and show why; Gemini can raise a priority, never lower it. Photos from the scene are described by AI for the dispatcher."
8. **(1:55) Close.** "Surge doesn't replace dispatchers. It replaces the hold queue."

If the wifi or the agent misbehaves: **Call from phone → Replay a surge** plays six calls through the real pipeline (fire with two callers grouped, cardiac arrest, a silent call from a moving car, a fender-bender the AI closes itself, a Spanish gas leak with live translation).

## Questions judges will ask

| Question | Answer |
|---|---|
| Should AI be answering 911? | It only answers when every human is busy, which today means silence and waiting. It discloses it's automated, gives no medical advice, and every call ends with a human. |
| What if it misjudges priority? | Priority comes from explicit rules, not the AI's opinion. AI layers can only raise a priority. Waiting time also raises score, so no one is stuck. Every decision shows its reason and the field it came from. |
| What about callers who can't talk? | Covert mode: the agent spots coded calls (ordering a pizza), whispering or yes/no-only answers, switches to one-word questions, never says "911" again and never suggests a callback. The caller page also has a silent text mode. Covert calls are always P1. |
| How do you know the agent behaves? | Simulated-caller tests against the live agent (`pnpm --filter @surge/api agent:test`): a murder call where the caller says "I gotta go", a minor crash that closes with a callback, a covert pizza order, a caller begging for CPR instructions, a Spanish caller. All pass. |
| Isn't location from the phone a privacy problem? | It's shared only after the caller taps allow, only for that call, and only with the dispatcher. Real 911 already gets device location (Android ELS / Apple Hybridized Emergency Location); Surge gives overflow calls the same thing. |
| How is this different from Aurelian / Hyper? | They automate non-emergency lines. Surge handles emergency callers stuck in the queue, with a live map, GPS from the caller's phone, hazard data, grouping and one-tap handoff. |
| What does the NASA data actually do? | FIRMS fire detections (under a minute after a satellite pass in the US), EONET active events, GIBS imagery. A caller within 1 km of a detection gets raised priority and a warning. Detections are snapshots from satellite passes, not continuous fire lines. |
| How would a real center adopt it? | As an overflow destination on their phone system, starting with non-emergency overflow and expanding as trust builds. The texted location link works for regular phone calls too. |
| Walk me through the code. | Trace one call: phone → ElevenLabs agent → `update_incident` → rules + Gemini → WebSocket → dashboard. The caller page adds `/caller/:id/location` and `/media` on the same incident. |

## Backup video (record by 10:00 AM Sunday)

Under 3 minutes (MLH requirement). Easiest: `pnpm demo`, then on the dashboard **Call from phone → Replay a surge** and screen-record while you narrate; then one real call from your phone with GPS and a takeover. Upload to Devpost and keep a local copy.
