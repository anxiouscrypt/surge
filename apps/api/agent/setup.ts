// Create or update the Surge ElevenLabs agent, its tools, and (optionally) the Twilio number.
// Usage: pnpm agent:setup   (reads .env at the repo root; the SDK reads ELEVENLABS_API_KEY)
import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { agentBody, getStatusTool, sendLocationLinkTool, updateIncidentTool } from "./config.js";

const env = (k: string, required = true) => {
  const v = process.env[k]?.trim() ?? "";
  if (required && !v) throw new Error(`Missing ${k} in .env`);
  return v;
};

const client = new ElevenLabsClient();
const baseUrl = env("PUBLIC_BASE_URL").replace(/\/$/, "");
const secret = env("TOOL_SECRET");
if (baseUrl.includes("localhost")) console.warn("⚠ PUBLIC_BASE_URL is localhost: ElevenLabs cannot reach it. Use a tunnel or the Vultr URL.");

async function upsertTool(def: ElevenLabs.ToolRequestModel): Promise<string> {
  const name = def.toolConfig.type === "webhook" ? def.toolConfig.name : "";
  const { tools } = await client.conversationalAi.tools.list({ search: name });
  const existing = tools.find((t) => (t.toolConfig as { name?: string }).name === name);
  if (existing) {
    await client.conversationalAi.tools.update(existing.id, def);
    console.log(`✓ updated tool ${name} (${existing.id})`);
    return existing.id;
  }
  const created = await client.conversationalAi.tools.create(def);
  console.log(`✓ created tool ${name} (${created.id})`);
  return created.id;
}

const toolIds = [await upsertTool(updateIncidentTool(baseUrl, secret)), await upsertTool(getStatusTool(baseUrl, secret))];
// Texting a location link needs a Twilio number that can send SMS.
if (env("TWILIO_PHONE_NUMBER", false) && env("TWILIO_ACCOUNT_SID", false)) toolIds.push(await upsertTool(sendLocationLinkTool(baseUrl, secret)));
const body = agentBody(toolIds, env("ELEVENLABS_VOICE_ID", false) || undefined);

let agentId = env("ELEVENLABS_AGENT_ID", false);
if (agentId) {
  await client.conversationalAi.agents.update(agentId, body);
  console.log(`✓ updated agent ${agentId}`);
} else {
  agentId = (await client.conversationalAi.agents.create(body)).agentId;
  console.log(`✓ created agent ${agentId}\n  → add ELEVENLABS_AGENT_ID=${agentId} to .env`);
}

// Optional: import the Twilio number and point it at the agent.
const phone = env("TWILIO_PHONE_NUMBER", false);
if (phone) {
  const numbers = await client.conversationalAi.phoneNumbers.list();
  const found = numbers.find((n) => n.phoneNumber === phone);
  if (found) {
    await client.conversationalAi.phoneNumbers.update(found.phoneNumberId, { agentId });
    console.log(`✓ ${phone} now answers with the agent`);
  } else {
    const r = await client.conversationalAi.phoneNumbers.create({
      provider: "twilio",
      phoneNumber: phone,
      label: "Surge demo",
      sid: env("TWILIO_ACCOUNT_SID"),
      token: env("TWILIO_AUTH_TOKEN"),
    });
    await client.conversationalAi.phoneNumbers.update(r.phoneNumberId, { agentId });
    console.log(`✓ imported ${phone} (${r.phoneNumberId}) and assigned the agent`);
  }
}
console.log(`\nTest in the browser: https://elevenlabs.io/app/talk-to?agent_id=${agentId}`);
