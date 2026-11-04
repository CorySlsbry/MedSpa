import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import EmbedBookingFlow from "@/components/embed/EmbedBookingFlow";

export const metadata: Metadata = {
  title: "Book an appointment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function EmbedBookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getTenant(slug);
  if (!tenant) notFound();
  if (tenant.subscription_status === "cancelled") {
    return (
      <main className="min-h-screen bg-white p-8 text-center font-display text-[var(--color-ink-muted)]">
        Booking is currently unavailable for this clinic.
      </main>
    );
  }

  return (
    <EmbedBookingFlow
      slug={tenant.id}
      tenantName={tenant.name}
      primaryColor={tenant.primary_color}
      logoUrl={tenant.logo_url}
    />
  );
}
