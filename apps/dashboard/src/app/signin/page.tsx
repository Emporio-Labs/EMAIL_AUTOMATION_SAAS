"use client";

import React from "react";
import { AuthGate } from "@/components/auth-gate";

export default function SigninPage() {
  // AuthGate will read URL search params to pre-select signup and prefill email
  return <AuthGate>{null}</AuthGate>;
}
