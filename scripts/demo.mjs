#!/usr/bin/env node
// pnpm demo: everything for the live demo, in one command.
// 1. builds the dashboard + caller page (served by the API, same origin)
// 2. opens a public HTTPS tunnel (Cloudflare quick tunnel, no account needed)
// 3. starts the API with that public URL
// 4. points the ElevenLabs agent's tools at the tunnel (pnpm agent:setup)
// Ctrl-C stops everything.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

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

log("Opening a public tunnel…");
const tunnel = spawn(cf, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { cwd: root });
children.push(tunnel);
const publicUrl = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 30000);
  const scan = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      clearTimeout(timer);
      resolve(m[0]);
    }
  };
  tunnel.stdout.on("data", scan);
  tunnel.stderr.on("data", scan);
});
if (!publicUrl) fail("The tunnel did not start in 30 s. Check the internet connection and run pnpm demo again.");

log(`Starting the API on :${PORT}…`);
const env = { ...process.env, PUBLIC_BASE_URL: publicUrl, PORT: String(PORT) };
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
   Dashboard (anywhere):      ${publicUrl}
   Caller page (judges):      ${publicUrl}/c     ← the QR code in "Call from phone" opens this
   Replay a surge:            "Call from phone" → Replay a surge

 Ctrl-C to stop. The public URL changes every time you run pnpm demo.
`);
