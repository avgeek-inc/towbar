"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Spinner } from "@workspace/web-design-system/feedback/spinner";

import { api } from "@/lib/api";
import { config } from "@/lib/config";

export function AuthCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const exchanged = useRef(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const authorizationCode = params.get("authorizationCode");
    if (!authorizationCode || exchanged.current) {
      if (!authorizationCode)
        setError("The sign-in response did not include an authorization code.");
      return;
    }
    exchanged.current = true;
    api
      .post("/v1/public/auth/exchange-code", {
        authorizationCode,
        redirectUri: `${config.appBaseUrl}/auth/callback`,
      })
      .then(() => {
        router.replace("/");
        router.refresh();
      })
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not complete sign in",
        ),
      );
  }, [params, router]);
  return (
    <div className="grid place-items-center py-12">
      {error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Sign in failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Spinner aria-label="Completing sign in" />
      )}
    </div>
  );
}
