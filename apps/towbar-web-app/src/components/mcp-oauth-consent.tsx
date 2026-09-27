"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  Button,
  ButtonLink,
} from "@workspace/web-design-system/buttons/button";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Skeleton } from "@workspace/web-design-system/feedback/skeleton";
import { AuthFrame, authTextActionClassName } from "./auth-frame";
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
            body.error_description ?? "Unable to load this connection",
          );
        setDetails(body);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load this connection",
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
        throw new Error(body.error_description ?? "Unable to connect this app");
      window.location.assign(body.redirectTo);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to connect this app",
      );
      setBusy(false);
    }
  }
  const write = details?.scope.includes("mcp:write");
  return (
    <AuthFrame
      title="Connect to Towbar"
      description="Choose whether to give this app access."
    >
      {(error || !id) && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              {error ??
                "This connection link is incomplete. Start again from your app."}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {login ? (
        <ButtonLink
          className="w-fit"
          href={`/login?next=${encodeURIComponent(self)}`}
        >
          Sign in to continue
        </ButtonLink>
      ) : details ? (
        <form
          className="grid gap-6 pt-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void decide(true);
          }}
        >
          <div className="grid gap-2">
            <div className="flex min-w-0 items-center gap-2 text-sm/5">
              <McpClientLogo client={details.clientLogo ?? "unknown"} />
              <span className="min-w-0 break-words text-base/5 font-medium">
                {details.clientName}
              </span>
            </div>
            <p className="text-sm text-muted">
              Wants to {write ? "read and edit" : "read"} your Towbar data.
            </p>
          </div>
          {details.clientTrust === "unverified" && (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Unverified app. Only continue if you recognize this app and
                  started this connection yourself.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          <div className="grid gap-3 text-sm">
            <p>
              Signed in as{" "}
              <strong className="break-all">{details.user.email}</strong>
              {details.user.teamName ? ` in ${details.user.teamName}` : ""}.
            </p>
            <p>
              {write
                ? "Can view and make changes allowed by your Towbar role, including updating secrets."
                : "Can only view data allowed by your Towbar role."}{" "}
              Cannot manage accounts or reveal stored credentials.
            </p>
            <p>
              Access expires in <strong>30 days</strong>. Revoke it anytime in
              your personal API keys.
            </p>
            {["localhost", "127.0.0.1", "[::1]"].includes(
              new URL(details.redirectUri).hostname,
            ) && (
              <p className="text-muted">
                This opens an app on your device. Only continue if you started
                this connection yourself.
              </p>
            )}
          </div>
          <details className="text-sm">
            <summary
              className={`${authTextActionClassName} w-fit cursor-pointer`}
            >
              Connection details
            </summary>
            <div className="grid gap-3 pt-2 text-muted">
              <p>
                {details.clientTrust === "metadata-document"
                  ? `App details published by ${new URL(details.clientId).hostname}. This does not verify the app making this request.`
                  : "The app supplied its own name. Towbar has not verified its identity."}
              </p>
              <p>
                <span className="font-medium">Client ID</span>
                <span className="block break-words">{details.clientId}</span>
              </p>
              <p>
                <span className="font-medium">Return URL</span>
                <span className="block break-words">{details.redirectUri}</span>
              </p>
              <p>Administrative access is excluded.</p>
            </div>
          </details>
          {write && details.user.role === "viewer" && (
            <p role="alert" className="text-sm text-danger">
              Your Viewer role cannot grant edit access. Reconnect with
              read-only access.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
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
            aria-label="Loading connection"
            role="status"
            className="h-48 w-full rounded-xl"
          />
        )
      )}
    </AuthFrame>
  );
}
