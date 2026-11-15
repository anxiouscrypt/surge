// "Replay a surge": six scripted calls pushed through the real pipeline (rules, Gemini, geocoding,
// grouping, timeline) over about a minute. A backup for the live demo and for the demo video.
// Only the caller's side is scripted; everything the dashboard shows is computed for real.
import type { AgentUpdate } from "@surge/shared";
import { handleAgentUpdate } from "../pipeline.js";
import { store, note } from "../store/memory.js";
import { applyFix } from "../routes/caller.js";

type Step = {
  at: number; // seconds from start
  update?: Omit<AgentUpdate, "call_id">;
  agent?: string;
  caller?: string;
  en?: string; // translation of a non-English caller line
  app?: { channel: "app_voice" | "app_text"; battery: number; platform: string };
  gps?: { lat: number; lng: number; accuracy_m: number } | ((callId: string) => { lat: number; lng: number; accuracy_m: number } | null);
  offline?: boolean;
};
type Script = { id: string; steps: Step[] };

let running = false;
const timers: NodeJS.Timeout[] = [];

/** A point ~90 m north of where another replay call was placed (second caller at the same fire). */
const near = (otherId: string) => () => {
  const o = store.get(otherId)?.location;
  return o?.lat != null && o.lng != null ? { lat: o.lat + 0.0008, lng: o.lng + 0.0004, accuracy_m: 11 } : null;
};
/** Moving car along Washtenaw Ave toward Ypsilanti. */
const drive = (k: number) => ({ lat: 42.2555 - k * 0.0011, lng: -83.6705 + k * 0.0032, accuracy_m: 14 });

function scripts(stamp: string): Script[] {
  // Each call gets its own short number on the card, like a real conversation id.
  const ids = new Map<string, string>();
  const id = (s: string) => {
    if (!ids.has(s)) ids.set(s, `replay_${stamp}${Math.random().toString(36).slice(2, 8)}`);
    return ids.get(s)!;
  };
  const fireA = id("fire_a");
  return [
    {
      id: fireA,
      steps: [
        { at: 0, agent: "911. All dispatchers are helping other callers. I'm an automated assistant and a dispatcher can see this call. What's the address of your emergency?", update: { caller: { language: "en" } } },
        { at: 3, caller: "There's smoke pouring out of the house next door! 302 Ballard Street.", update: { location: { spoken: "302 Ballard Street", address: "302 Ballard St, Ypsilanti, MI" }, incident: { type: "fire", subtype: "structure_fire", description: "Smoke pouring from the house next door" }, hazards: { fire_or_smoke: true } } },
        { at: 7, agent: "I have 302 Ballard Street in Ypsilanti. Is that right?" },
        { at: 9, caller: "Yes, yes.", update: { location: { read_back_confirmed: true } } },
        { at: 12, agent: "Is anyone inside?" },
        { at: 14, caller: "My neighbor's little boy, I think he's still in there.", update: { people: { involved: 1, trapped: true, vulnerable: ["child"] } } },
        { at: 16, agent: "I'm marking this as the highest priority right now. Stay on the line." },
        { at: 22, caller: "I'm across the street, I'm okay.", update: { caller: { caller_safe: true }, people: { injured: 0 } } },
      ],
    },
    {
      id: id("medical"),
      steps: [
        { at: 5, agent: "911. All dispatchers are helping other callers. I'm an automated assistant and a dispatcher can see this call. What's the address of your emergency?", update: { caller: { language: "en" } } },
        { at: 8, caller: "15 North Huron Street. My dad collapsed in the kitchen.", update: { location: { spoken: "15 North Huron Street", address: "15 N Huron St, Ypsilanti, MI" }, incident: { type: "medical", subtype: "collapse", description: "Father collapsed in the kitchen" }, people: { involved: 1, injured: 1, vulnerable: ["elderly"] } } },
        { at: 12, agent: "I have 15 North Huron Street. Is that right?" },
        { at: 13, caller: "Yes.", update: { location: { read_back_confirmed: true } } },
        { at: 15, agent: "Is the person awake and able to talk to you?" },
        { at: 17, caller: "No, he's not answering me.", update: { patient: { conscious: false } } },
        { at: 19, agent: "I'm marking this as the highest priority right now. Stay on the line. Is the person breathing normally?" },
        { at: 22, caller: "I don't think he's breathing! What do I do?", update: { patient: { breathing: false }, call_state: { needs_instructions: true } } },
        { at: 24, agent: "A dispatcher will help you with that. Stay on the line." },
      ],
    },
    {
      id: id("fire_b"),
      steps: [
        { at: 18, app: { channel: "app_voice", battery: 0.58, platform: "Android" }, gps: near(fireA), agent: "911. All dispatchers are helping other callers. I'm an automated assistant and a dispatcher can see this call. What's the address of your emergency?" },
        { at: 22, caller: "The house on Ballard is on fire, I can see flames in the upstairs window.", update: { caller: { language: "en" }, incident: { type: "fire", subtype: "structure_fire", description: "Flames visible in an upstairs window" }, hazards: { fire_or_smoke: true } } },
        { at: 27, agent: "Your phone shows you near Ballard Street. Is the emergency there?" },
        { at: 29, caller: "Yes, right across from me.", update: { people: { involved: 1 }, caller: { caller_safe: true } } },
      ],
    },
    {
      id: id("covert"),
      steps: [
        { at: 26, app: { channel: "app_text", battery: 0.13, platform: "iPhone" }, gps: drive(0), update: { call_state: { covert: true, covert_cue: "Silent text mode: caller says it is not safe to talk" } }, agent: "You can answer with one word. Are you hurt?" },
        { at: 30, caller: "no", gps: drive(1), update: { people: { injured: 0 } } },
        { at: 33, agent: "Are you in a car?" },
        { at: 35, caller: "yes", gps: drive(2) },
        { at: 37, agent: "Is the person with you driving?" },
        { at: 39, caller: "yes. he has a knife", gps: drive(3), update: { hazards: { weapon: true }, people: { involved: 2 }, incident: { type: "crime", subtype: "abduction", description: "Caller texting silently from a moving car; the driver has a knife" } } },
        { at: 42, agent: "Okay. Stay on the line with me.", gps: drive(4) },
        { at: 46, gps: drive(5) },
        { at: 50, gps: drive(6) },
        { at: 54, gps: drive(7) },
        { at: 58, gps: drive(8) },
      ],
    },
    {
      id: id("crash"),
      steps: [
        { at: 32, agent: "911. All dispatchers are helping other callers. I'm an automated assistant and a dispatcher can see this call. What's the address of your emergency?", update: { caller: { language: "en" } } },
        { at: 35, caller: "2025 Washtenaw, in front of the Walgreens. Somebody rear-ended me at the light.", update: { location: { spoken: "2025 Washtenaw, in front of the Walgreens", address: "2025 Washtenaw Ave, Ypsilanti, MI", landmark: "Walgreens" }, incident: { type: "traffic", subtype: "car_crash", description: "Rear-end collision at a traffic light" } } },
        { at: 38, agent: "I have 2025 Washtenaw Avenue in Ypsilanti. Is that right?" },
        { at: 39, caller: "Yep.", update: { location: { read_back_confirmed: true } } },
        { at: 41, agent: "Is anyone hurt?" },
        { at: 42, caller: "No, we're both fine. Nobody's stuck, cars are on the shoulder.", update: { people: { injured: 0, trapped: false, involved: 2 }, caller: { caller_safe: true } } },
        { at: 45, agent: "What's the best number to call you back?" },
        { at: 47, caller: "734 555 0142.", update: { caller: { phone: "+17345550142", callback_confirmed: true } } },
        { at: 50, agent: "Is there anything else the dispatcher should know?" },
        { at: 52, caller: "No, that's it.", update: { call_state: { ai_ended_call: true } } },
        { at: 56, agent: "Thank you. I've passed everything to a dispatcher, and someone will call you back at this number. If anything changes or gets worse, call 911 again." },
      ],
    },
    {
      id: id("gas"),
      steps: [
        { at: 40, agent: "911. Todos los operadores están atendiendo otras llamadas. Soy un asistente automático y un operador puede ver esta llamada. ¿Cuál es la dirección de su emergencia?", update: { caller: { language: "es" } } },
        { at: 43, caller: "Huele muchísimo a gas en el edificio, 410 West Cross Street.", en: "It smells really strongly of gas in the building, 410 West Cross Street.", update: { location: { spoken: "410 West Cross Street", address: "410 W Cross St, Ypsilanti, MI" }, incident: { type: "hazard", subtype: "gas_leak", description: "Strong smell of gas in an apartment building" }, hazards: { gas_leak: true } } },
        { at: 47, agent: "Tengo 410 West Cross Street. ¿Es correcto?" },
        { at: 48, caller: "Sí.", en: "Yes.", update: { location: { read_back_confirmed: true } } },
        { at: 50, agent: "¿Cuántas personas hay en el edificio?" },
        { at: 53, caller: "Unas diez. Mi abuela no puede bajar las escaleras sola.", en: "About ten. My grandmother can't get down the stairs by herself.", update: { people: { involved: 10, vulnerable: ["elderly"] } } },
      ],
    },
  ];
}

export function replayRunning() {
  return running;
}

export function startReplay(): boolean {
  if (running) return false;
  running = true;
  const stamp = Date.now().toString(36).slice(-5);
  let last = 0;
  for (const script of scripts(stamp)) {
    for (const step of script.steps) {
      last = Math.max(last, step.at);
      timers.push(setTimeout(() => void runStep(script.id, step).catch((e) => console.warn("replay step failed", e)), step.at * 1000));
    }
  }
  timers.push(
    setTimeout(() => {
      running = false;
      timers.length = 0;
    }, (last + 2) * 1000),
  );
  return true;
}

async function runStep(callId: string, step: Step) {
  const at = () => new Date().toISOString();
  if (step.app) {
    const inc = store.getOrCreate(callId);
    inc.channel = step.app.channel;
    inc.device = { battery: step.app.battery, charging: false, language: "en-US", platform: step.app.platform, online: false, last_seen: at() }; // scripted: no real caller page to take over
    note(inc, "system", step.app.channel === "app_text" ? "Caller is texting from the Surge caller page" : "Caller connected from the Surge caller page");
    if (step.app.battery <= 0.15) note(inc, "system", `Caller's phone battery is at ${Math.round(step.app.battery * 100)}%: the call may drop`);
    store.save(inc, ["channel", "device"]);
  }
  if (step.agent) {
    store.getOrCreate(callId);
    store.addLine(callId, { role: "agent", text: step.agent, at: at() });
  }
  if (step.caller) store.addLine(callId, { role: "caller", text: step.caller, at: at(), ...(step.en ? { en: step.en } : {}) });
  if (step.update) await handleAgentUpdate({ call_id: callId, ...step.update } as AgentUpdate);
  if (step.gps) {
    const fix = typeof step.gps === "function" ? step.gps(callId) : step.gps;
    const inc = store.get(callId);
    if (fix && inc) await applyFix(inc, fix);
  }
}
