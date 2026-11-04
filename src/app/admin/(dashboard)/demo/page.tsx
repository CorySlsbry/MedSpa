import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth-server";
import DemoModeView from "@/components/admin/DemoModeView";

export const metadata: Metadata = {
  title: "Admin · Demo mode",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Demo Mode launcher. Provisions a fully-populated mock Med Spa
 * tenant on the enterprise tier so super-admin can preview-as any role
 * and see real KPIs / calendars / leads / ad metrics. The actual
 * seeding + teardown happens on the API; this page is the control
 * surface.
 */
export default async function DemoModePage() {
  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") return null;
  return <DemoModeView />;
}
