// Surge voice agent definition (docs/05 section 4). Applied by agent/setup.ts via the ElevenLabs API.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ElevenLabs, ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export type AgentCreate = Parameters<ElevenLabsClient["conversationalAi"]["agents"]["create"]>[0];

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

export const AGENT_NAME = "Surge 911 Overflow";

export const FIRST_MESSAGE =
  "911. All dispatchers are helping other callers. I'm an automated assistant and a dispatcher can see this call. What's the address of your emergency?";

export const FIRST_MESSAGE_BY_LANG: Record<string, string> = {
  es: "911. Todos los operadores están atendiendo otras llamadas. Soy un asistente automático y un operador puede ver esta llamada. ¿Cuál es la dirección de su emergencia?",
  ar: "٩١١. جميع موظفي الطوارئ مشغولون بمكالمات أخرى. أنا مساعد آلي، ويمكن لموظف الطوارئ رؤية هذه المكالمة. ما هو عنوان حالة الطوارئ؟",
};

type Prop = ElevenLabs.ObjectJsonSchemaPropertyInputPropertiesValue;
const str = (description: string): Prop => ({ type: "string", description });
const bool = (description: string): Prop => ({ type: "boolean", description });
const int = (description: string): Prop => ({ type: "integer", description });
const obj = (description: string, properties: Record<string, Prop>): Prop => ({ type: "object", description, properties, required: [] });

export function updateIncidentTool(baseUrl: string, secret: string): ElevenLabs.ToolRequestModel {
  return {
    toolConfig: {
      type: "webhook" as const,
      name: "update_incident",
      description:
        "Record facts about the emergency. Call after EVERY new fact, sending only the fields the caller just told you. The reply lists what is still missing (ask the first one) and whether to escalate.",
      responseTimeoutSecs: 10,
      apiSchema: {
        url: `${baseUrl}/tools/update_incident`,
        method: "POST" as const,
        requestHeaders: { "x-surge-secret": secret },
        requestBodySchema: {
          type: "object" as const,
          required: ["call_id"],
          properties: {
            call_id: { type: "string", dynamicVariable: "system__conversation_id" },
            call_sid: { type: "string", dynamicVariable: "system__call_sid" },
            caller_id: { type: "string", dynamicVariable: "system__caller_id" },
            caller: obj("Facts about the caller", {
              phone: str("Callback number if different from the number they are calling from"),
              callback_confirmed: bool("Caller confirmed the callback number"),
              language: str("ISO language code the caller is speaking, e.g. en, es, ar"),
              relation: { type: "string", enum: ["self", "family", "bystander", "unknown"], description: "Caller's relation to the emergency" },
              caller_safe: bool("Caller says they are safe right now"),
            }),
            location: obj("Where the emergency is", {
              spoken: str("Location exactly as the caller said it"),
              address: str("Best street address or intersection, with city if known"),
              unit_or_floor: str("Apartment, unit or floor"),
              landmark: str("Nearby landmark"),
              read_back_confirmed: bool("Caller said yes after you read the address back"),
            }),
            incident: obj("What is happening", {
              type: { type: "string", enum: ["fire", "medical", "crime", "traffic", "hazard", "water_rescue", "other"], description: "Emergency type" },
              subtype: str("Short subtype, e.g. structure_fire, chest_pain, car_crash"),
              description: str("One short sentence describing what is happening"),
              started: str("When it started, as the caller said"),
            }),
            people: obj("People involved", {
              involved: int("Number of people involved"),
              injured: int("Number of people hurt"),
              trapped: bool("Anyone trapped or unable to get out"),
              vulnerable: {
                type: "array",
                description: "Vulnerable people mentioned: child, elderly, disabled, pregnant",
                items: { type: "string", description: "child, elderly, disabled or pregnant" },
              },
            }),
            patient: obj("Condition of the hurt person", {
              conscious: bool("Person is awake and responsive"),
              breathing: bool("Person is breathing normally"),
              severe_bleeding: bool("Person is bleeding a lot"),
            }),
            hazards: obj("Dangers at the scene", {
              fire_or_smoke: bool("Fire or smoke present"),
              weapon: bool("Weapon seen or mentioned"),
              violence_ongoing: bool("Violence is happening right now"),
              gas_leak: bool("Smell of gas or gas leak"),
              downed_power_lines: bool("Power lines down"),
              flood_water: bool("Flood water present"),
            }),
            call_state: obj("Call flags", {
              caller_requested_human: bool("Caller asked for a person"),
              needs_instructions: bool("Caller asked what to do (you must not give instructions)"),
              covert: bool("Caller cannot speak freely: whispering, says they can't talk, someone is with them, answers only yes/no, speaks in code (e.g. ordering food), or an open line with no answers"),
              covert_cue: str("Short note on what made you think so, e.g. 'whispering', 'ordering a pizza', 'man shouting in background, no answers'"),
            }),
          },
        },
      },
    },
  };
}

export function getStatusTool(baseUrl: string, secret: string): ElevenLabs.ToolRequestModel {
  return {
    toolConfig: {
      type: "webhook" as const,
      name: "get_status",
      description: "Call when the caller asks if help is coming or what is happening with their call. Read the returned text exactly.",
      responseTimeoutSecs: 5,
      apiSchema: {
        url: `${baseUrl}/tools/get_status`,
        method: "POST" as const,
        requestHeaders: { "x-surge-secret": secret },
        requestBodySchema: {
          type: "object" as const,
          required: ["call_id"],
          properties: { call_id: { type: "string", dynamicVariable: "system__conversation_id" } },
        },
      },
    },
  };
}

// Post-call second extraction (docs/05: fills only fields still null).
const dc = (type: "string" | "integer" | "boolean", description: string) => ({ type, description });
export const DATA_COLLECTION = {
  address: dc("string", "Street address or intersection of the emergency"),
  incident_type: dc("string", "One of fire, medical, crime, traffic, hazard, water_rescue, other"),
  people_involved: dc("integer", "Number of people involved"),
  people_injured: dc("integer", "Number of people hurt"),
  trapped: dc("boolean", "Anyone trapped"),
  breathing: dc("boolean", "Hurt person breathing normally"),
  conscious: dc("boolean", "Hurt person awake"),
  fire_or_smoke: dc("boolean", "Fire or smoke present"),
  weapon: dc("boolean", "Weapon present"),
  violence_ongoing: dc("boolean", "Violence happening now"),
  caller_safe: dc("boolean", "Caller is safe"),
  callback_number: dc("string", "Callback number"),
  language: dc("string", "ISO code of the caller's language"),
};

const NO_INSTRUCTIONS =
  "Block any response that gives medical, first-aid, CPR, rescue, fire-safety or self-defense instructions, or that promises an arrival time. Allowed: asking questions, 'Stay on the line', 'If you're in danger, move somewhere safe', 'A dispatcher will help you with that'.";

export function agentBody(toolIds: string[], voiceId?: string): AgentCreate {
  return {
    name: AGENT_NAME,
    tags: ["surge"],
    conversationConfig: {
      agent: {
        firstMessage: FIRST_MESSAGE,
        language: "en",
        prompt: {
          prompt: readFileSync(here("./prompt.md"), "utf8"),
          llm: "gemini-2.5-flash",
          temperature: 0,
          toolIds,
          builtInTools: {
            // end_call deliberately omitted: the AI never hangs up on a 911 caller.
            languageDetection: { name: "language_detection", params: { systemToolType: "language_detection" } },
            // Lets the agent stay silent instead of filling every pause.
            skipTurn: { name: "skip_turn", params: { systemToolType: "skip_turn" } },
          },
        },
      },
      // Long re-engage timeout, and never hang up on silence (a caller may be hiding or busy helping someone).
      turn: { turnTimeout: 20, silenceEndCallTimeout: -1 },
      tts: { modelId: "eleven_flash_v2", ...(voiceId ? { voiceId } : {}) },
      languagePresets: Object.fromEntries(
        Object.entries(FIRST_MESSAGE_BY_LANG).map(([lang, firstMessage]) => [lang, { overrides: { agent: { firstMessage } } }]),
      ),
    },
    platformSettings: {
      dataCollection: DATA_COLLECTION,
      guardrails: {
        version: "1",
        promptInjection: { isEnabled: true },
        custom: {
          config: {
            configs: [
              {
                isEnabled: true,
                name: "No medical or safety instructions",
                prompt: NO_INSTRUCTIONS,
                executionMode: "blocking",
                model: "gemini-3.1-flash-lite",
                historyMessageCount: 1,
                triggerAction: { type: "retry", feedback: "Do not give instructions. Say: A dispatcher will help you with that. Stay on the line. ({{trigger_reason}})" },
              },
            ],
          },
        },
      },
    },
  };
}
