import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Outer admin layout — applies to /admin/login and /admin/(dashboard)/*.
 * No auth check here; that lives in the (dashboard) layout and middleware.
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="bg-[var(--color-cream)] min-h-screen">{children}</div>;
}
