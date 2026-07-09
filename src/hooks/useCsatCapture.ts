/**
 * Owner-only side-effect hook: watches inbound WhatsApp messages that
 * carry a CSAT list-reply id and closes the loop by recording the rating
 * (and any free-text comment sent shortly after) on the matching survey.
 *
 * Scoped to the last 7 days of pending surveys to keep listener count
 * bounded — surveys older than that are auto-expired on the next tick.
 */
import { useEffect } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { normalizePhone } from "@/lib/firebase/normalizers";
import {
  attachCsatComment,
  parseCsatReply,
  recordCsatRating,
  type CsatSurvey,
} from "@/lib/firebase/csat";
import { useCsatSettings } from "@/hooks/useCsatSettings";
import { subscribeIncomingMessages } from "@/lib/firebase/messagesBroker";

const PENDING_TTL_MS = 7 * 24 * 3600 * 1000;
const COMMENT_WINDOW_MS = 30 * 60 * 1000; // 30 min after rating

export function useCsatCapture(): void {
  const session = useFirebaseSession();
  const settings = useCsatSettings();

  useEffect(() => {
    if (session.status !== "ready") return;
    // Only run for the actual owner (dataOwner === uid).
    const { uid, dataOwner } = session;
    if (dataOwner && dataOwner !== uid) return;
    const db = fbDbOrNull();
    if (!db) return;

    const pending = new Map<string, CsatSurvey>();
    // Map normalized-phone → survey id for O(1) lookup on inbound messages.
    const phoneToSurvey = new Map<string, string>();
    const recentResponded = new Map<
      string,
      { survey: CsatSurvey; ratedAt: number }
    >();

    // Load pending surveys via one-shot getDocs and refresh periodically.
    // Surveys change rarely (opened after a chat resolves, closed when the
    // customer replies) — polling every 5 min is more than enough.
    let stopped = false;
    async function refreshPending() {
      try {
        const snap = await getDocs(
          query(
            collection(db!, `users/${uid}/csat_surveys`),
            where("status", "==", "pending"),
            orderBy("sentAt", "desc"),
            limit(50),
          ),
        );
        if (stopped) return;
        pending.clear();
        phoneToSurvey.clear();
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          const phone = typeof x.phone === "string" ? x.phone : "";
          const sentAt =
            typeof x.sentAt === "object" &&
            x.sentAt !== null &&
            "toDate" in (x.sentAt as object)
              ? (x.sentAt as { toDate: () => Date }).toDate().toISOString()
              : typeof x.sentAt === "string"
                ? x.sentAt
                : null;
          const sentMs = sentAt ? Date.parse(sentAt) : Date.now();
          if (Date.now() - sentMs > PENDING_TTL_MS) {
            void updateDoc(doc(db!, `users/${uid}/csat_surveys/${d.id}`), {
              status: "expired",
              expiredAt: serverTimestamp(),
            }).catch(() => {});
            continue;
          }
          const survey: CsatSurvey = {
            id: d.id,
            phone,
            conversationId:
              typeof x.conversationId === "string" ? x.conversationId : "",
            sentAt,
            sentByUid: null,
            sentByEmail: null,
            agentId: typeof x.agentId === "string" ? x.agentId : null,
            agentEmail:
              typeof x.agentEmail === "string" ? x.agentEmail : null,
            wamid: typeof x.wamid === "string" ? x.wamid : null,
            status: "pending",
            rating: null,
            comment: null,
            respondedAt: null,
          };
          pending.set(d.id, survey);
          if (phone) phoneToSurvey.set(normalizePhone(phone), d.id);
        }
      } catch {
        /* transient — retried on next tick */
      }
    }
    void refreshPending();
    const pollTimer = window.setInterval(() => void refreshPending(), 5 * 60 * 1000);

    // Single shared listener on inbound messages (no per-phone fan-out).
    const unsubBroker = subscribeIncomingMessages(uid, (msg) => {
      const data = msg.data;
      const buttonReplyId =
        typeof data.buttonReplyId === "string" ? data.buttonReplyId : null;
      const body = typeof data.body === "string" ? data.body : "";
      const phoneRaw = typeof data.contactPhone === "string" ? data.contactPhone : "";
      const phoneKey = normalizePhone(phoneRaw);

      // Rating capture -------------------------------------------------
      const hit = parseCsatReply({ buttonReplyId, body });
      if (hit) {
        const survey = pending.get(hit.surveyId);
        if (!survey) return;
        void recordCsatRating({
          ownerUid: uid,
          surveyId: hit.surveyId,
          rating: hit.rating,
          phone: survey.phone,
          askComment: settings.askComment,
          commentPrompt: settings.commentPrompt,
        })
          .then(() => {
            recentResponded.set(normalizePhone(survey.phone), {
              survey: { ...survey, rating: hit.rating, status: "responded" },
              ratedAt: Date.now(),
            });
            pending.delete(hit.surveyId);
          })
          .catch(() => {});
        return;
      }

      // Comment capture — first free-text after a recent rating.
      const bucket = recentResponded.get(phoneKey);
      if (bucket && Date.now() - bucket.ratedAt < COMMENT_WINDOW_MS) {
        if (body.trim() && !buttonReplyId) {
          if (msg.createdAtMs >= bucket.ratedAt - 5_000) {
            void attachCsatComment({
              ownerUid: uid,
              surveyId: bucket.survey.id,
              comment: body,
            }).catch(() => {});
            recentResponded.delete(phoneKey);
          }
        }
      }

      // Also: if inbound arrives from a phone we have a pending survey for
      // and the survey id map knows it, no action needed here — parseCsatReply
      // handles button/list replies. Free-text before a rating is ignored.
      void phoneToSurvey; // reserved for future correlation
    });

    return () => {
      stopped = true;
      window.clearInterval(pollTimer);
      unsubBroker();
    };
    // Bug fix: `session` is an object that changes identity on every token
    // refresh, tearing down this subscription (and its local Maps) needlessly.
    // Depend on the primitives the effect actually reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session.status === "ready" ? session.uid : null,
    session.status === "ready" ? session.dataOwner : null,
    settings.askComment,
    settings.commentPrompt,
  ]);
}