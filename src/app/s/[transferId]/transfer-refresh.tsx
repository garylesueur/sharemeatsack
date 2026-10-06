"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function TransferRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
