// New-P1 alert: a short two-tone chime (no audio file needed). Muted state is per browser.
let ctx: AudioContext | null = null;
const KEY = "surge.alerts.muted";

export function alertsMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function setAlertsMuted(muted: boolean) {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    /* private mode */
  }
}

export function chime() {
  if (alertsMuted()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    for (const [i, freq] of [880, 1175].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.22, t + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.16);
      osc.stop(t + i * 0.16 + 0.35);
    }
  } catch {
    /* audio unavailable */
  }
}
