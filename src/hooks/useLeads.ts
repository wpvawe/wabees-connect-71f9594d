import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, doc, updateDoc, deleteDoc, query, limit } from "firebase/firestore";
import { fbDb, fbDbOrNull } from "@/integrations/firebase/client";
import { useEffectiveUid, useFirebaseUid } from "@/hooks/useFirebaseSession";
import { str, toIso } from "@/lib/firebase/normalizers";
import { bumpRefetch, subscribeRefetch } from "@/lib/firebase/refetchBus";

export type LeadScore = "cold" | "warm" | "hot";

export type Lead = {
  id: string;
  name: string;
  phone: string;
  altPhone: string;
  email: string;
  cnic: string;
  details: string;
  score: LeadScore;
  messageCount: number;
  firstContactAt: string | null;
  lastContactAt: string | null;
  notes?: string;
  status?: "new" | "contacted" | "qualified" | "won" | "lost";
};

export function useLeads(): { data: Lead[] | null; error: string | null } {
  const uid = useEffectiveUid();
  const selfUid = useFirebaseUid();
  const [data, setData] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid || !selfUid) return;
    if (uid !== selfUid) {
      setData([]);
      return;
    }
    const db = fbDbOrNull();
    if (!db) return;
    try {
      const snap = await getDocs(
        query(collection(db, `users/${uid}/bot_leads`), limit(1000)),
      );
      const rows: Lead[] = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          const score = str(x.score, "cold");
          return {
            id: d.id,
            name: str(x.name),
            phone: str(x.phone),
            altPhone: str(x.altPhone),
            email: str(x.email),
            cnic: str(x.cnic),
            details: str(x.details),
            score: (["cold", "warm", "hot"].includes(score) ? score : "cold") as LeadScore,
            messageCount: Number(x.messageCount ?? 0),
            firstContactAt: toIso(x.firstContactAt),
            lastContactAt: toIso(x.lastContactAt),
            notes: str(x.notes),
            status: (str(x.status, "new") as Lead["status"]) || "new",
          };
      });
      rows.sort((a, b) => (b.lastContactAt || "").localeCompare(a.lastContactAt || ""));
      setData(rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [uid, selfUid]);

  useEffect(() => {
    void load();
    const unsub = subscribeRefetch("leads", () => void load());
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  return { data, error };
}

export async function updateLead(uid: string, id: string, patch: Partial<Lead>): Promise<void> {
  await updateDoc(doc(fbDb(), `users/${uid}/bot_leads/${id}`), patch as Record<string, unknown>);
  bumpRefetch("leads");
}

export async function deleteLead(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(fbDb(), `users/${uid}/bot_leads/${id}`));
  bumpRefetch("leads");
}