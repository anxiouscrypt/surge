// Live audio between a dispatcher's browser and the caller's phone (takeover without a phone system).
// Signaling goes through the Surge WebSocket; audio is peer to peer.
export type Signal =
  | { kind: "ready" }
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  | { kind: "bye" };
export type LinkState = "connecting" | "connected" | "failed" | "ended";

const ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

export class AudioLink {
  private pc = new RTCPeerConnection({ iceServers: ICE });
  private stream: MediaStream | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private timer: ReturnType<typeof setTimeout>;
  readonly audio = new Audio();
  state: LinkState = "connecting";

  constructor(
    private send: (s: Signal) => void,
    private onState: (s: LinkState, error?: string) => void,
  ) {
    this.audio.autoplay = true;
    this.pc.onicecandidate = (e) => e.candidate && this.send({ kind: "ice", candidate: e.candidate.toJSON() });
    this.pc.ontrack = (e) => {
      this.audio.srcObject = e.streams[0];
      void this.audio.play().catch(() => undefined);
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === "connected") this.set("connected");
      else if (s === "failed") this.set("failed", "Could not connect audio on this network");
    };
    // Venue wifi can block peer-to-peer audio. Give up after 20 s so the dispatcher can call back instead.
    this.timer = setTimeout(() => this.state === "connecting" && this.set("failed", "Audio did not connect in 20 seconds"), 20000);
  }

  private set(s: LinkState, error?: string) {
    if (this.state === s || this.state === "ended") return;
    this.state = s;
    if (s !== "connecting") clearTimeout(this.timer);
    this.onState(s, error);
  }

  private async mic() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    for (const t of this.stream.getTracks()) this.pc.addTrack(t, this.stream);
  }

  /** Dispatcher side: called when the caller says it is ready. */
  async call() {
    try {
      await this.mic();
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.send({ kind: "offer", sdp: offer.sdp ?? "" });
    } catch (e) {
      this.set("failed", (e as Error).message);
    }
  }

  async handle(s: Signal) {
    try {
      if (s.kind === "offer") {
        await this.mic();
        await this.pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
        await this.flush();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.send({ kind: "answer", sdp: answer.sdp ?? "" });
      } else if (s.kind === "answer") {
        await this.pc.setRemoteDescription({ type: "answer", sdp: s.sdp });
        await this.flush();
      } else if (s.kind === "ice") {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(s.candidate);
        else this.pending.push(s.candidate);
      } else if (s.kind === "bye") this.close(false);
    } catch (e) {
      this.set("failed", (e as Error).message);
    }
  }

  private async flush() {
    for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c).catch(() => undefined);
  }

  setMuted(muted: boolean) {
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = !muted;
  }

  close(notify = true) {
    if (notify) this.send({ kind: "bye" });
    clearTimeout(this.timer);
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.pc.close();
    this.audio.srcObject = null;
    this.set("ended");
  }
}
