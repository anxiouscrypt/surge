// Dashboard side of a browser takeover: live audio with a caller on the Surge caller page,
// or a text chat when the caller cannot talk. Lives at the dashboard level so closing the
// call panel does not drop the call.
import { useCallback, useEffect, useRef, useState } from "react";
import { post } from "./api";
import { AudioLink, type LinkState, type Signal } from "./rtc";
import { onRtc, sendOnFeed } from "./socket";

export type LiveCall = {
  callId: string;
  text: boolean;
  state: LinkState;
  error: string | null;
  muted: boolean;
  startedAt: number;
};

export function useTakeover() {
  const [live, setLive] = useState<LiveCall | null>(null);
  const link = useRef<AudioLink | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const fallback = useRef<ReturnType<typeof setTimeout>>();

  useEffect(
    () =>
      onRtc(({ call_id, data }) => {
        if (call_id !== liveRef.current?.callId || !link.current) return;
        const s = data as Signal;
        if (s.kind === "ready") {
          clearTimeout(fallback.current);
          void link.current.call();
        } else void link.current.handle(s);
      }),
    [],
  );

  const report = (callId: string, state: "connected" | "failed" | "ended", error?: string) =>
    post(`/incidents/${encodeURIComponent(callId)}/takeover`, { state, ...(error ? { error } : {}) }).catch(() => undefined);

  /** Call before asking the server to take the call, so the caller's "ready" is never missed. */
  const prepare = useCallback((callId: string, text: boolean) => {
    link.current?.close(true);
    link.current = null;
    clearTimeout(fallback.current);
    setLive({ callId, text, state: text ? "connected" : "connecting", error: null, muted: false, startedAt: Date.now() });
    if (text) return;
    link.current = new AudioLink(
      (sig) => sendOnFeed({ type: "rtc", call_id: callId, data: sig }),
      (state, error) => {
        setLive((cur) => (cur && cur.callId === callId ? { ...cur, state, error: error ?? null } : cur));
        if (state === "connected" || state === "failed") void report(callId, state, error);
      },
    );
  }, []);

  /** The server accepted the takeover. */
  const started = useCallback((callId: string, text: boolean) => {
    if (text) {
      void report(callId, "connected");
      return;
    }
    // If the caller's "ready" got lost, offer anyway after a few seconds.
    fallback.current = setTimeout(() => {
      if (liveRef.current?.callId === callId && liveRef.current.state === "connecting") void link.current?.call();
    }, 5000);
  }, []);

  const cancel = useCallback(() => {
    link.current?.close(false);
    link.current = null;
    setLive(null);
  }, []);

  const end = useCallback(() => {
    const cur = liveRef.current;
    clearTimeout(fallback.current);
    link.current?.close(true);
    link.current = null;
    if (cur) void report(cur.callId, "ended");
    setLive(null);
  }, []);

  const toggleMute = useCallback(() => {
    setLive((cur) => {
      if (!cur) return cur;
      link.current?.setMuted(!cur.muted);
      return { ...cur, muted: !cur.muted };
    });
  }, []);

  const chat = useCallback((text: string) => {
    const cur = liveRef.current;
    if (!cur || !text.trim()) return false;
    return sendOnFeed({ type: "chat", call_id: cur.callId, text: text.trim() });
  }, []);

  useEffect(() => () => link.current?.close(true), []);
  return { live, prepare, started, cancel, end, toggleMute, chat };
}
export type Takeover = ReturnType<typeof useTakeover>;
