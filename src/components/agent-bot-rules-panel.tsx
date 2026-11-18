import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { editBotBrainRule, listBotBrainRules, retireBotBrainRule } from "@/lib/milon-brain-rules.functions";
import { stageAgentDisplayName, type StageAgentKey } from "@/lib/tax-specialist/agents";
import { SETUP_PARTNER_DISPLAY_NAME } from "@/lib/setup-partner";

type RuleRow = {
  id: string;
  rule_text: string;
  task_type: string;
  client_id: string | null;
  created_at: string;
};

export function AgentBotRulesPanel({
  firmId,
  clientId = null,
  tab,
}: {
  firmId: string;
  clientId?: string | null;
  tab: StageAgentKey | "implementation_manager";
}) {
  const list = useServerFn(listBotBrainRules);
  const retire = useServerFn(retireBotBrainRule);
  const edit = useServerFn(editBotBrainRule);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const title =
    tab === "implementation_manager"
      ? SETUP_PARTNER_DISPLAY_NAME
      : stageAgentDisplayName(tab as StageAgentKey);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await list({
        data: {
          firmId,
          clientId: clientId ?? undefined,
          tab,
        },
      });
      setRules(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rules could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [clientId, firmId, list, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (row: RuleRow) => {
    setEditingId(row.id);
    setDraft(row.rule_text);
  };

  const saveEdit = async () => {
    if (!editingId || !draft.trim()) return;
    setBusy(true);
    try {
      await edit({ data: { firmId, ruleId: editingId, ruleText: draft } });
      toast.success("Rule updated.");
      setEditingId(null);
      setDraft("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the rule.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: RuleRow) => {
    if (!window.confirm("Retire this rule? Bots will stop using it.")) return;
    setBusy(true);
    try {
      await retire({ data: { firmId, ruleId: row.id } });
      toast.success("Rule retired.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not retire the rule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-agent-bot-rules={tab}>
      {loading ? (
        <p className="milon-desk-hint">Loading rules…</p>
      ) : rules.length === 0 ? (
        <p className="milon-desk-hint">No active private rules for {title} yet.</p>
      ) : (
        <ul className="agent-bot-rules-list">
          {rules.map((row) => (
            <li key={row.id} data-brain-rule={row.id}>
              {editingId === row.id ? (
                <div className="agent-bot-rules-edit">
                  <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} />
                  <div className="milon-desk-actions">
                    <button type="button" className="milon-desk-btn primary" disabled={busy} onClick={() => void saveEdit()}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="milon-desk-btn ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null);
                        setDraft("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="agent-bot-rules-text">{row.rule_text}</p>
                  <p className="milon-desk-hint">
                    {row.client_id ? "Client rule" : "Firm-wide"} · {row.task_type}
                  </p>
                  <div className="milon-desk-actions">
                    <button type="button" className="milon-desk-btn outline" disabled={busy} onClick={() => startEdit(row)}>
                      Edit
                    </button>
                    <button type="button" className="milon-desk-btn ghost" disabled={busy} onClick={() => void remove(row)}>
                      Retire
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
