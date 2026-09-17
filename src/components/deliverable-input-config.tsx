/**
 * Configure inputs — collapsed summary above each accountant (and owner)
 * deliverable. Sources, outstanding questions, and assumptions for this tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import { CollapsibleGoldCard } from "@/components/primitives/collapsible-gold-card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  buildDeliverableInputDefinition,
  configNeedsRefresh,
  countCheckedSources,
  deliverableInputContextKey,
  markConfigApplied,
  mergeDeliverableInputState,
  onlyLiveEngineValuesChanged,
  type DeliverableInputContext,
  type DeliverableInputId,
  type DeliverableInputState,
} from "@/lib/deliverable-input-config";
import {
  patchStoredDeliverableInput,
  readStoredDeliverableInputs,
} from "@/lib/deliverable-input-config.store";

const LABEL_CLS = "text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400";
const INPUT_CLS =
  "h-8 border-amber-900/15 bg-white/80 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100";

export type EngineBoundPatch = Record<string, string | number | boolean>;

export function useDeliverableInputConfig(opts: {
  clientId?: string;
  deliverableId: DeliverableInputId;
  context: DeliverableInputContext;
}) {
  const { clientId, deliverableId, context } = opts;
  const ctxKey = deliverableInputContextKey(deliverableId, context);
  const def = useMemo(
    () => buildDeliverableInputDefinition(deliverableId, context),
    // context is represented by ctxKey so inline objects are safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deliverableId, ctxKey],
  );
  const [state, setState] = useState<DeliverableInputState>(() =>
    mergeDeliverableInputState(def, null, context),
  );
  const hydrated = useRef(false);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const stored = clientId ? readStoredDeliverableInputs(clientId)[deliverableId] : null;
    const next = mergeDeliverableInputState(def, stored, contextRef.current);
    if (!next.appliedFingerprint) {
      setState(markConfigApplied(next));
    } else {
      setState(next);
    }
    hydrated.current = true;
    // Hydrate once per client + tab. Live engine values overlay in the following effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, deliverableId]);

  useEffect(() => {
    if (!hydrated.current) return;
    setState((prev) => {
      const next = mergeDeliverableInputState(def, prev, contextRef.current);
      if (onlyLiveEngineValuesChanged(prev, next, def)) return markConfigApplied(next);
      return next;
    });
  }, [def]);

  const persist = useCallback(
    (next: DeliverableInputState) => {
      setState(next);
      if (hydrated.current && clientId) patchStoredDeliverableInput(clientId, deliverableId, next);
    },
    [clientId, deliverableId],
  );

  return { def, state, persist };
}

export function DeliverableInputConfig({
  clientId,
  deliverableId,
  context,
  onEngineBoundChange,
  className = "",
}: {
  clientId?: string;
  deliverableId: DeliverableInputId;
  context: DeliverableInputContext;
  /** Called when a first-class engine field changes so the parent can re-run. */
  onEngineBoundChange?: (patch: EngineBoundPatch) => void;
  className?: string;
}) {
  const { def, state, persist } = useDeliverableInputConfig({
    clientId,
    deliverableId,
    context,
  });
  const counts = countCheckedSources(def, state);
  const needsRefresh = configNeedsRefresh(state);
  const questionCount = def.questions.length;
  const assumptionCount = def.assumptions.length;

  const subtitle = [
    `${counts.checked} source${counts.checked === 1 ? "" : "s"}`,
    `${assumptionCount} assumption${assumptionCount === 1 ? "" : "s"}`,
    questionCount ? `${questionCount} open question${questionCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const setSource = (id: string, checked: boolean) => {
    persist({
      ...state,
      checkedSources: { ...state.checkedSources, [id]: checked },
    });
  };

  const setAssumption = (id: string, value: string | number | boolean) => {
    const next: DeliverableInputState = {
      ...state,
      assumptionValues: { ...state.assumptionValues, [id]: value },
    };
    const spec = def.assumptions.find((a) => a.id === id);
    if (spec?.engineBound) {
      persist(markConfigApplied(next));
      onEngineBoundChange?.({ [id]: value });
    } else {
      persist(next);
    }
  };

  return (
    <div className={className} data-deliverable-input-config={deliverableId}>
      <CollapsibleGoldCard
        icon={Settings2}
        title="Configure inputs"
        subtitle={subtitle}
        defaultOpen={false}
      >
        {needsRefresh ? (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-[#d4a550]/35 bg-[#d4a550]/10 px-3 py-2.5 text-xs leading-relaxed text-slate-800 dark:text-slate-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b8860b]" />
            <span>
              Choices are saved for this analysis. The figures below still reflect the last run —
              they do not update on their own when you uncheck a source or edit an assumption that
              the engine does not yet read.
            </span>
          </div>
        ) : null}

        <section className="space-y-3">
          <h3 className={LABEL_CLS}>Inputs used</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {def.sources.map((src) => {
              const checked = state.checkedSources[src.id] !== false;
              return (
                <li
                  key={src.id}
                  className="flex items-start gap-2.5 rounded-lg border border-amber-900/10 bg-white/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40"
                >
                  <Checkbox
                    id={`${deliverableId}-src-${src.id}`}
                    checked={checked}
                    onCheckedChange={(v) => setSource(src.id, v === true)}
                    className="mt-0.5 border-[#b8860b]/50 data-[state=checked]:bg-[#d4a550] data-[state=checked]:text-[#1b1300]"
                  />
                  <label
                    htmlFor={`${deliverableId}-src-${src.id}`}
                    className="min-w-0 cursor-pointer"
                  >
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      {src.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                      {src.available
                        ? src.hint
                        : src.hint
                          ? `${src.hint} · No data yet`
                          : "No data yet"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-6 space-y-3">
          <h3 className={LABEL_CLS}>Open questions</h3>
          {def.questions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No outstanding questions for this analysis.
            </p>
          ) : (
            <ol className="space-y-2">
              {def.questions.map((q, i) => (
                <li
                  key={q.id}
                  className="flex gap-2.5 rounded-lg border border-amber-900/10 bg-white/60 px-3 py-2 text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-100"
                >
                  <span className="mt-0.5 w-4 shrink-0 text-[10px] font-semibold text-[#b8860b]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="leading-snug">{q.prompt}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {def.assumptions.length > 0 ? (
          <section className="mt-6 space-y-3">
            <h3 className={LABEL_CLS}>Assumptions</h3>
            <ul className="space-y-3">
              {def.assumptions.map((a) => {
                const value = state.assumptionValues[a.id];
                return (
                  <li
                    key={a.id}
                    className="rounded-lg border border-amber-900/10 bg-white/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label
                        htmlFor={`${deliverableId}-a-${a.id}`}
                        className="text-sm font-medium text-slate-900 dark:text-slate-100"
                      >
                        {a.label}
                        {a.unit ? (
                          <span className="ml-1 font-normal text-slate-500">({a.unit})</span>
                        ) : null}
                      </Label>
                      {a.kind === "number" ? (
                        <Input
                          id={`${deliverableId}-a-${a.id}`}
                          type="number"
                          className={`${INPUT_CLS} w-28`}
                          min={a.min}
                          max={a.max}
                          step={a.step ?? 1}
                          value={typeof value === "number" ? value : Number(value) || 0}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            setAssumption(a.id, Number.isFinite(n) ? n : 0);
                          }}
                        />
                      ) : a.kind === "boolean" ? (
                        <Switch
                          id={`${deliverableId}-a-${a.id}`}
                          checked={value === true}
                          onCheckedChange={(v) => setAssumption(a.id, v)}
                        />
                      ) : (
                        <Select
                          value={String(value ?? "")}
                          onValueChange={(v) => setAssumption(a.id, v)}
                        >
                          <SelectTrigger
                            id={`${deliverableId}-a-${a.id}`}
                            className={`${INPUT_CLS} w-56`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(a.options ?? []).map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {a.defaultLabel ? (
                      <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        {a.defaultLabel}
                      </p>
                    ) : a.engineBound ? (
                      <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        Applied to this analysis when you change it.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </CollapsibleGoldCard>
    </div>
  );
}
