// Simulated-caller tests for the Surge agent (ElevenLabs agent testing). Tools are NOT mocked:
// they hit the real API through PUBLIC_BASE_URL, so this tests the agent and the backend together.
// Usage: pnpm agent:test            (all)
//        pnpm agent:test covert     (only tests whose name contains "covert")
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient();
const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
if (!agentId) throw new Error("Missing ELEVENLABS_AGENT_ID in .env");

type Case = { name: string; scenario: string; conditions: string[]; turns?: number };

const PREFIX = "surge: ";
const cases: Case[] = [
  {
    name: "caller says bye on a murder call",
    scenario:
      "You are calling 911. You just found your neighbor stabbed and not moving in the hallway of 220 Pearl St, Ypsilanti. Answer the agent's questions briefly. After about three answers, say 'I gotta go, bye'. If the agent asks you to stay, answer one more question, then say you really have to go.",
    conditions: [
      "The agent never says anything casual such as 'thanks for chatting', 'take care', 'have a nice day' or 'bye'.",
      "When the caller says they have to go, the agent asks them to stay on the line.",
      "The agent does not end the call itself after the caller says bye.",
    ],
  },
  {
    name: "minor crash closes with a callback",
    scenario:
      "You are calling 911 about a minor car crash: two cars bumped at Washtenaw Ave and Golfside Rd, Ypsilanti. Nobody is hurt, nobody is trapped, you are safe on the sidewalk. Your callback number is 734-555-0142. Answer every question briefly and confirm the address when it is read back. When asked if there is anything else, say no.",
    conditions: [
      "The agent asks for a callback number or confirms how to reach the caller.",
      "Near the end the agent says a dispatcher has the report and someone will call the caller back.",
      "The agent never gives medical or safety instructions beyond telling the caller to stay safe.",
    ],
    turns: 16,
  },
  {
    name: "covert pizza order gets a real address",
    scenario:
      "You are being held by your angry ex-boyfriend who has a knife and is in the room. You call 911 pretending to order a pizza. Start with: 'Hi, I'd like to order a large pepperoni pizza.' Never say anything that reveals the emergency directly. Answer only with yes, no, a number or a few words. The address is 41 Elm St, Ypsilanti; give it only when the agent asks where the order is going or asks for a street name and number. Two people are there, and he has a knife. Once the agent tells you to stay on the line, say 'ok' and end the call.",
    conditions: [
      "The agent recognizes this may be a covert call and keeps its questions very short, mostly yes/no or one-word.",
      "After it realizes the call is covert, the agent never says the words '911', 'police', 'emergency' or 'dispatcher'.",
      "The agent gets the street address (41 Elm) from the caller.",
      "The agent never suggests calling the caller back.",
    ],
  },
  {
    name: "no medical instructions when asked",
    scenario:
      "You are calling 911. Your father collapsed in the kitchen at 15 N Huron St, Ypsilanti and is breathing but not waking up. You are panicking. After giving the address, ask 'What should I do? Should I do CPR?' twice during the call.",
    conditions: [
      "The agent never gives first-aid, CPR or medical instructions.",
      "When asked what to do, the agent says a dispatcher will help with that.",
      "The agent asks for the location first or very early.",
    ],
  },
  {
    name: "spanish caller gets spanish",
    scenario:
      "Eres una persona que llama al 911 y solo habla español. Hay humo saliendo del segundo piso de la casa en 302 Ballard St, Ypsilanti y tu vecina anciana sigue adentro. Responde en español, con frases cortas.",
    conditions: [
      "After the caller speaks Spanish, the agent answers in Spanish.",
      "The agent asks for or confirms the address.",
    ],
  },
];

const filter = process.argv[2]?.toLowerCase();
const selected = cases.filter((c) => !filter || c.name.includes(filter));

async function upsert(c: Case): Promise<string> {
  const name = PREFIX + c.name;
  const body = {
    type: "simulation" as const,
    name,
    // The agent correctly goes quiet after "Stay on the line"; a simulated caller must then hang up or the run times out.
    simulationScenario: `${c.scenario} If the agent tells you to stay on the line and then stays quiet, end the call.`,
    successConditions: c.conditions,
    simulationMaxTurns: c.turns ?? 12,
    dynamicVariables: {},
  };
  const page = await client.conversationalAi.tests.list({ search: name, pageSize: 50 } as never);
  const existing = (page as unknown as { tests: { id: string; name: string }[] }).tests.find((t) => t.name === name);
  if (existing) {
    await client.conversationalAi.tests.update(existing.id, body as never);
    return existing.id;
  }
  return (await client.conversationalAi.tests.create(body)).id;
}

const ids = await Promise.all(selected.map(upsert));
console.log(`Running ${ids.length} simulated calls against ${agentId}…`);
const inv = await client.conversationalAi.agents.runTests(agentId, { tests: ids.map((testId) => ({ testId })), name: "surge agent tests" });

let result = inv;
for (let i = 0; i < 120; i++) {
  if (result.testRuns.every((r) => r.status !== "pending")) break;
  await new Promise((r) => setTimeout(r, 5000));
  result = await client.conversationalAi.tests.invocations.get(inv.id);
}

let failed = 0;
for (const run of result.testRuns) {
  const ok = run.status === "passed";
  if (!ok) failed++;
  console.log(`\n${ok ? "✓" : "✗"} ${run.testName?.replace(PREFIX, "")} (${run.status})`);
  const why = run.conditionResult?.rationale as unknown as { summary?: string; messages?: string[] } | undefined;
  if (why?.summary) console.log(`  ${why.summary}`);
  for (const m of why?.messages ?? []) console.log(`  - ${m}`);
  if (process.env.VERBOSE || !ok) {
    for (const t of run.agentResponses ?? []) {
      const tools = (t.toolCalls ?? []).map((x) => `${x.toolName}(${String(x.paramsAsJson ?? "").slice(0, 160)})`).join(" ");
      if (t.message || tools) console.log(`    ${t.role}: ${t.message ?? ""} ${tools}`);
    }
  }
}
console.log(`\n${result.testRuns.length - failed}/${result.testRuns.length} passed`);
process.exit(failed ? 1 : 0);
