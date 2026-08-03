import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Check, Trash2, UserPlus, Mail } from "lucide-react";
import { toast } from "sonner";
import { sendTransactionalEmail } from "@/lib/email/send";

type Employee = {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  role: string | null;
  active: boolean;
};

type Task = {
  id: string;
  client_id: string;
  employee_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "open" | "done" | "skipped";
  source: string;
  created_at: string;
  completed_at: string | null;
};

interface Props {
  clientId: string;
  clientName?: string;
  /** Read-only mode for customers viewing their own tasks (no assign UI). */
  readOnly?: boolean;
}

export function TasksPanel({ clientId, clientName, readOnly = false }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // New employee form
  const [newEmpOpen, setNewEmpOpen] = useState(false);
  const [empName, setEmpName] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empRole, setEmpRole] = useState("");

  // New task form
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskAssignee, setTaskAssignee] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const [{ data: emps }, { data: tks }] = await Promise.all([
      supabase.from("client_employees").select("*").eq("client_id", clientId).order("created_at"),
      supabase.from("employee_tasks").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    ]);
    setEmployees((emps ?? []) as Employee[]);
    setTasks((tks ?? []) as Task[]);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, [clientId]);

  const employeeById = useMemo(() => {
    const m = new Map<string, Employee>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const addEmployee = async () => {
    if (!empName.trim()) return;
    const { error } = await supabase.from("client_employees").insert({
      client_id: clientId,
      name: empName.trim(),
      email: empEmail.trim() || null,
      role: empRole.trim() || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Team member added");
    setEmpName(""); setEmpEmail(""); setEmpRole("");
    setNewEmpOpen(false);
    refresh();
  };

  const removeEmployee = async (id: string) => {
    if (!confirm("Remove this team member?")) return;
    const { error } = await supabase.from("client_employees").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const createTask = async () => {
    if (!taskTitle.trim() || !taskAssignee) {
      toast.error("Title and assignee required");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("employee_tasks")
        .insert({
          client_id: clientId,
          employee_id: taskAssignee,
          title: taskTitle.trim(),
          description: taskDesc.trim() || null,
          due_date: taskDue || null,
          source: "manual",
          status: "open",
        })
        .select()
        .single();
      if (error) throw error;

      const emp = employeeById.get(taskAssignee);
      if (emp?.email) {
        try {
          const { data: u } = await supabase.auth.getUser();
          await sendTransactionalEmail({
            templateName: "task-assigned",
            recipientEmail: emp.email,
            idempotencyKey: `task-assigned-${data.id}`,
            templateData: {
              employeeName: emp.name,
              taskTitle: taskTitle.trim(),
              taskDescription: taskDesc.trim() || undefined,
              dueDate: taskDue || undefined,
              assignedBy: u.user?.email ?? undefined,
              clientName,
            },
          });
          toast.success(`Task assigned & emailed to ${emp.name}`);
        } catch (e: any) {
          toast.warning(`Task created — email failed: ${e.message ?? e}`);
        }
      } else {
        toast.success(`Task assigned to ${emp?.name ?? "team member"}`);
      }

      setTaskTitle(""); setTaskDesc(""); setTaskDue(""); setTaskAssignee("");
      setNewTaskOpen(false);
      refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const completeTask = async (id: string) => {
    const { error } = await supabase
      .from("employee_tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const deleteTask = async (id: string) => {
    if (!confirm("Delete this task?")) return;
    const { error } = await supabase.from("employee_tasks").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-4">
      {!readOnly && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Team Members</CardTitle>
            <Dialog open={newEmpOpen} onOpenChange={setNewEmpOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline"><UserPlus className="h-4 w-4 mr-1" />Add</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add team member</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name</Label><Input value={empName} onChange={(e) => setEmpName(e.target.value)} /></div>
                  <div><Label>Email (for task notifications)</Label><Input type="email" value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} /></div>
                  <div><Label>Role</Label><Input value={empRole} onChange={(e) => setEmpRole(e.target.value)} placeholder="e.g. Bookkeeper" /></div>
                </div>
                <DialogFooter><Button onClick={addEmployee}>Add member</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No team members yet.</p>
            ) : (
              <ul className="divide-y">
                {employees.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">{e.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.role ?? "—"}{e.email ? ` · ${e.email}` : ""}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removeEmployee(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">
            Tasks {open.length > 0 && <Badge variant="secondary" className="ml-2">{open.length} open</Badge>}
          </CardTitle>
          {!readOnly && (
            <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={employees.length === 0}>
                  <Plus className="h-4 w-4 mr-1" />New task
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Assign new task</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Assign to</Label>
                    <Select value={taskAssignee} onValueChange={setTaskAssignee}>
                      <SelectTrigger><SelectValue placeholder="Choose team member" /></SelectTrigger>
                      <SelectContent>
                        {employees.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name}{e.email ? ` (${e.email})` : " (no email)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Title</Label><Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} /></div>
                  <div><Label>Description</Label><Textarea value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} rows={3} /></div>
                  <div><Label>Due date</Label><Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} /></div>
                  {taskAssignee && !employeeById.get(taskAssignee)?.email && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <Mail className="h-3 w-3" /> No email — task will be created without notification.
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button onClick={createTask} disabled={submitting}>
                    {submitting ? "Creating…" : "Assign task"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {readOnly ? "No tasks assigned." : "No tasks yet. Add team members and assign your first task."}
            </p>
          ) : (
            <>
              {open.map((t) => (
                <TaskRow key={t.id} task={t} assignee={employeeById.get(t.employee_id)} onComplete={completeTask} onDelete={readOnly ? undefined : deleteTask} />
              ))}
              {done.length > 0 && (
                <div className="pt-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Completed</p>
                  {done.slice(0, 5).map((t) => (
                    <TaskRow key={t.id} task={t} assignee={employeeById.get(t.employee_id)} dimmed onDelete={readOnly ? undefined : deleteTask} />
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TaskRow({
  task, assignee, dimmed, onComplete, onDelete,
}: {
  task: Task;
  assignee?: Employee;
  dimmed?: boolean;
  onComplete?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className={`flex items-start justify-between gap-2 rounded-md border p-3 ${dimmed ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{task.title}</div>
        {task.description && <div className="text-xs text-muted-foreground mt-0.5">{task.description}</div>}
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
          <span>Assigned to <strong>{assignee?.name ?? "—"}</strong></span>
          {task.due_date && <span>Due {new Date(task.due_date).toLocaleDateString()}</span>}
          {task.source !== "manual" && <Badge variant="outline" className="text-[10px]">{task.source}</Badge>}
        </div>
      </div>
      <div className="flex gap-1">
        {onComplete && task.status === "open" && (
          <Button size="sm" variant="ghost" onClick={() => onComplete(task.id)} title="Mark done">
            <Check className="h-4 w-4" />
          </Button>
        )}
        {onDelete && (
          <Button size="sm" variant="ghost" onClick={() => onDelete(task.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
