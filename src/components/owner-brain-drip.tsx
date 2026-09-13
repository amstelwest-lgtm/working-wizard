/**
 * Clickable, fillable owner prompt for the slow-drip outstanding question.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingBrainRelation, type ClientBrainQuestion } from "@/lib/client-brain";
import {
  asFluentCustomerQuestion,
  catalogPromptForKey,
  DRIP_ANSWER_HELP,
  operatingProfileQuestionStates,
  productLineQuestionStates,
} from "@/lib/client-brain-questions";
import { historyCoverageQuestionStates } from "@/lib/history-coverage";
import { useBrainDrip } from "@/hooks/use-brain-drip";
import { stampProfileProvenance, type ClientOperatingProfile } from "@/lib/client-profile";
import type { ProductMix } from "@/lib/product-mix";
import { emptyProductMix, namedProductLines } from "@/lib/product-mix";
import type { WeeklyInputs } from "@/lib/weekly-inputs";
import { emptyWeeklyInputs, getISOWeekKey } from "@/lib/weekly-inputs";
import { AddPastPeriodLink } from "@/components/add-past-period-link";
import {
  OPT_IN_CHOICES,
  applyOperatingProfileDripAnswer,
  applyProductMixDripAnswer,
  applyWeeklyDripAnswer,
  parseLineNames,
  profileDripChoices,
} from "@/lib/owner-drip-answer";

function choiceClass(on: boolean) {
  return on
    ? "rounded-lg border-2 border-[#d4a550] bg-[#d4a550]/20 px-2.5 py-1.5 text-left text-xs font-medium text-slate-800 dark:text-slate-100"
    : "rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 text-left text-xs text-slate-600 transition hover:border-[#d4a550]/60 hover:bg-[#d4a550]/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300";
}

function MoneyInput({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={inputRef}
      type="number"
      min={0}
      step="0.01"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-amber-900/15 bg-white/80 px-3 py-1.5 text-sm text-slate-800 outline-none ring-[#d4a550]/40 focus:border-[#d4a550] focus:ring-2 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-100"
    />
  );
}

export function OwnerBrainDrip({
  clientId,
  operatingProfile,
  productMix,
  weeklyInputs,
  snapshotCount = 0,
  hasLiveFigures = false,
  onAddPastPeriod,
  onSaveProfile,
  onSaveProductMix,
  onSaveWeekly,
  enabled = true,
}: {
  clientId: string | null;
  operatingProfile?: ClientOperatingProfile | null;
  productMix?: ProductMix;
  weeklyInputs?: WeeklyInputs;
  snapshotCount?: number;
  hasLiveFigures?: boolean;
  onAddPastPeriod?: () => void;
  onSaveProfile?: (profile: ClientOperatingProfile) => Promise<void> | void;
  onSaveProductMix?: (mix: ProductMix) => void;
  onSaveWeekly?: (weekly: WeeklyInputs) => void;
  enabled?: boolean;
}) {
  const [stored, setStored] = useState<ClientBrainQuestion[]>([]);
  const [ready, setReady] = useState(false);
  const [advanceToken, setAdvanceToken] = useState(0);
  const [justAnsweredKey, setJustAnsweredKey] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [text, setText] = useState("");
  const [lineValues, setLineValues] = useState<Record<string, string>>({});
  const [weeklyRev, setWeeklyRev] = useState("");
  const [weeklyCos, setWeeklyCos] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!clientId) {
      setStored([]);
      setReady(false);
      return;
    }
    const { data, error: loadError } = await supabase
      .from("client_brain_questions")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(80);
    setStored(isMissingBrainRelation(loadError) ? [] : ((data ?? []) as ClientBrainQuestion[]));
    setReady(true);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mix = productMix ?? emptyProductMix();
  const weekly = weeklyInputs ?? emptyWeeklyInputs();

  const derived = useMemo(() => {
    const all = [
      ...(operatingProfile ? operatingProfileQuestionStates(operatingProfile) : []),
      ...productLineQuestionStates(mix, weekly),
      ...historyCoverageQuestionStates({
        snapshotCount,
        hasLiveFigures,
        deferForCoreProfile: operatingProfile?.depth === "core",
      }),
    ];
    if (!justAnsweredKey) return all;
    return all.map((q) => (q.key === justAnsweredKey ? { ...q, answered: true } : q));
  }, [operatingProfile, mix, weekly, snapshotCount, hasLiveFigures, justAnsweredKey]);

  const drip = useBrainDrip({
    clientId,
    derived,
    stored,
    enabled: Boolean(clientId) && ready && enabled,
    advanceToken,
    onStamped: () => {
      void load();
    },
  });

  const fluentPrompt = drip
    ? asFluentCustomerQuestion(catalogPromptForKey(drip.key) ?? drip.prompt)
    : "";
  const named = namedProductLines(mix);
  const profileChoices = drip ? profileDripChoices(drip.key, operatingProfile ?? null) : [];
  const isHistory = Boolean(drip?.key.startsWith("history."));
  const isProfile = Boolean(drip?.key.startsWith("operating_profile."));
  const isOptIn = drip?.key === "product_mix.opt_in";
  const isNames = drip?.key === "product_mix.lines";
  const isLineMoney =
    drip?.key === "product_mix.prices" ||
    drip?.key === "product_mix.costs" ||
    drip?.key === "product_mix.revenue";
  const isWeekly = drip?.key === "weekly_inputs.weeks";
  const isStored = Boolean(drip && !isHistory && !isProfile && !isOptIn && !isNames && !isLineMoney && !isWeekly);

  useEffect(() => {
    setChoice("");
    setText(isNames ? named.map((l) => l.name).join("\n") : "");
    const seed: Record<string, string> = {};
    if (drip?.key === "product_mix.prices") {
      for (const line of named) seed[line.id] = line.sellPrice != null ? String(line.sellPrice) : "";
    } else if (drip?.key === "product_mix.costs") {
      for (const line of named) seed[line.id] = line.unitCost != null ? String(line.unitCost) : "";
    } else if (drip?.key === "product_mix.revenue") {
      for (const line of named) {
        seed[line.id] = line.revenueAmount != null ? String(line.revenueAmount) : "";
      }
    }
    setLineValues(seed);
    const week = weekly.weeks[getISOWeekKey()];
    setWeeklyRev(week?.revenue ? String(week.revenue) : "");
    setWeeklyCos(week?.costOfSales ? String(week.costOfSales) : "");
    setError(null);
    setOpen(false);
    // Reset only when the dripped question changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drip?.key]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open, drip?.key]);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const markStoredAnswered = useCallback(
    async (key: string, prompt: string, audience: "owner" | "accountant" | "both", answer: string) => {
      if (!clientId) return;
      const now = new Date().toISOString();
      const { data: auth } = await supabase.auth.getUser();
      const { error: saveError } = await supabase.from("client_brain_questions").upsert(
        {
          client_id: clientId,
          question_key: key,
          prompt_text: prompt,
          audience,
          status: "answered",
          answer_text: answer,
          answered_at: now,
          answered_by: auth.user?.id ?? null,
        },
        { onConflict: "client_id,question_key" },
      );
      if (saveError && !isMissingBrainRelation(saveError)) throw saveError;
    },
    [clientId],
  );

  const submit = useCallback(async () => {
    if (!drip) return;
    if (isHistory) {
      onAddPastPeriod?.();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isProfile) {
        if (!operatingProfile) throw new Error("Finish the first profile questions first.");
        if (!choice) throw new Error("Pick an answer, then tap Answer question.");
        if (!onSaveProfile) throw new Error("Could not save this answer just now.");
        const next = stampProfileProvenance(
          applyOperatingProfileDripAnswer(operatingProfile, drip.key, choice),
          "owner",
        );
        await onSaveProfile(next);
        const label = profileChoices.find((c) => c.id === choice)?.label ?? choice;
        await markStoredAnswered(drip.key, fluentPrompt, drip.audience, label);
      } else if (isOptIn || isNames || isLineMoney) {
        if (!onSaveProductMix) throw new Error("Could not save this answer just now.");
        const next = applyProductMixDripAnswer(mix, drip.key, {
          choice,
          names: parseLineNames(text),
          lineValues,
        });
        onSaveProductMix(next);
        await markStoredAnswered(
          drip.key,
          fluentPrompt,
          drip.audience,
          isNames ? parseLineNames(text).join(", ") : choice || "Saved",
        );
      } else if (isWeekly) {
        if (!onSaveWeekly) throw new Error("Could not save this answer just now.");
        const next = applyWeeklyDripAnswer(
          weekly,
          Number(weeklyRev),
          Number(weeklyCos),
        );
        onSaveWeekly(next);
        await markStoredAnswered(
          drip.key,
          fluentPrompt,
          drip.audience,
          `Revenue ${weeklyRev} · cost of sales ${weeklyCos}`,
        );
      } else {
        const answer = text.trim();
        if (!answer) throw new Error("Type a short answer, then tap Answer question.");
        await markStoredAnswered(drip.key, fluentPrompt, drip.audience, answer);
      }
      toast.success("Saved — recommendations will get sharper");
      setJustAnsweredKey(drip.key);
      await load();
      setAdvanceToken((n) => n + 1);
    } catch (e) {
      const message = (e as Error).message || "Could not save that answer.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [
    choice,
    drip,
    fluentPrompt,
    isHistory,
    isLineMoney,
    isNames,
    isOptIn,
    isProfile,
    isWeekly,
    lineValues,
    load,
    markStoredAnswered,
    mix,
    onAddPastPeriod,
    onSaveProductMix,
    onSaveProfile,
    onSaveWeekly,
    operatingProfile,
    profileChoices,
    text,
    weekly,
    weeklyCos,
    weeklyRev,
  ]);

  if (!drip) return null;

  return (
    <div id="owner-brain-drip" className="owner-brain-drip">
      <button
        type="button"
        className="owner-brain-drip__hit"
        aria-expanded={open}
        aria-controls="owner-brain-drip-panel"
        onClick={toggleOpen}
      >
        <span className="owner-brain-drip__copy">
          <span className="owner-brain-drip__kicker">One question</span>
          <span className="owner-brain-drip__q">{fluentPrompt}</span>
          <span className="owner-brain-drip__note">{DRIP_ANSWER_HELP}</span>
        </span>
        <ChevronDown
          className={`owner-brain-drip__chevron h-4 w-4 ${open ? "is-open" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div id="owner-brain-drip-panel" className="owner-brain-drip__panel space-y-2">
          {isProfile || isOptIn ? (
            <div className="flex flex-col gap-1.5">
              {(isOptIn ? OPT_IN_CHOICES : profileChoices).map((opt, i) => (
                <button
                  key={opt.id}
                  type="button"
                  ref={i === 0 ? (el) => { firstFieldRef.current = el; } : undefined}
                  className={choiceClass(choice === opt.id)}
                  onClick={() => setChoice(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}

          {isNames ? (
            <textarea
              ref={(el) => { firstFieldRef.current = el; }}
              value={text}
              rows={3}
              placeholder="e.g. Retail shop&#10;Wholesale deliveries"
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-lg border border-amber-900/15 bg-white/80 px-3 py-2 text-sm text-slate-800 outline-none ring-[#d4a550]/40 focus:border-[#d4a550] focus:ring-2 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-100"
            />
          ) : null}

          {isLineMoney ? (
            <div className="space-y-1.5">
              {named.map((line, i) => (
                <label key={line.id} className="block">
                  <span className="mb-0.5 block text-[11px] text-amber-950/55 dark:text-amber-100/50">
                    {line.name}
                  </span>
                  <MoneyInput
                    inputRef={i === 0 ? firstFieldRef : undefined}
                    value={lineValues[line.id] ?? ""}
                    onChange={(v) => setLineValues((prev) => ({ ...prev, [line.id]: v }))}
                    placeholder={
                      drip.key === "product_mix.revenue" ? "Revenue from this line" : "Amount"
                    }
                  />
                </label>
              ))}
            </div>
          ) : null}

          {isWeekly ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-amber-950/55 dark:text-amber-100/50">
                  This week’s revenue
                </span>
                <MoneyInput
                  inputRef={firstFieldRef}
                  value={weeklyRev}
                  onChange={setWeeklyRev}
                  placeholder="0"
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-amber-950/55 dark:text-amber-100/50">
                  Cost of sales
                </span>
                <MoneyInput value={weeklyCos} onChange={setWeeklyCos} placeholder="0" />
              </label>
            </div>
          ) : null}

          {isStored ? (
            <textarea
              ref={(el) => { firstFieldRef.current = el; }}
              value={text}
              rows={3}
              placeholder="Type your answer"
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-lg border border-amber-900/15 bg-white/80 px-3 py-2 text-sm text-slate-800 outline-none ring-[#d4a550]/40 focus:border-[#d4a550] focus:ring-2 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-100"
            />
          ) : null}

          {isHistory && onAddPastPeriod ? <AddPastPeriodLink onOpen={onAddPastPeriod} /> : null}

          {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="owner-brain-drip__answer"
          >
            {saving ? "Saving…" : "Answer question"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
