/**
 * Client for WhatsApp Business Calling API (via backend/api/send-call.php).
 *
 * Signalling only. Actual audio requires the business number to be
 * reachable via SIP or WebRTC on Meta's side; without that, `connect`
 * still creates a call intent but audio won't route. `reject` and
 * `terminate` always work.
 *
 * Firestore write side is handled by:
 *   - webhook.php::handle_call_event (inbound events)
 *   - send-call.php (outbound intents)
 * Both write to users/{ownerUid}/call_logs/{callId}.
 */
import { WABEES_API_BASE, fbAuth } from "@/integrations/firebase/client";

export type CallAction = "connect" | "accept" | "pre_accept" | "reject" | "terminate";

export type CallLogRecord = {
  id: string;
  callId: string;
  from: string;
  to: string;
  callerName: string | null;
  type: "incoming" | "outgoing";
  callType: string; // "voice" | "video"
  status: string;   // ringing | connected | ended | rejected | missed | not_answered | terminated | initiated
  phoneNumberId: string | null;
  duration: number | null;
  startedAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
};

export type CallApiResult = {
  success: boolean;
  message?: string;
  raw: Record<string, unknown>;
};

async function post(body: Record<string, unknown>): Promise<CallApiResult> {
  const user = fbAuth().currentUser;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let outbound: Record<string, unknown> = { ...body };
  if (user) {
    try {
      const idToken = await user.getIdToken();
      headers.Authorization = `Bearer ${idToken}`;
      outbound.id_token = idToken;
      outbound.auth_uid = user.uid;
      // Strip so PHP resolves creds from Firestore (dataOwner).
      delete outbound.access_token;
      delete outbound.phone_number_id;
    } catch {
      /* fall back to body creds */
    }
  }
  const res = await fetch(`${WABEES_API_BASE}/send-call.php`, {
    method: "POST",
    headers,
    body: JSON.stringify(outbound),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const rawError = raw.error;
  const errorMessage =
    typeof rawError === "string"
      ? rawError
      : rawError && typeof rawError === "object" && "message" in rawError
        ? String((rawError as { message?: unknown }).message ?? "")
        : undefined;
  return {
    // HTTP status is the source of truth. A 4xx/5xx from Meta means the
    // reject/terminate did NOT actually stop the ring on WhatsApp's side.
    success: res.ok && res.status >= 200 && res.status < 300 && !raw.error,
    message: (raw.message as string | undefined) ?? errorMessage,
    raw,
  };
}

export function initiateCall(args: { to: string }) {
  return post({ action: "connect", to: args.to });
}

export function rejectCall(args: { call_id: string }) {
  return post({ action: "reject", call_id: args.call_id });
}

export function terminateCall(args: { call_id: string }) {
  return post({ action: "terminate", call_id: args.call_id });
}

export function acceptCall(args: { call_id: string; sdp: string }) {
  return post({
    action: "accept",
    call_id: args.call_id,
    session: { sdp_type: "answer", sdp: args.sdp },
  });
}