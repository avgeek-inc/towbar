"use client";

import { useEffect, useRef } from "react";
import { Spinner } from "@workspace/web-design-system/feedback/spinner";

import { clearApiQueryCache } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function Logout() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    clearApiQueryCache();
    api
      .delete("/v1/core/session")
      .catch(() => undefined)
      .finally(() => window.location.replace("/login"));
  }, []);

  return (
    <div className="grid place-items-center py-12" aria-busy="true">
      <Spinner aria-label="Signing out of Towbar" />
    </div>
  );
}
