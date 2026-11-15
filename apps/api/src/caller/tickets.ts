// A ticket lets one caller page post GPS, photos and transcript lines for exactly one call.
// Issued when the page starts a call (or when the agent texts a link), bound to the call id once.
import { randomBytes } from "node:crypto";

const tickets = new Map<string, { callId: string | null; created: number }>();

export function issueTicket(callId: string | null = null): string {
  const t = randomBytes(12).toString("base64url");
  tickets.set(t, { callId, created: Date.now() });
  return t;
}

/** Bind a fresh ticket to the conversation the page just started. Fails if it is bound to another call. */
export function bindTicket(ticket: string, callId: string): boolean {
  const t = tickets.get(ticket);
  if (!t) return false;
  if (t.callId && t.callId !== callId) return false;
  t.callId = callId;
  return true;
}

export const callForTicket = (ticket: string) => tickets.get(ticket)?.callId ?? null;
