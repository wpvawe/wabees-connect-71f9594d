import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPhone, faPhoneSlash } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { useRingingCall } from "@/hooks/useCallLogs";
import { rejectCall } from "@/lib/wabees/calls";
import { Link } from "@tanstack/react-router";

/**
 * Global ringing indicator. Mounted once in the authenticated shell.
 * Webhook writes users/{owner}/call_logs/{callId} with status="ringing";
 * we render it as a top banner + soft ring tone until the call moves to
 * connected/ended/rejected/missed.
 */
export function IncomingCallBanner() {
  const call = useRingingCall();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!call || dismissedId === call.id) {
      audioRef.current?.pause();
      return;
    }
    // Best-effort ring tone via WebAudio oscillator (avoids shipping an mp3).
    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      let stopped = false;
      const ring = () => {
        if (stopped) return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 800;
        g.gain.value = 0.05;
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.35);
        setTimeout(ring, 1200);
      };
      ring();
      return () => {
        stopped = true;
        void ctx.close();
      };
    } catch {
      /* ignore */
    }
  }, [call, dismissedId]);

  if (!call || dismissedId === call.id) return null;

  const label = call.callerName || call.from || "Unknown";

  async function onReject() {
    if (!call) return;
    setDismissedId(call.id);
    const res = await rejectCall({ call_id: call.callId });
    if (!res.success) toast.error(res.message || "Couldn't reject call");
    else toast.success("Call rejected");
  }

  return (
    <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-primary/30 bg-primary/15 px-4 py-2.5 text-sm sm:px-6">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">Incoming WhatsApp call · {label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {call.from} · Answer on the WhatsApp Business app to talk
        </div>
      </div>
      <Link
        to="/calls"
        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
      >
        Open
      </Link>
      <button
        type="button"
        onClick={onReject}
        className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
      >
        <FontAwesomeIcon icon={faPhoneSlash} className="h-3 w-3" />
        Reject
      </button>
      <button
        type="button"
        onClick={() => setDismissedId(call.id)}
        aria-label="Dismiss"
        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
      >
        <FontAwesomeIcon icon={faPhone} className="h-3 w-3" />
      </button>
    </div>
  );
}