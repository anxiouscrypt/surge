// Surge caller page (/c). Opened from a QR code or a texted link on the caller's phone.
// Talk (or text) to the Surge agent in the browser, and share live GPS, battery and scene photos
// with the dispatcher. When a dispatcher takes over, the call switches to live audio (or chat).
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Conversation } from "@elevenlabs/client";
import { API_URL, post, request } from "../lib/api";
import { AudioLink, type Signal } from "../lib/rtc";
import { Icon } from "../components/Icon";
import { CALLER_TEXT, phoneLang } from "../lib/callerText";

const LANG = phoneLang();
const T = CALLER_TEXT[LANG];

type Phase = "home" | "text-safety" | "starting" | "live" | "handoff" | "dispatcher" | "ended" | "error";
type Mode = "voice" | "text";
type Line = { role: "agent" | "caller" | "dispatcher"; text: string };
type Gps = { state: "off" | "asking" | "on" | "denied" | "unavailable"; accuracy?: number; address?: string | null };
type Battery = { level: number; charging: boolean; addEventListener: (e: string, f: () => void) => void };

const LANGS = ["es", "ar"] as const;

export default function Caller() {
  const { ticket: linkTicket } = useParams();
  const [phase, setPhase] = useState<Phase>(linkTicket ? "starting" : "home");
  const [mode, setMode] = useState<Mode>("voice");
  const [unsafe, setUnsafe] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [gps, setGps] = useState<Gps>({ state: "off" });
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [dispatcher, setDispatcher] = useState(T.aDispatcher);
  const [attached, setAttached] = useState(false); // opened from a texted link: no agent here, the call is on the phone

  const conv = useRef<Conversation | null>(null);
  const callId = useRef<string | null>(null);
  const ticket = useRef<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const link = useRef<AudioLink | null>(null);
  const watch = useRef<number | null>(null);
  const lastFix = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const toldAgentGps = useRef(false);
  const lastTyped = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Socket handlers outlive renders: read mode and safety through refs, never stale state.
  const modeRef = useRef<Mode>("voice");
  const unsafeRef = useRef(false);
  const handingOff = useRef(false);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    void logEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (phaseRef.current === "live" || phaseRef.current === "dispatcher") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => () => stopEverything(), []);
  // Keep the phone screen on during the call (location and audio stop when it locks).
  const active = phase === "live" || phase === "handoff" || phase === "dispatcher";
  useEffect(() => {
    if (!active) return;
    type Lock = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } }).wakeLock;
    let lock: Lock | null = null;
    const acquire = () => {
      if (document.visibilityState === "visible") wl?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);

  // Opened from a texted link during a phone call: share location and photos for that call.
  useEffect(() => {
    if (!linkTicket) return;
    let cancelled = false;
    request<{ call_id: string }>(`/caller/link/${encodeURIComponent(linkTicket)}`)
      .then(async ({ call_id }) => {
        if (cancelled) return;
        ticket.current = linkTicket;
        callId.current = call_id;
        await post("/caller/bind", { ticket: linkTicket, call_id, channel: null, device: await deviceInfo() });
        setAttached(true);
        setPhase("live");
        setStarted(Date.now());
        openSocket();
        startGps();
      })
      .catch((e) => !cancelled && fail((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [linkTicket]);

  const add = (l: Line) => setLines((cur) => [...cur, l].slice(-60));
  const headers = () => ({ "content-type": "application/json", "x-caller-ticket": ticket.current ?? "" });
  const send = (path: string, body: unknown) =>
    fetch(`${API_URL}/caller/${callId.current}/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => null);

  function fail(message: string) {
    stopEverything();
    setError(message);
    setPhase("error");
  }

  async function deviceInfo() {
    const nav = navigator as Navigator & { getBattery?: () => Promise<Battery> };
    let battery: Battery | null = null;
    try {
      battery = (await nav.getBattery?.()) ?? null;
    } catch {
      battery = null;
    }
    if (battery) {
      const b = battery;
      const report = () => callId.current && send("device", { battery: b.level, charging: b.charging });
      b.addEventListener("levelchange", report);
      b.addEventListener("chargingchange", report);
    }
    return {
      battery: battery?.level ?? null,
      charging: battery?.charging ?? null,
      language: navigator.language || null,
      platform: /iphone|ipad/i.test(navigator.userAgent) ? "iPhone" : /android/i.test(navigator.userAgent) ? "Android" : "Browser",
    };
  }

  async function start(m: Mode, isUnsafe = false) {
    setMode(m);
    setUnsafe(isUnsafe);
    modeRef.current = m;
    unsafeRef.current = isUnsafe;
    setPhase("starting");
    setError(null);
    try {
      const session = await post<{ ticket: string; signed_url: string }>("/caller/session", {});
      ticket.current = session.ticket;
      const lang = LANG as (typeof LANGS)[number];
      const c = await Conversation.startSession({
        signedUrl: session.signed_url,
        connectionType: "websocket",
        textOnly: m === "text",
        overrides: {
          agent: {
            ...(m === "text" ? { firstMessage: isUnsafe ? T.textFirstUnsafe : T.textFirst } : {}),
            ...(LANGS.includes(lang) ? { language: lang } : {}),
          },
          ...(m === "text" ? { conversation: { textOnly: true } } : {}),
        },
        onMessage: ({ message, source }) => {
          const role = source === "ai" ? "agent" : "caller";
          if (role === "caller" && message === lastTyped.current) return; // our own typed line, already shown
          add({ role, text: message });
          if (callId.current) void send("transcript", { role, text: message });
        },
        onModeChange: ({ mode }) => setSpeaking(mode === "speaking"),
        onDisconnect: (details) => {
          console.info("voice agent disconnected", details);
          if (handingOff.current) return; // we ended the AI session to hand the caller to a dispatcher
          if (phaseRef.current === "live" || phaseRef.current === "starting") {
            stopEverything();
            setPhase("ended");
          }
        },
        onError: (msg) => console.warn("voice agent error", msg),
      });
      conv.current = c;
      callId.current = c.getId();
      await post("/caller/bind", {
        ticket: session.ticket,
        call_id: callId.current,
        channel: m === "voice" ? "app_voice" : "app_text",
        device: await deviceInfo(),
        unsafe: isUnsafe,
      });
      if (m === "text")
        c.sendContextualUpdate(
          isUnsafe
            ? "[Phone] text mode. The caller says it is NOT safe to talk: someone may hear them. Treat as covert from the start."
            : "[Phone] text mode. The caller cannot speak or hear well and is typing.",
        );
      setStarted(Date.now());
      setPhase("live");
      openSocket();
      startGps();
    } catch (e) {
      const msg = (e as Error).message;
      fail(/permission|denied|notallowed/i.test(msg) ? T.micNeeded : msg || "Could not start the call.");
    }
  }

  function openSocket() {
    const url = API_URL.replace(/^http/, "ws") + `/caller-ws?ticket=${encodeURIComponent(ticket.current ?? "")}`;
    const socket = new WebSocket(url);
    ws.current = socket;
    socket.onmessage = (msg) => {
      try {
        const m = JSON.parse(msg.data);
        if (m.type === "takeover") void takeover(m.dispatcher);
        else if (m.type === "rtc") void link.current?.handle(m.data as Signal);
        else if (m.type === "chat" && typeof m.text === "string") add({ role: "dispatcher", text: m.text });
        else if (m.type === "ask" && typeof m.text === "string")
          conv.current?.sendContextualUpdate(`[Dispatcher] Ask the caller next: ${m.text}`);
        else if (m.type === "ended") {
          stopEverything();
          setPhase("ended");
        }
      } catch {
        /* ignore */
      }
    };
    socket.onclose = () => {
      // Reconnect while the call is active (phones drop sockets when switching networks).
      if (ws.current === socket && ["live", "handoff", "dispatcher"].includes(phaseRef.current)) setTimeout(openSocket, 2000);
    };
  }

  const signal = (data: Signal) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify({ type: "rtc", data }));

  async function takeover(name?: string) {
    setDispatcher(name || T.aDispatcher);
    handingOff.current = true;
    const text = modeRef.current === "text" || unsafeRef.current;
    await conv.current?.endSession().catch(() => undefined);
    conv.current = null;
    if (text) {
      // Keep it silent: the dispatcher continues by text.
      setPhase("dispatcher");
      add({ role: "dispatcher", text: T.joined(name || T.aDispatcher) });
      return;
    }
    setPhase("handoff");
    try {
      const u = new SpeechSynthesisUtterance(T.handoffSpeech);
      u.lang = LANG;
      speechSynthesis.speak(u);
    } catch {
      /* no speech */
    }
    link.current?.close(false);
    link.current = new AudioLink(signal, (state, err) => {
      if (state === "connected") setPhase("dispatcher");
      if (state === "failed") {
        setNotice(T.audioFailed);
        if (err) console.warn("live audio failed", err);
        setPhase("dispatcher");
      }
    });
    signal({ kind: "ready" });
  }

  function startGps() {
    if (!("geolocation" in navigator)) return setGps({ state: "unavailable" });
    setGps((g) => ({ ...g, state: g.state === "on" ? "on" : "asking" }));
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = navigator.geolocation.watchPosition(
      (pos) => void onFix(pos),
      (err) => setGps({ state: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  async function onFix(pos: GeolocationPosition) {
    const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
    const prev = lastFix.current;
    const movedM = prev ? distanceM(prev, { lat, lng }) : Infinity;
    setGps((g) => ({ ...g, state: "on", accuracy: Math.round(accuracy) }));
    // Send the first fix right away, then every 4 s at most, or sooner on a real move.
    if (prev && Date.now() - prev.at < 4000 && movedM < 25) return;
    lastFix.current = { lat, lng, at: Date.now() };
    const r = (await send("location", { lat, lng, accuracy_m: accuracy, heading: Number.isFinite(heading) ? heading : null, speed_mps: Number.isFinite(speed) ? speed : null })) as {
      address?: string | null;
    } | null;
    if (r?.address) setGps((g) => ({ ...g, address: r.address }));
    if (!toldAgentGps.current && conv.current && accuracy <= 100) {
      toldAgentGps.current = true;
      conv.current.sendContextualUpdate(
        `[Phone] GPS location shared${r?.address ? `: near ${r.address}` : ""} (accurate to ${Math.round(accuracy)} m). The dispatcher can see it on the map.`,
      );
    }
  }

  async function sendPhoto(file: File) {
    if (!callId.current) return;
    setNotice(T.sendingPhoto);
    try {
      const body = file.type.startsWith("image/") && file.type !== "image/heic" ? await shrink(file) : file;
      const res = await fetch(`${API_URL}/caller/${callId.current}/media`, {
        method: "POST",
        headers: { "content-type": body.type || file.type, "x-caller-ticket": ticket.current ?? "" },
        body,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Upload failed");
      setNotice(T.photoSent);
      conv.current?.sendContextualUpdate(`[Phone] ${file.type.startsWith("video") ? "video" : "photo"} sent. The dispatcher can see it.`);
    } catch (e) {
      setNotice(T.photoFailed((e as Error).message));
    }
    setTimeout(() => setNotice(null), 4000);
  }

  function sendText(text: string) {
    const t = text.trim();
    if (!t) return;
    setDraft("");
    add({ role: "caller", text: t });
    if (phase === "dispatcher") {
      ws.current?.send(JSON.stringify({ type: "chat", text: t }));
      return;
    }
    lastTyped.current = t;
    conv.current?.sendUserMessage(t);
    void send("transcript", { role: "caller", text: t });
  }

  async function reportWorse() {
    if (!callId.current) return;
    await send("worse", {});
    conv.current?.sendContextualUpdate("[Phone] The caller pressed \"It's getting worse\". Ask what changed, record it, and stay on the line.");
    setNotice(T.worseSent);
    setTimeout(() => setNotice(null), 4000);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    conv.current?.setMicMuted?.(next);
    link.current?.setMuted(next);
  }

  function stopEverything() {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    void conv.current?.endSession().catch(() => undefined);
    conv.current = null;
    link.current?.close(true);
    link.current = null;
    const s = ws.current;
    ws.current = null;
    s?.close();
  }

  function hangUp() {
    stopEverything();
    setPhase("ended");
  }

  const elapsed = started ? Math.floor((now - started) / 1000) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const texting = mode === "text" || unsafe;

  return (
    <div className={`caller-page ${unsafe ? "quiet" : ""} phase-${phase}`} lang={LANG} dir={LANG === "ar" ? "rtl" : "ltr"}>
      <header className="caller-top">
        <span className="caller-brand">
          <span className="brand-mark">
            <Icon name="bolt" size={16} />
          </span>
          SURGE
        </span>
        {(phase === "live" || phase === "dispatcher" || phase === "handoff") && (
          <span className="caller-live">
            <span className="live-dot" /> {phase === "dispatcher" ? T.dispatcherTag : T.live} · {clock}
          </span>
        )}
      </header>

      {phase === "home" && (
        <main className="caller-home">
          <h1>{T.needHelp}</h1>
          <p className="caller-sub">{T.intro}</p>
          <button className="talk-button" onClick={() => void start("voice")}>
            <span className="talk-ring" />
            <Icon name="mic" size={34} />
            <span>{T.talk}</span>
          </button>
          <button className="text-button" onClick={() => setPhase("text-safety")}>
            <Icon name="message" size={18} /> {T.textInstead}
          </button>
          <p className="caller-fine">
            {T.privacy}
            <br />
            <b>{T.demo}</b> {T.real911}
          </p>
        </main>
      )}

      {phase === "text-safety" && (
        <main className="caller-home">
          <h1>{T.safeQ}</h1>
          <button className="choice danger" onClick={() => void start("text", true)}>
            <b>{T.unsafe}</b>
            <span>{T.unsafeSub}</span>
          </button>
          <button className="choice" onClick={() => void start("text", false)}>
            <b>{T.cantSpeak}</b>
            <span>{T.cantSpeakSub}</span>
          </button>
          <button className="link-button" onClick={() => setPhase("home")}>
            {T.back}
          </button>
        </main>
      )}

      {phase === "starting" && (
        <main className="caller-center">
          <div className="spinner" />
          <p>{mode === "voice" && !linkTicket ? T.connectingMic : T.connecting}</p>
        </main>
      )}

      {(phase === "live" || phase === "dispatcher" || phase === "handoff") && (
        <main className="caller-live-view">
          {phase === "handoff" ? (
            <div className="agent-status">
              <div className="spinner" />
              <b>{T.connectingTo(dispatcher)}</b>
              <span>{T.stay}</span>
            </div>
          ) : phase === "dispatcher" && !texting ? (
            <div className="agent-status">
              <div className="orb dispatcher">
                <Icon name="headset" size={30} />
              </div>
              <b>{T.talkingTo(dispatcher)}</b>
              <span>{notice ?? T.speakNormally}</span>
            </div>
          ) : attached ? (
            <div className="agent-status">
              <div className="orb">
                <Icon name="pin" size={30} />
              </div>
              <b>{T.stayOnPhone}</b>
              <span>{T.pageShares}</span>
            </div>
          ) : !texting ? (
            <div className="agent-status">
              <div className={`orb ${speaking ? "speaking" : "listening"}`}>
                <Icon name={speaking ? "volume" : "mic"} size={30} />
              </div>
              <b>{speaking ? T.speaking : T.listening}</b>
              <span>{T.automated}</span>
            </div>
          ) : null}

          <div className="caller-cards">
            <div className={`caller-card gps ${gps.state}`}>
              <Icon name="pin" size={18} />
              <div>
                <b>
                  {gps.state === "on"
                    ? T.gpsOn
                    : gps.state === "asking"
                      ? T.gpsAsking
                      : gps.state === "denied"
                        ? T.gpsDenied
                        : gps.state === "unavailable"
                          ? T.gpsUnavailable
                          : T.gpsOff}
                </b>
                <span>
                  {gps.state === "on"
                    ? `${gps.address ? `${T.near(gps.address)} · ` : ""}±${gps.accuracy} m`
                    : gps.state === "denied"
                      ? T.gpsDeniedSub
                      : T.gpsSub}
                </span>
              </div>
              {(gps.state === "off" || gps.state === "denied" || gps.state === "unavailable") && (
                <button onClick={startGps}>{T.share}</button>
              )}
            </div>
            <label className="caller-card photo">
              <Icon name="camera" size={18} />
              <div>
                <b>{T.photo}</b>
                <span>{notice && phase !== "dispatcher" ? notice : T.photoSub}</span>
              </div>
              <input
                type="file"
                accept="image/*,video/*"
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void sendPhoto(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {(texting || lines.length > 0) && !attached && (
            <div className={`caller-log ${texting ? "chat" : ""}`}>
              {lines.map((l, i) => (
                <p key={i} className={`bubble ${l.role}`}>
                  {l.role === "dispatcher" && <small>{T.dispatcherLabel}</small>}
                  {l.text}
                </p>
              ))}
              <div ref={logEnd} />
            </div>
          )}

          {texting && phase !== "handoff" && (
            <div className="chat-input">
              <div className="quick">
                {T.quick.map((q) => (
                  <button key={q} onClick={() => sendText(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendText(draft);
                }}
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={T.typeHere} aria-label="Message" autoComplete="off" />
                <button type="submit" aria-label="Send" disabled={!draft.trim()}>
                  <Icon name="send" size={18} />
                </button>
              </form>
            </div>
          )}

          {!unsafe && phase === "live" && (
            <button className="worse-button" onClick={() => void reportWorse()}>
              <Icon name="alert" size={16} /> {notice === T.worseSent ? T.worseSent : T.worse}
            </button>
          )}
          <div className="caller-controls">
            {!texting && !attached && (
              <button className={`round ${muted ? "on" : ""}`} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                <Icon name={muted ? "mute" : "mic"} size={20} />
              </button>
            )}
            <button className="hangup" onClick={hangUp}>
              {attached ? T.stopSharing : T.endCall}
            </button>
          </div>
        </main>
      )}

      {phase === "ended" && (
        <main className="caller-center">
          <div className="ended-mark">
            <Icon name="check" size={30} />
          </div>
          <h1>{T.callEnded}</h1>
          <p className="caller-sub">{T.callAgain}</p>
          {!linkTicket && (
            <button className="text-button" onClick={() => location.reload()}>
              {T.newCall}
            </button>
          )}
        </main>
      )}

      {phase === "error" && (
        <main className="caller-center">
          <h1>{T.couldntConnect}</h1>
          <p className="caller-sub">{error}</p>
          {!linkTicket && (
            <>
              <button className="text-button" onClick={() => setPhase("home")}>
                {T.tryAgain}
              </button>
              <p className="caller-fine">{T.real911}</p>
            </>
          )}
        </main>
      )}
    </div>
  );
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

/** Phone photos are large; send a 1600 px JPEG so it arrives fast on a weak signal. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.82));
  } catch {
    return file;
  }
}
