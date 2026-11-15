// "Callers" panel: the QR code judges scan to call Surge from their own phone, plus demo controls.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { DASHBOARD_KEY, post, request, API_URL } from "../lib/api";
import { Icon } from "./Icon";

type Config = { public_url: string | null; sms: boolean; phone_number: string | null; voice: boolean; ai_triage: boolean };

export function DemoTools({ onClose, demo }: { onClose: () => void; demo: boolean }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    request<Config>("/config")
      .then(setConfig)
      .catch(() => setConfig({ public_url: null, sms: false, phone_number: null, voice: false, ai_triage: false }));
  }, []);
  const url = `${config?.public_url ?? location.origin}/c`;
  useEffect(() => {
    if (!config) return;
    QRCode.toDataURL(url, { margin: 1, width: 560, color: { dark: "#0b1218", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [config, url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (label: string, path: string, done: string) => {
    setBusy(label);
    setMessage(null);
    try {
      await post(path, {});
      setMessage(done);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const local = /localhost|127\.0\.0\.1/.test(url);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="demo-tools glass" role="dialog" aria-label="Call Surge from your phone" onClick={(e) => e.stopPropagation()}>
        <button className="icon-button close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <span className="section-eyebrow">CALL SURGE FROM YOUR PHONE</span>
        <h2>Scan to report an emergency</h2>
        <div className="qr-wrap">{qr ? <img src={qr} alt={`QR code for ${url}`} /> : <div className="spinner" />}</div>
        <p className="qr-url">{url.replace(/^https?:\/\//, "")}</p>
        {local && <p className="feed-note">This link only works on this computer. Run pnpm demo for a public link.</p>}
        <ul className="qr-features">
          <li>
            <Icon name="mic" size={14} /> Talk to the AI, or text if you can't talk
          </li>
          <li>
            <Icon name="target" size={14} /> Live GPS pin on this map
          </li>
          <li>
            <Icon name="camera" size={14} /> Send scene photos, described by AI
          </li>
        </ul>
        <div className="feature-status">
          <span className={config?.voice ? "ok" : ""}>Voice agent {config?.voice ? "ready" : "off"}</span>
          <span className={config?.ai_triage ? "ok" : ""}>Gemini triage {config?.ai_triage ? "on" : "off"}</span>
          <span className={config?.sms ? "ok" : ""}>Text-a-link {config?.sms ? "on" : "needs Twilio"}</span>
        </div>
        {!demo && (
          <div className="demo-actions">
            <button disabled={!!busy} onClick={() => void run("replay", "/demo/replay", "Replaying 5 calls over the next minute.")}>
              <Icon name="bolt" size={14} /> {busy === "replay" ? "Starting…" : "Replay a surge"}
            </button>
            {confirmReset ? (
              <button
                className="danger"
                disabled={!!busy}
                onClick={() => {
                  setConfirmReset(false);
                  void run("reset", "/incidents/reset", "All calls cleared.");
                }}
              >
                Confirm: clear every call
              </button>
            ) : (
              <button disabled={!!busy} onClick={() => setConfirmReset(true)}>
                Clear all calls
              </button>
            )}
          </div>
        )}
        {message && <p className="feed-note">{message}</p>}
        <a className="link-button" href={`${API_URL}/incidents/export.csv${DASHBOARD_KEY ? `?key=${encodeURIComponent(DASHBOARD_KEY)}` : ""}`}>
          Download all calls (CSV)
        </a>
        <p className="caller-fine">Hackathon demo. Not connected to real 911.</p>
      </section>
    </div>
  );
}
