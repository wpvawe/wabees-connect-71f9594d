/**
 * Lightweight notification chime — no asset bundle, no extra request.
 * Uses WebAudio so browsers don't block playback after the first user gesture.
 * Persists a user-controllable mute flag in localStorage.
 */

const MUTE_KEY = "wabees_notif_muted";
let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** Call once on first user gesture (click/keydown) to unlock autoplay. */
export function unlockNotificationSound() {
  if (unlocked) return;
  const c = getCtx();
  if (!c) return;
  unlocked = true;
  if (c.state === "suspended") void c.resume().catch(() => {});
}

export function isNotificationMuted(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setNotificationMuted(muted: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

/** Pleasant two-note chime (E5 → A5). */
export function playNotificationChime() {
  if (isNotificationMuted()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  const now = c.currentTime;
  const notes: Array<[number, number]> = [
    [659.25, 0],
    [880.0, 0.14],
  ];
  for (const [freq, t] of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + t);
    gain.gain.exponentialRampToValueAtTime(0.18, now + t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.32);
    osc.connect(gain).connect(c.destination);
    osc.start(now + t);
    osc.stop(now + t + 0.35);
  }
}

/** Install a one-time gesture unlock listener (idempotent). */
export function installAutoplayUnlocker() {
  if (typeof window === "undefined" || unlocked) return;
  const handler = () => {
    unlockNotificationSound();
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
  };
  window.addEventListener("pointerdown", handler, { once: true, passive: true });
  window.addEventListener("keydown", handler, { once: true });
  // L-3 fix: close the AudioContext on page unload so its audio graph is
  // not kept alive beyond the tab. Idempotent — safe if no ctx exists yet.
  window.addEventListener(
    "beforeunload",
    () => {
      try {
        void ctx?.close();
      } catch {
        /* ignore */
      }
    },
    { once: true },
  );
}