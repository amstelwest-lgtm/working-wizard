import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ClientBrainQuestion } from "@/lib/client-brain";
import { isMissingBrainRelation } from "@/lib/client-brain";
import {
  activeOwnerDrip,
  buildOwnerDripCandidates,
  pickNextOwnerDrip,
  type DripCandidate,
  type QuestionState,
} from "@/lib/client-brain-questions";

function sessionKey(clientId: string): string {
  return `milon-brain-drip:${clientId}`;
}

async function stampLastAskedAt(clientId: string, candidate: DripCandidate): Promise<void> {
  const now = new Date().toISOString();
  if (candidate.storedId) {
    const { error } = await supabase
      .from("client_brain_questions")
      .update({ last_asked_at: now })
      .eq("id", candidate.storedId)
      .eq("client_id", clientId);
    if (error && !isMissingBrainRelation(error)) throw error;
    return;
  }
  const { error } = await supabase.from("client_brain_questions").upsert(
    {
      client_id: clientId,
      question_key: candidate.key,
      prompt_text: candidate.prompt,
      audience: candidate.audience,
      status: "unanswered",
      last_asked_at: now,
    },
    { onConflict: "client_id,question_key" },
  );
  if (error && !isMissingBrainRelation(error)) throw error;
}

/**
 * Slow drip: at most one owner|both outstanding question per client per session.
 * If a question was already asked within the cooldown, surface that one.
 */
export function useBrainDrip(opts: {
  clientId: string | null;
  derived: QuestionState[];
  stored: ClientBrainQuestion[];
  enabled: boolean;
  onStamped?: () => void;
}): DripCandidate | null {
  const { clientId, derived, stored, enabled, onStamped } = opts;
  const [drip, setDrip] = useState<DripCandidate | null>(null);
  const onStampedRef = useRef(onStamped);
  onStampedRef.current = onStamped;
  const stampedRef = useRef<{ clientId: string; key: string } | null>(null);

  const derivedSig = derived.map((q) => `${q.key}:${q.answered ? 1 : 0}:${q.audience}`).join("|");
  const storedSig = stored
    .map((q) => `${q.question_key}:${q.status}:${q.last_asked_at ?? ""}:${q.audience}`)
    .join("|");

  const candidates = useMemo(
    () => (clientId ? buildOwnerDripCandidates(derived, stored) : []),
    // Signatures capture the fields drip cares about; arrays are new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientId, derivedSig, storedSig],
  );

  useEffect(() => {
    if (!enabled || !clientId) {
      setDrip(null);
      return;
    }
    const now = new Date();
    const active = activeOwnerDrip(candidates, now);
    if (active) {
      setDrip(active);
      return;
    }
    let alreadyThisSession: string | null = null;
    try {
      alreadyThisSession = sessionStorage.getItem(sessionKey(clientId));
    } catch {
      alreadyThisSession = null;
    }
    const stampedKey =
      alreadyThisSession ??
      (stampedRef.current?.clientId === clientId ? stampedRef.current.key : null);
    if (stampedKey) {
      setDrip(candidates.find((c) => c.key === stampedKey) ?? null);
      return;
    }
    const next = pickNextOwnerDrip(candidates, now);
    if (!next) {
      setDrip(null);
      return;
    }
    stampedRef.current = { clientId, key: next.key };
    try {
      sessionStorage.setItem(sessionKey(clientId), next.key);
    } catch {
      /* private mode — in-memory stamp guard still holds */
    }
    setDrip(next);
    void stampLastAskedAt(clientId, next)
      .then(() => onStampedRef.current?.())
      .catch(() => {
        stampedRef.current = null;
        try {
          sessionStorage.removeItem(sessionKey(clientId));
        } catch {
          /* ignore */
        }
      });
  }, [candidates, clientId, enabled]);

  return drip;
}
