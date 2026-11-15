import WebSocket from "ws";
const W = "https://entry-queensland-resistant-kruger.trycloudflare.com".replace("https", "wss") + "/ws";
for (const u of [W, W + "?key=t7NGjxLG3IOx"]) {
  await new Promise((res) => {
    const ws = new WebSocket(u);
    ws.on("message", (m) => { console.log(u.includes("key") ? "with key:" : "no key:", "got", JSON.parse(m).type); ws.close(); res(); });
    ws.on("unexpected-response", (_, r) => { console.log(u.includes("key") ? "with key:" : "no key:", "rejected", r.statusCode); res(); });
    ws.on("error", (e) => { console.log("error", e.message); res(); });
  });
}
