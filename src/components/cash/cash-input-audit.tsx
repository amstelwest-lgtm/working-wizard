import { Check, Pencil } from "lucide-react";
import {
  CASH_AUDIT_STATUS_LABEL,
  cashAuditStatus,
  type CashAuditGroup,
  type CashAuditRow,
  type CashInputAudit,
} from "@/lib/cash-input-audit";

const GROUP_LABEL: Record<CashAuditGroup, string> = {
  setup: "Forecast setup",
  line: "Forecast lines",
  source: "Data sources",
  assumption: "Engine assumptions",
};

const GROUP_ORDER: CashAuditGroup[] = ["setup", "line", "source", "assumption"];

function rowInitials(
  status: ReturnType<typeof cashAuditStatus>,
  approval: CashInputAudit[string] | undefined,
  viewerId: string | null,
  viewerInitials: string,
): string {
  if (status !== "approved" || !approval) return "";
  const stored = approval.initials?.trim() ?? "";
  if (stored) return stored;
  if (viewerId && approval.approvedBy === viewerId && viewerInitials.trim())
    return viewerInitials.trim();
  return "";
}

export function CashInputAuditTable({
  rows,
  audit,
  canApprove,
  saving = false,
  approvedOn,
  viewerId = null,
  viewerInitials = "",
  onApprove,
  onApproveAll,
  onUnapprove,
  onEdit,
}: {
  rows: readonly CashAuditRow[];
  audit: CashInputAudit;
  canApprove: boolean;
  saving?: boolean;
  approvedOn: (iso: string) => string;
  /** Current user. Their initials fill a stamp that was saved before initials were stored. */
  viewerId?: string | null;
  viewerInitials?: string;
  onApprove: (key: string) => void;
  onApproveAll: () => void;
  onUnapprove: (key: string) => void;
  onEdit: (row: CashAuditRow) => void;
}) {
  const pending = rows.filter((row) => cashAuditStatus(row, audit) !== "approved").length;
  return (
    <div className="cash-audit" data-cash-audit="">
      <div className="cash-audit__bar">
        <p className="cash-audit__count" role="status">
          {pending === 0 ? "Every input is approved." : `${pending} of ${rows.length} to approve`}
        </p>
        {canApprove ? (
          <button
            type="button"
            className="cash-audit__approve-all"
            disabled={pending === 0 || saving}
            onClick={onApproveAll}
          >
            Approve all remaining
          </button>
        ) : null}
      </div>
      <div className="forecast-lines__scroll">
        <table className="cash-audit__table">
          <thead>
            <tr>
              <th scope="col">Input</th>
              <th scope="col">Value</th>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {GROUP_ORDER.map((group) => {
            const groupRows = rows.filter((row) => row.group === group);
            if (!groupRows.length) return null;
            return (
              <tbody key={group} data-cash-audit-group={group}>
                <tr className="cash-audit__group">
                  <th scope="rowgroup" colSpan={5}>
                    {GROUP_LABEL[group]}
                  </th>
                </tr>
                {groupRows.map((row) => {
                  const status = cashAuditStatus(row, audit);
                  const approval = audit[row.key];
                  const initials = rowInitials(status, approval, viewerId, viewerInitials);
                  return (
                    <tr key={row.key} data-cash-audit-row={row.key} data-status={status}>
                      <td data-label="Input" className="cash-audit__label">
                        {row.label}
                      </td>
                      <td data-label="Value">{row.value}</td>
                      <td data-label="Source">
                        {row.source ? <span className="cash-audit__chip">{row.source}</span> : "—"}
                      </td>
                      <td data-label="Status">
                        <span
                          className="cash-audit__status"
                          data-status={status}
                          title={
                            approval && status === "approved"
                              ? `Approved ${approvedOn(approval.approvedAt)}`
                              : undefined
                          }
                        >
                          {initials ? (
                            <span className="cash-audit__initials" data-cash-audit-initials="">
                              {initials}
                            </span>
                          ) : null}
                          {status === "approved" ? (
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : null}
                          {CASH_AUDIT_STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="cash-audit__actions">
                        {canApprove && status !== "approved" ? (
                          <button
                            type="button"
                            className="cash-audit__approve"
                            disabled={saving}
                            aria-label={`Approve ${row.label}`}
                            onClick={() => onApprove(row.key)}
                          >
                            Approve
                          </button>
                        ) : null}
                        {canApprove && status === "approved" ? (
                          <button
                            type="button"
                            className="cash-audit__unapprove"
                            disabled={saving}
                            aria-label={`Unapprove ${row.label}`}
                            onClick={() => onUnapprove(row.key)}
                          >
                            Unapprove
                          </button>
                        ) : null}
                        {row.group === "source" ? null : (
                          <button
                            type="button"
                            className={`cash-audit__edit${status === "approved" ? " cash-audit__edit--text" : ""}`}
                            aria-label={`${status === "approved" ? "Adjust" : "Edit"} ${row.label}`}
                            title={status === "approved" ? "Adjust" : "Edit"}
                            onClick={() => onEdit(row)}
                          >
                            {status === "approved" ? (
                              "Adjust"
                            ) : (
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
