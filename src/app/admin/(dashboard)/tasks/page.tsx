import { db, toDate } from "@/lib/firestore";
import type { TaskDoc, TaskStatus, TaskPriority } from "@/lib/firestore-types";
import TasksView from "@/components/admin/TasksView";

export const dynamic = "force-dynamic";

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  createdAt: Date | null;
  leadId: string | null;
};

async function loadTasks(): Promise<TaskRow[]> {
  const snap = await db()
    .collection("tasks")
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as TaskDoc;
    return {
      id: d.id,
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      dueAt: toDate(data.due_at ?? null),
      createdAt: toDate(data.created_at),
      leadId: data.lead_id,
    };
  });
}

export default async function TasksPage() {
  let rows: TaskRow[];
  try {
    rows = await loadTasks();
  } catch (err) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        Firestore error: {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Tasks
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.filter((r) => r.status === "open").length} open
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Personal follow-up list. Tasks are private to you (the super-admin).
      </p>

      <div className="mt-6">
        <TasksView initialTasks={rows} />
      </div>
    </div>
  );
}
