"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "swayammail_token";

export function LandingRedirect() {
  const router = useRouter();

  useEffect(() => {
    const token = window.localStorage.getItem(STORAGE_KEY);
    if (token) {
      router.replace("/overview");
    }
  }, [router]);

  return null;
}
