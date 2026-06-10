import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserPlus, Mail } from "lucide-react";
import { toast } from "sonner";
import { sendTransactionalEmail } from "@/lib/email/send";

type Employee = { id: string; name: string; email: string | null };

interface Props {
  clientId: string | null | undefined;
  clientName?: string;
  source: "kpi" | "improvement" | "cashflow_line" | "manual";
  sourceRef?: string;
  defaultTitle: string;
  defaultDescription?: string;
  /** Optional render — if given, controls the trigger element. */
  trigger?: React.ReactNode;
  /** Visual size for default trigger. */
  size?: "xs" | "sm";
}

export function AssignButton({
  clientId,
  clientName,
  source,
  sourceRef,
  defaultTitle,
  defaultDescription,
  trigger,
  size = "xs",
}: Props) {
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // form
  const [assignee, setAssignee] = useState<string>("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription ?? "");
  const [due, setDue] = useState("");

  // inline add member
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const loadEmployees = async () => {
    if (!clientId) return;
    setLoading(true);
    const { data } = await supabase
      .from("client_employees")
      .select("id, name, email")
      .eq("client_id", clientId)
      .eq("active", true)
      .order("created_at");
    setEmployees((data ?? []) as Employee[]);
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setDescription(defaultDescription ?? "");
      setDue("");
      setAssignee("");
      setAddingNew(false);
      loadEmployees();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId]);

  const addNewEmployee = async () => {
    if (!clientId || !newName.trim()) return;
    const { data, error } = await supabase
      .from("client_employees")
      .insert({ client_id: clientId, name: newName.trim(), email: newEmail.trim() || null })
      .select("id, name, email")
      .single();
    if (error) { toast.error(error.message); return; }
    const emp = data as Employee;
    setEmployees((p) => [...p, emp]);
    setAssignee(emp.id);
    setNewName(""); setNewEmail(""); setAddingNew(false);
  };

  const submit = async () => {
    if (!clientId) { toast.error("No client linked"); return; }
    if (!title.trim() || !assignee) {
      toast.error("Pick a team member and give it a title");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("employee_tasks")
        .insert({
          client_id: clientId,
          employee_id: assignee,
          title: title.trim(),
          description: description.trim() || null,
          due_date: due || null,
          source,
          source_ref: sourceRef ?? null,
          status: "open",
        })
        .select()
        .single();
      if (error) throw error;

      const emp = employees.find((e) => e.id === assignee);
      if (emp?.email) {
        try {
          const { data: u } = await supabase.auth.getUser();
          await sendTransactionalEmail({
            templateName: "task-assigned",
            recipientEmail: emp.email,
            idempotencyKey: `task-assigned-${data.id}`,
            templateData: {
              employeeName: emp.name,
              taskTitle: title.trim(),
              taskDescription: description.trim() || undefined,
              dueDate: due || undefined,
              assignedBy: u.user?.email ?? undefined,
              clientName,
            },
          });
          toast.success(`Assigned & emailed to ${emp.name}`);
        } catch (e: any) {
          toast.warning(`Task created — email failed: ${e.message ?? e}`);
        }
      } else {
        toast.success(`Assigned to ${emp?.name ?? "team member"} (no email on file)`);
      }
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to assign task");
    } finally {
      setSubmitting(false);
    }
  };

  const stopAndOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clientId) { toast.error("Link a client first to assign tasks"); return; }
    setOpen(true);
  };

  return (
    <>
      {trigger ? (
        <span onClick={stopAndOpen} className="inline-flex">{trigger}</span>
      ) : (
        <button
          onClick={stopAndOpen}
          title="Assign as task"
          aria-label="Assign as task"
          className={`inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/25 transition ${
            size === "xs" ? "px-1.5 py-1 text-[10px]" : "px-2 py-1 text-xs"
          }`}
        >
          <UserPlus className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} />
          <span className="font-bold uppercase tracking-wider">Assign</span>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onClick={(e) => e.stopPropagation()}
          className="max-w-md"
        >
          <DialogHeader>
            <DialogTitle>Assign task to a team member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Team member</Label>
              {addingNew ? (
                <div className="space-y-2 rounded-md border p-2">
                  <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <Input placeholder="Email (for notifications)" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={addNewEmployee} disabled={!newName.trim()}>Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAddingNew(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Select value={assignee} onValueChange={setAssignee}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={loading ? "Loading…" : employees.length ? "Pick a team member" : "No team members yet"} />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}{e.email ? ` (${e.email})` : " (no email)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => setAddingNew(true)}>
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <Label>Due date (optional)</Label>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            {assignee && !employees.find((e) => e.id === assignee)?.email && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <Mail className="h-3 w-3" /> No email on file — task will be created without notification.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting || !assignee || !title.trim()}>
              {submitting ? "Assigning…" : "Assign & email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
