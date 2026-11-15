# Keys and accounts: exact steps

Every value goes in `.env` at the repo root (git ignores it). Open it in your editor, paste after the `=`, save. Never paste keys in chat or commit them.

The API reloads `.env` only on restart. After adding a key, tell Claude and it will restart the API.

---

## 1. Gemini (AI triage) — needed now

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key**. If it asks for a project, pick **Create API key in new project**.
3. Click the copy icon next to the key (starts with `AIza`).
4. In `.env`: `GEMINI_API_KEY=AIza...`
5. Test: `pnpm --filter @surge/api eval:triage` runs 8 sample calls through Gemini and prints agreement and P1 recall.

Free tier is enough for the hackathon. Optional: `GEMINI_MODEL=` to try another model (default `gemini-3.5-flash-lite`, falls back to `gemini-2.5-flash` when rate limited). Keys starting with `AQ.` are normal.

## 2. Mapbox (dashboard map) — needed for the map

1. Sign up at https://account.mapbox.com/auth/signup/ (free, no card needed for the free tier).
2. After sign-in you land on the account page. Under **Access tokens**, copy the **Default public token** (starts with `pk.`).
3. In `.env`: `VITE_MAPBOX_TOKEN=pk....`
4. Restart `pnpm dev:web`.

## 3. Twilio (real phone number + live handoff) — needed for the phone demo

1. Sign up at https://www.twilio.com/try-twilio and verify your email and phone.
2. **Upgrade the account** (Console → Admin → Account billing → Upgrade, about $20 credit). On a trial account every caller first hears a Twilio trial message and has to press a key, and handoff can only ring verified numbers. Bad for a live demo.
3. Buy a number: Console → **Phone Numbers → Manage → Buy a number** → Country US, check **Voice** → pick one (a 734 number looks local) → **Buy**.
4. Console home → **Account Info**: copy **Account SID** (starts with `AC`) and **Auth Token** (click to reveal).
5. In `.env`:
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+1734XXXXXXX
   DISPATCHER_PHONE=+1XXXXXXXXXX      # your own cell: rings when you click "Take over"
   ```
6. Tell Claude. It runs `pnpm agent:setup`, which imports the number into ElevenLabs and points it at the agent.

Also check your ElevenLabs plan's **concurrent call limit** (the demo needs 3 at once). Redeem the hackathon packet code for the Creator plan at https://elevenlabs.io/app/subscription if you have not.

## 4. NASA FIRMS (live fire detections)

1. Go to https://firms.modaps.eosdis.nasa.gov/api/map_key/
2. Enter your email and submit. The MAP_KEY arrives by email in a minute or two.
3. In `.env`: `FIRMS_MAP_KEY=...`

EONET and GIBS need no key.

## 5. MongoDB Atlas (save calls and the audit trail)

1. Sign up at https://www.mongodb.com/cloud/atlas/register
2. Create a deployment: choose **M0 Free**, any AWS region near you (e.g. us-east-1), click **Create Deployment**.
3. It asks you to create a database user: set a username and click **Autogenerate Secure Password**, copy it, **Create Database User**.
4. **Network Access** (left menu) → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`) → Confirm. Fine for a weekend demo; the Vultr server's IP changes otherwise.
5. **Database → Connect → Drivers** → copy the `mongodb+srv://...` string. Replace `<db_password>` with the password from step 3.
6. In `.env`: `MONGODB_URI=mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/surge?retryWrites=true&w=majority`

## 6. Later tonight (no action needed yet)

- **NVIDIA Brev credits**: post in Discord `#operation-qa-participants` and tag the NVIDIA mentor named in the hackathon guide. Do this now; approval takes time.
- **Vultr**: sign up at https://www.vultr.com and apply the MLH credit code. Claude will walk you through deploying when we get there.
- **Domain**: claim the GoDaddy Registry domain with the MLH code. Needed only after deploy.
- **Tiger Data, SSOJet**: stretch goals, only if time allows.
