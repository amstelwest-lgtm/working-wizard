/**
 * Fixture proof of the action suggestions. The rows are not a client file.
 */
import { useState } from "react";
import { ActionPlanAutomation } from "@/components/action-plan-automation";
import { planAutomation, type AutomationItem } from "@/lib/action-plan-automation";

const TODAY = "2026-10-15";
const TEAM = [{ id: "p2", name: "Naledi Khumalo" }];

const FIXTURE: AutomationItem[] = [
  {
    id: "cash",
    title: "Chase the overdue invoices",
    ownerId: null,
    ownerName: null,
    dueDate: null,
    status: "not_started",
    createdAt: "2026-10-01T08:00:00.000Z",
  },
  {
    id: "dated",
    title: "File the VAT return",
    ownerId: "p2",
    ownerName: "Naledi Khumalo",
    dueDate: "2026-10-01",
    status: "in_progress",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "dup-old",
    title: "Raise price on the retainer",
    ownerId: null,
    ownerName: null,
    dueDate: "2026-10-20",
    status: "not_started",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "dup-new",
    title: "Raise price on the retainer",
    ownerId: null,
    ownerName: null,
    dueDate: "2026-10-20",
    status: "not_started",
    createdAt: "2026-10-02T00:00:00.000Z",
  },
  {
    id: "cut",
    title: "Cut price on the workshop",
    ownerId: null,
    ownerName: null,
    dueDate: "2026-10-22",
    status: "not_started",
    createdAt: "2026-10-03T00:00:00.000Z",
  },
];

export function ActionPlanPreview() {
  const [dropped, setDropped] = useState<string[]>([]);
  const live = FIXTURE.filter((row) => !dropped.includes(row.id));
  const plan = planAutomation(live, TEAM, TODAY);
  return (
    <div className="min-h-screen bg-[#F4F7FB] p-4 text-[#102A43]" data-action-preview="true">
      <p className="mb-3 text-xs uppercase tracking-[0.16em]">Fixture proof — not a client file</p>
      <ActionPlanAutomation
        rows={plan.rows}
        duplicates={plan.duplicates}
        contradictions={plan.contradictions}
        canEdit
        onConfirm={() => {}}
        onDrop={(id) => setDropped((current) => [...current, id])}
      />
    </div>
  );
}
