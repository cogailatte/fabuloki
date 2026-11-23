"use client";

import type { ReactNode } from "react";
import { Banner } from "@/components/Banner";

export function ErrorBanner({
  message,
  detail,
  actions,
}: {
  message: ReactNode;
  detail?: string;
  actions?: ReactNode;
}) {
  return <Banner tone="danger" message={message} detail={detail} actions={actions} />;
}
