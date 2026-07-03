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
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { fbDbOrNull } from "@/integrations/firebase/client";
import { useFirebaseSession } from "@/hooks/useFirebaseSession";
import { phoneQueryCandidates } from "@/lib/firebase/normalizers";
import {
  attachCsatComment,
  parseCsatReply,
  recordCsatRating,
  type CsatSurvey,
} from "@/lib/firebase/csat";
import { useCsatSettings } from "@/hooks/useCsatSettings";

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
    const messageUnsubs = new Map<string, () => void>();
    const recentResponded = new Map<
      string,
      { survey: CsatSurvey; ratedAt: number }
    >();

    function subscribeMessages(phone: string) {
      if (messageUnsubs.has(phone)) return;
      const candidates = phoneQueryCandidates(phone);
      const inFilter = candidates.slice(0, 10);
      const mq = query(
        collection(db!, `users/${uid}/messages`),
        where("contactPhone", "in", inFilter),
        orderBy("createdAt", "desc"),
        limit(20),
      );
      const unsub = onSnapshot(
        mq,
        (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type === "removed") continue;
            const data = change.doc.data() as Record<string, unknown>;
            if (data.direction !== "incoming") continue;
            const buttonReplyId =
              typeof data.buttonReplyId === "string" ? data.buttonReplyId : null;
            const body = typeof data.body === "string" ? data.body : "";

            // Rating capture ----------------------------------------------
            const hit = parseCsatReply({ buttonReplyId, body });
            if (hit) {
              const survey = pending.get(hit.surveyId);
              if (!survey) continue;
              void recordCsatRating({
                ownerUid: uid,
                surveyId: hit.surveyId,
                rating: hit.rating,
                phone: survey.phone,
                askComment: settings.askComment,
                commentPrompt: settings.commentPrompt,
              })
                .then(() => {
                  recentResponded.set(survey.phone, {
                    survey: { ...survey, rating: hit.rating, status: "responded" },
                    ratedAt: Date.now(),
                  });
                })
                .catch(() => {});
              continue;
            }

            // Comment capture — first free-text after a recent rating.
            const bucket = recentResponded.get(phone);
            if (bucket && Date.now() - bucket.ratedAt < COMMENT_WINDOW_MS) {
              if (body.trim() && !buttonReplyId) {
                const createdAtIso =
                  typeof data.createdAt === "string" ? data.createdAt : null;
                const createdMs = createdAtIso
                  ? Date.parse(createdAtIso)
                  : Date.now();
                if (createdMs >= bucket.ratedAt - 5_000) {
                  void attachCsatComment({
                    ownerUid: uid,
                    surveyId: bucket.survey.id,
                    comment: body,
                  }).catch(() => {});
                  recentResponded.delete(phone);
                }
              }
            }
          }
        },
        () => {},
      );
      messageUnsubs.set(phone, unsub);
    }

    // Watch pending surveys.
    const pq = query(
      collection(db, `users/${uid}/csat_surveys`),
      where("status", "==", "pending"),
      orderBy("sentAt", "desc"),
      limit(50),
    );
    const unsubPending = onSnapshot(
      pq,
      (snap) => {
        const seenPhones = new Set<string>();
        pending.clear();
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
            void updateDoc(doc(db, `users/${uid}/csat_surveys/${d.id}`), {
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
          if (phone) {
            seenPhones.add(phone);
            subscribeMessages(phone);
          }
        }
        // Drop listeners for phones with no pending surveys.
        for (const [p, u] of messageUnsubs) {
          if (!seenPhones.has(p) && !recentResponded.has(p)) {
            u();
            messageUnsubs.delete(p);
          }
        }
      },
      () => {},
    );

    return () => {
      unsubPending();
      for (const u of messageUnsubs.values()) u();
      messageUnsubs.clear();
    };
  }, [session, settings.askComment, settings.commentPrompt]);
}