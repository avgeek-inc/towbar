"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  Button,
  ButtonLink,
} from "@workspace/web-design-system/buttons/button";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Skeleton } from "@workspace/web-design-system/feedback/skeleton";
import { AuthFrame } from "./auth-frame";
import { McpClientLogo } from "./mcp-client-logo";
import { config } from "@/lib/config";

type Consent = {
  clientName: string;
  clientId: string;
  clientLogo: string | null;
  clientTrust: "metadata-document" | "unverified";
  redirectUri: string;
  scope: string;
  user: { name: string; email: string; teamName?: string; role: string };
};
export function McpOAuthConsent() {
  const id = useSearchParams().get("request");
  return <ConsentRequest key={id} id={id} />;
}
function ConsentRequest({ id }: { id: string | null }) {
  const [details, setDetails] = useState<Consent>();
  const [error, setError] = useState<string>();
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const endpoint = `${config.appBaseUrl}/v1/oauth/consent/${encodeURIComponent(id ?? "")}`;
  const self = `/oauth/consent?request=${encodeURIComponent(id ?? "")}`;
  useEffect(() => {
    const controller = new AbortController();
    if (!id) return;
    void fetch(endpoint, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          setLogin(true);
          return;
        }
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error_description ?? "Unable to load authorization",
          );
        setDetails(body);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load authorization",
          );
      });
    return () => controller.abort();
  }, [endpoint, id]);
  async function decide(allow: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error_description ?? "Unable to authorize this client",
        );
      window.location.assign(body.redirectTo);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to authorize this client",
      );
      setBusy(false);
    }
  }
  const write = details?.scope.includes("mcp:write");
  return (
    <AuthFrame
      title="Connect to Towbar"
      description="Review the MCP client and the access you want to give it."
    >
      {(error || !id) && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              {error ??
                "This authorization link is incomplete. Connect again from your MCP client."}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {login ? (
        <ButtonLink href={`/login?next=${encodeURIComponent(self)}`}>
          Sign in to continue
        </ButtonLink>
      ) : details ? (
        <form
          className="grid gap-6"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void decide(true);
          }}
        >
          <div className="grid gap-2">
            <div className="flex items-center gap-3">
              <McpClientLogo client={details.clientLogo ?? "unknown"} />
              <span className="font-medium">{details.clientName}</span>
            </div>
            <p className="text-sm text-muted">
              {details.clientTrust === "metadata-document"
                ? `Metadata published by ${new URL(details.clientId).hostname}. This does not verify the running app.`
                : "Unverified client. Its name was supplied during registration."}
            </p>
            <p className="break-all text-sm text-muted">
              Client ID: {details.clientId}
            </p>
          </div>
          <div className="grid gap-2 text-sm">
            <p>
              Signed in as <strong>{details.user.email}</strong>
              {details.user.teamName ? ` in ${details.user.teamName}` : ""}.
            </p>
            <p>
              {write
                ? "Read and edit resources allowed by your current Towbar role. This includes operational changes and available secret updates."
                : "Read resources allowed by your current Towbar role."}{" "}
              Administrative access is excluded.
            </p>
            <p>
              This creates an MCP token that expires in <strong>30 days</strong>
              . Revoke it anytime in your personal API keys.
            </p>
            <p>
              Return to <strong>{new URL(details.redirectUri).host}</strong>
            </p>
            <p className="break-all text-muted">{details.redirectUri}</p>
            {["localhost", "127.0.0.1", "[::1]"].includes(
              new URL(details.redirectUri).hostname,
            ) && (
              <p className="text-muted">
                This callback opens a local app. Continue only if you started
                this connection from an app you trust.
              </p>
            )}
          </div>
          {write && details.user.role === "viewer" && (
            <p role="alert" className="text-sm text-danger">
              Your Viewer role cannot grant edit access. Reconnect with
              read-only access.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              isDisabled={busy || (write && details.user.role === "viewer")}
              isPending={busy}
            >
              Allow access
            </Button>
            <Button
              type="button"
              variant="secondary"
              isDisabled={busy}
              onPress={() => void decide(false)}
            >
              Deny
            </Button>
          </div>
        </form>
      ) : (
        !error &&
        id && (
          <Skeleton
            aria-label="Loading authorization"
            role="status"
            className="h-48 w-full rounded-xl"
          />
        )
      )}
    </AuthFrame>
  );
}
