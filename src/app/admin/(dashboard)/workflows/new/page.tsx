import type { Metadata } from "next";
import Link from "next/link";
import NewWorkflowForm from "@/components/admin/NewWorkflowForm";

export const metadata: Metadata = {
  title: "Admin · New workflow",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function NewWorkflowPage() {
  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/workflows"
        className="text-sm text-[var(--color-teal)] hover:underline"
      >
        ← All workflows
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        New workflow
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Define the trigger tag + the sequence of steps. Tag-only workflows are
        valid (zero steps) — useful for routing leads into the external
        email-runner without doing anything else inside Aesthera.
      </p>
      <div className="mt-6">
        <NewWorkflowForm />
      </div>
    </div>
  );
}
