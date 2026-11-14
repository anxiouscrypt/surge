// Hand the live call to a dispatcher: redirect the Twilio call away from the ElevenLabs stream to <Dial>.
const sid = () => process.env.TWILIO_ACCOUNT_SID ?? "";
const token = () => process.env.TWILIO_AUTH_TOKEN ?? "";

export async function transferCall(callSid: string, to: string): Promise<{ ok: boolean; error?: string }> {
  if (!sid() || !token()) return { ok: false, error: "Twilio credentials not set" };
  const twiml = `<Response><Dial>${to.replace(/[^+\d]/g, "")}</Dial></Response>`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid()}/Calls/${callSid}.json`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${sid()}:${token()}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ Twiml: twiml }),
  });
  return res.ok ? { ok: true } : { ok: false, error: `${res.status} ${await res.text()}` };
}
