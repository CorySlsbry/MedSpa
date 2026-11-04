import type { Metadata } from "next";
import ConsentSignFlow from "@/components/consent/ConsentSignFlow";

export const metadata: Metadata = {
  title: "Sign consent",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConsentSignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ConsentSignFlow token={token} />;
}
