"use client";

import { useState } from "react";
import type { TaskRow } from "@/app/admin/(dashboard)/tasks/page";

export default function TasksView({ initialTasks }: { initialTasks: TaskRow[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [filter, setFilter] = useState<"all" | "open" | "completed">("open");
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const visible = tasks.filter((t) =>
    filter === "all" ? true : t.status === filter,
  );

  async function createTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setErrorMsg(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const payload = {
      title: String(fd.get("title") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      priority: String(fd.get("priority") || "normal"),
    };
    if (!payload.title) {
      setErrorMsg("Title is required.");
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not create task.");
        setCreating(false);
        return;
      }
      // Optimistic insert
      const newTask: TaskRow = {
        id: body.taskId,
        title: payload.title,
        description: payload.description || null,
        status: "open",
        priority: payload.priority as TaskRow["priority"],
        dueAt: null,
        createdAt: new Date(),
        leadId: null,
      };
      setTasks((prev) => [newTask, ...prev]);
      formEl.reset();
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setCreating(false);
    }
  }

  async function complete(id: string) {
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) return;
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: "completed" } : t)),
      );
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <form
        onSubmit={createTask}
        className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 md:col-span-1"
      >
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          New task
        </h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Title
            </span>
            <input
              name="title"
              required
              maxLength={200}
              placeholder="Follow up with..."
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Notes (optional)
            </span>
            <textarea
              name="description"
              rows={3}
              maxLength={2000}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Priority
            </span>
            <select
              name="priority"
              defaultValue="normal"
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          {errorMsg && (
            <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          <button
            type="submit"
            disabled={creating}
            className="btn btn-gold w-full justify-center disabled:cursor-wait disabled:opacity-70"
          >
            {creating ? "Creating..." : "Add task"}
          </button>
        </div>
      </form>

      <div className="md:col-span-2">
        <div className="mb-3 flex gap-2">
          {(["open", "completed", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${
                filter === f
                  ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
                  : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          {visible.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
              {filter === "open"
                ? "No open tasks. Nice."
                : filter === "completed"
                  ? "Nothing completed yet."
                  : "No tasks yet."}
            </div>
          )}
          <ul className="divide-y divide-[var(--color-line)]">
            {visible.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--color-cream-deep)]/30"
              >
                <button
                  onClick={() => t.status === "open" && complete(t.id)}
                  disabled={t.status !== "open"}
                  aria-label={t.status === "completed" ? "Completed" : "Mark complete"}
                  className={`mt-1 h-5 w-5 flex-shrink-0 rounded border ${
                    t.status === "completed"
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-[var(--color-line)] hover:border-[var(--color-gold)]"
                  } flex items-center justify-center`}
                >
                  {t.status === "completed" && (
                    <svg
                      className="h-3 w-3 text-white"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-semibold ${
                      t.status === "completed"
                        ? "text-[var(--color-ink-muted)] line-through"
                        : "text-[var(--color-ink)]"
                    }`}
                  >
                    {t.title}
                  </div>
                  {t.description && (
                    <div className="mt-1 text-xs text-[var(--color-ink-soft)] whitespace-pre-wrap">
                      {t.description}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-ink-muted)]">
                    <PriorityPill priority={t.priority} />
                    {t.createdAt && <span>{t.createdAt.toLocaleDateString()}</span>}
                    {t.leadId && (
                      <a
                        href={`/admin/leads/${t.leadId}`}
                        className="text-[var(--color-teal)] hover:underline"
                      >
                        View lead →
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function PriorityPill({ priority }: { priority: TaskRow["priority"] }) {
  const colors: Record<TaskRow["priority"], string> = {
    low: "bg-gray-100 text-gray-700",
    normal: "bg-[var(--color-teal)]/15 text-[var(--color-teal-deep)]",
    high: "bg-amber-100 text-amber-800",
    urgent: "bg-rose-100 text-rose-800",
  };
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider ${colors[priority]}`}>
      {priority}
    </span>
  );
}
