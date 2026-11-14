# Surge: Demo Script and Judge Prep

## Table setup

- Laptop (or borrowed external monitor) with the dashboard full screen in the browser, brightness max
- 3 charged phones for judges, number printed on a card
- Laptop with backup video ready, sound on
- Your own phone ready to receive the take-over transfer

## 2-minute demo

1. **(0:00) The problem.** "When every 911 dispatcher is busy, callers wait on hold, and nobody knows who is having a heart attack and who has a fender-bender. During Hurricane Harvey, Harris County went from 3,000 calls a day to 3,000 an hour."
2. **(0:15) The dashboard.** "This is a dispatcher's view during a live event happening right now: NASA satellite fire detections from minutes ago, today's satellite imagery, and the active event outline. Every dispatcher is on a call."
3. **(0:25) The surge.** "Please all call this number now." Three judges call. The AI answers each in seconds, in their language.
4. **(0:50) The map fills.** Pins drop as addresses are confirmed. One caller says someone isn't breathing: the card turns red and jumps to the top with the reason.
5. **(1:15) The handoff.** Tap the red card, tap **Take over**. The live call rings through to the dispatcher with the summary already on screen.
6. **(1:35) Under the hood.** "The AI only listens and asks questions. Our rules decide priority and show why. A model we fine-tuned on NVIDIA GPUs double-checks for missed life threats. It can raise a priority, never lower one."
7. **(1:50) Close.** "Surge doesn't replace dispatchers. It replaces the hold queue."

## Questions judges will ask

| Question | Answer |
|---|---|
| Should AI be answering 911? | It only answers when every human is busy, which today means silence and waiting. It discloses it's automated, gives no medical advice, and every call ends with a human. |
| What if it misjudges priority? | Priority comes from explicit rules, not the AI's opinion. The model can only raise a priority. Waiting time also raises score, so no one is stuck. Every decision shows its reason. |
| How is this different from Aurelian / Hyper? | They automate non-emergency lines (noise, parking). Surge handles emergency callers stuck in the queue, with a live map, hazard data, grouping and one-tap handoff. |
| Isn't caller data sensitive? | Yes. That's why the priority model runs on our own GPU, and in production it would run inside the center. We used only synthetic data this weekend. |
| What does the NASA data actually do? | Three live feeds: FIRMS fire detections (under a minute after a satellite pass in the US), EONET active events, GIBS imagery. A caller within 1 km of a detection gets raised priority and a warning; calls inside an active event are tagged with it. Detections come from satellite passes, so they are snapshots, not continuous fire lines. |
| How accurate is the classifier? | Show the benchmark: P1 recall and confusion matrix on the held-out synthetic set. Say clearly it's synthetic and would need real validation. |
| How would a real center adopt it? | Plug in as an overflow destination on their phone system, starting with non-emergency overflow and expanding as trust builds. |
| Walk me through the code. | Trace one call: phone -> agent -> `update_incident` -> geocode -> rules -> WebSocket -> web dashboard. |

## Questions to ask judges and mentors (during the day)

1. "Does 'replaces the hold queue, not the dispatcher' feel safe to you? What would worry you?"
2. "Which moment is most convincing: the map filling, the red jump, or the live handoff?"
3. "Is the NASA layer meaningful or decoration?"
4. Organizers: "Can we borrow tools from other main tracks while competing in one?"

## Backup video (record by 10:00 AM Sunday)

Same script as above, screen-recorded with real calls. Under 3 minutes (MLH requirement). Upload to Devpost and keep a local copy.
