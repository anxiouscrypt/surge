#!/usr/bin/env node
// pnpm demo: everything for the live demo, in one command.
// 1. builds the dashboard + caller page (served by the API, same origin)
// 2. opens a public HTTPS tunnel (Cloudflare quick tunnel, no account needed)
// 3. starts the API with that public URL
// 4. points the ElevenLabs agent's tools at the tunnel (pnpm agent:setup)
// Ctrl-C stops everything.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const children = [];
const log = (msg) => console.log(`\x1b[36m[demo]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[demo] ${msg}\x1b[0m`);
  stop(1);
};
function stop(code = 0) {
  for (const c of children) c.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const portFree = (port) =>
  new Promise((res) => {
    const s = createServer().once("error", () => res(false)).once("listening", () => s.close(() => res(true)));
    s.listen(port);
  });

function cloudflaredPath() {
  if (process.env.CLOUDFLARED && existsSync(process.env.CLOUDFLARED)) return process.env.CLOUDFLARED;
  if (existsSync(root + ".tools/cloudflared")) return root + ".tools/cloudflared";
  const which = spawnSync("which", ["cloudflared"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

if (!(await portFree(PORT))) fail(`Port ${PORT} is busy. Stop the other API (pnpm dev) first.`);
const cf = cloudflaredPath();
if (!cf) fail("cloudflared not found. Install it: brew install cloudflared");

log("Building the dashboard and caller page…");
const build = spawnSync("pnpm", ["--filter", "@surge/web", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, VITE_API_URL: "" } });
if (build.status !== 0) fail("Web build failed.");

// The API reads the current public URL from this file, so a new tunnel needs no API restart.
const urlFile = root + "apps/api/data/public_url.txt";
mkdirSync(root + "apps/api/data", { recursive: true });

function openTunnel() {
  const proc = spawn(cf, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { cwd: root });
  children.push(proc);
  const url = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 30000);
    const scan = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    proc.stdout.on("data", scan);
    proc.stderr.on("data", scan);
  });
  return { proc, url };
}

log("Opening a public tunnel…");
let tunnel = openTunnel();
let publicUrl = await tunnel.url;
if (!publicUrl) fail("The tunnel did not start in 30 s. Check the internet connection and run pnpm demo again.");
writeFileSync(urlFile, publicUrl);

log(`Starting the API on :${PORT}…`);
// Dashboard key: needed to open the dashboard through the public link (the laptop needs none).
const dashboardKey = process.env.DASHBOARD_KEY || randomBytes(9).toString("base64url");
const env = { ...process.env, PUBLIC_BASE_URL: publicUrl, PORT: String(PORT), DASHBOARD_KEY: dashboardKey, PUBLIC_URL_FILE: urlFile };
const api = spawn("pnpm", ["--filter", "@surge/api", "start"], { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
children.push(api);
api.on("exit", (code) => fail(`The API stopped (exit ${code}).`));

// Wait for the API, then for the tunnel to reach it (new tunnels take a few seconds to resolve).
const ok = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
};
for (let i = 0; i < 40 && !(await ok(`http://localhost:${PORT}/health`)); i++) await new Promise((r) => setTimeout(r, 500));
let reachable = false;
for (let i = 0; i < 20 && !(reachable = await ok(`${publicUrl}/health`)); i++) await new Promise((r) => setTimeout(r, 1500));
if (!reachable) log("⚠ The tunnel is not answering yet. It usually starts working within a minute.");

log("Pointing the voice agent at the tunnel…");
const setup = spawnSync("pnpm", ["agent:setup"], { cwd: root, env, stdio: "inherit" });
if (setup.status !== 0) log("⚠ agent:setup failed: live calls will not reach this API. Fix and rerun: pnpm agent:setup");

console.log(`
\x1b[32m Surge is live.\x1b[0m
   Dashboard (this laptop):   http://localhost:${PORT}
   Dashboard (other device):  ${publicUrl}/?key=${dashboardKey}   ← private, don't share
   Caller page (judges):      ${publicUrl}/c     ← the QR code in "Call from phone" opens this
   Replay a surge:            "Call from phone" → Replay a surge

 Ctrl-C to stop. The public URL changes every time you run pnpm demo.
`);

// Watchdog: if the public link stops answering (wifi blip, tunnel crash), open a new one,
// re-point the voice agent, and tell the API (the QR code in the dashboard updates itself).
let failures = 0;
let healing = false;
async function heal(reason) {
  if (healing) return;
  healing = true;
  log(`⚠ Public link lost (${reason}). Opening a new one…`);
  tunnel.proc.removeAllListeners("exit");
  tunnel.proc.kill("SIGTERM");
  for (let attempt = 1; attempt <= 5; attempt++) {
    tunnel = openTunnel();
    const url = await tunnel.url;
    if (url) {
      publicUrl = url;
      writeFileSync(urlFile, url);
      tunnel.proc.on("exit", () => void heal("tunnel exited"));
      for (let i = 0; i < 20 && !(await ok(`${url}/health`)); i++) await new Promise((r) => setTimeout(r, 1500));
      spawnSync("pnpm", ["agent:setup"], { cwd: root, env: { ...env, PUBLIC_BASE_URL: url }, stdio: "inherit" });
      console.log(`\n\x1b[33m New public link: ${url}/c  (reopen "Call from phone" for the new QR code; reprint any printed QR)\x1b[0m`);
      console.log(`   Dashboard (other device): ${url}/?key=${dashboardKey}\n`);
      failures = 0;
      healing = false;
      return;
    }
    tunnel.proc.kill("SIGTERM");
    log(`Tunnel attempt ${attempt} failed; retrying in 10 s…`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  log("⚠ Could not open a new public link. Check the internet; the laptop dashboard still works (Replay a surge).");
  healing = false;
}
tunnel.proc.on("exit", () => void heal("tunnel exited"));
setInterval(async () => {
  if (healing) return;
  if (await ok(`${publicUrl}/health`)) failures = 0;
  else if (++failures >= 3) void heal("not answering for 90 s");
}, 30000);
