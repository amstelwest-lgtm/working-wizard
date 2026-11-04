/**
 * Accountant-only Reality / Habits / Expectations CRUD inside Client library.
 * Management / habits view — not Compliance.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  deleteManagementHabitRule,
  listManagementHabitRules,
  saveManagementHabitRule,
} from "@/lib/client-management-habits-rules-browser";
import { agentDisplayName } from "@/lib/milon-team";
import {
  MANAGEMENT_HABITS_HARD_NO,
  MANAGEMENT_HABITS_VIEW_LABEL,
  MANAGEMENT_RULE_PILLAR_LABEL,
  MANAGEMENT_RULE_PILLARS,
  type ManagementHabitRuleRow,
  type ManagementRulePillar,
} from "@/lib/client-management-habits-rules";

const EMPTY_DRAFT = { pillar: "reality" as ManagementRulePillar, label: "", body: "" };

export function ClientManagementHabitsRulesPanel({
  clientId,
  firmId,
  formatWhen,
}: {
  clientId: string;
  firmId: string | null;
  formatWhen: (iso: string) => string;
}) {
  const [rules, setRules] = useState<ManagementHabitRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const load = useCallback(async () => {
    try {
      setRules(await listManagementHabitRules(clientId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rules could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const startEdit = (rule: ManagementHabitRuleRow) => {
    setEditingId(rule.id);
    setDraft({ pillar: rule.pillar, label: rule.label, body: rule.body });
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await saveManagementHabitRule({
        clientId,
        firmId,
        ruleId: editingId,
        draft,
      });
      setRules((prev) => {
        const rest = prev.filter((row) => row.id !== saved.id);
        return [saved, ...rest];
      });
      toast.success(editingId ? "Rule updated." : "Rule added.");
      resetForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the rule.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: ManagementHabitRuleRow) => {
    if (!window.confirm(`Remove “${rule.label}”? Bots will stop citing this template.`)) return;
    setBusy(true);
    try {
      await deleteManagementHabitRule(clientId, rule.id);
      setRules((prev) => prev.filter((row) => row.id !== rule.id));
      if (editingId === rule.id) resetForm();
      toast.success("Rule removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the rule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="client-library__habits"
      data-management-habits-rules=""
      aria-labelledby="management-habits-heading"
    >
      <h3 id="management-habits-heading" className="client-library__year">
        {MANAGEMENT_HABITS_VIEW_LABEL}
      </h3>
      <p className="cash-paged__sentence">
        Client-scoped Reality, Habits, and Expectations templates — firm IP for{" "}
        {agentDisplayName("financial_manager")}, {agentDisplayName("analyst")}, and{" "}
        {agentDisplayName("advisor")}. Not Compliance and not a second set of books.
      </p>
      <ul className="client-library__meta" data-management-habits-guard="">
        {MANAGEMENT_HABITS_HARD_NO.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="client-library__habits-form">
        <label>
          Pillar
          <select
            value={draft.pillar}
            disabled={busy}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, pillar: event.target.value as ManagementRulePillar }))
            }
          >
            {MANAGEMENT_RULE_PILLARS.map((pillar) => (
              <option key={pillar} value={pillar}>
                {MANAGEMENT_RULE_PILLAR_LABEL[pillar]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rule name
          <input
            type="text"
            value={draft.label}
            disabled={busy}
            placeholder="e.g. Minimum cash buffer"
            onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
          />
        </label>
        <label>
          Rule text
          <textarea
            value={draft.body}
            disabled={busy}
            rows={4}
            placeholder="What the team should assume or watch for on this client."
            onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
          />
        </label>
        <div className="client-library__actions">
          <button type="button" className="client-library__open" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : editingId ? "Update rule" : "Add rule"}
          </button>
          {editingId ? (
            <button type="button" className="client-library__open" disabled={busy} onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="client-library__empty">Loading rules…</p>
      ) : rules.length === 0 ? (
        <p className="client-library__empty">No Reality / Habits / Expectations rules yet.</p>
      ) : (
        <ul className="client-library__habits-list">
          {rules.map((rule) => (
            <li key={rule.id} data-management-rule={rule.id}>
              <div className="client-library__name">
                {MANAGEMENT_RULE_PILLAR_LABEL[rule.pillar]} · {rule.label}
              </div>
              <p className="client-library__meta">{rule.body}</p>
              <p className="client-library__meta">
                {rule.author_name} · edited {formatWhen(rule.edited_at)}
                {rule.firm_id ? " · firm-owned" : ""}
              </p>
              <div className="client-library__actions">
                <button
                  type="button"
                  className="client-library__open"
                  disabled={busy}
                  onClick={() => startEdit(rule)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="client-library__open"
                  disabled={busy}
                  onClick={() => void remove(rule)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
