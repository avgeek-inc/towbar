"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ButtonLink } from "@avgeek-oss/design-system/buttons/button";
import { Alert } from "@avgeek-oss/design-system/feedback/alert";
import { QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { AuthFrame, AuthBrand } from "./auth-frame";
import { McpAuthorization } from "@avgeek-oss/design-system";
import { McpClientLogo } from "./mcp-client-logo";
import { config } from "@/lib/config";
import { api } from "@/lib/api";
import { ReauthenticationDialog } from "./reauthentication-dialog";

type Consent = {
  clientName: string;
  clientId: string;
  clientLogo: string | null;
  clientTrust: "metadata-document" | "unverified";
  redirectUri: string;
  scope: string;
  user: {
    name: string;
    email: string;
    teamName?: string;
    role: string;
    twoFactorEnabled: boolean;
  };
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
  const endpoint = `${config.apiBaseUrl}/v1/oauth/consent/${encodeURIComponent(id ?? "")}`;
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
      const body = await api.post<{ redirectTo: string }>(
        new URL(endpoint).pathname,
        { allow },
      );
      window.location.assign(body.redirectTo);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to connect this app",
      );
      setBusy(false);
    }
  }
  const write = details?.scope.includes("mcp:write");
  const admin = details?.scope.includes("mcp:admin");
  if (details && !login)
    return (
      <>
        <ReauthenticationDialog
          twoFactorEnabled={details.user.twoFactorEnabled}
        />
        <McpAuthorization
          brand={<AuthBrand />}
          productName="Towbar"
          isPending={busy}
          error={error}
          approvalBlockedReason={
            admin && details.user.role !== "admin"
              ? "Only an Administrator can grant administrative access. Reconnect with a lower access level."
              : write && details.user.role === "viewer"
                ? "Your Viewer role cannot grant edit access. Reconnect with read-only access."
                : undefined
          }
          onAllow={() => void decide(true)}
          onDeny={() => void decide(false)}
          details={{
            ...details,
            clientLogo: (
              <McpClientLogo client={details.clientLogo ?? "unknown"} />
            ),
            account: details.user,
            permissionSummary: admin
              ? "Wants administrative access to Towbar."
              : `Wants to ${write ? "read and edit" : "read"} your Towbar data.`,
            accessDescription: `${admin ? "Can deploy and operate services, sync repositories, manage servers, change secrets, and create or restore backups. These actions can change or remove infrastructure." : write ? "Can view and make changes allowed by your Towbar role, including updating secrets." : "Can only view data allowed by your Towbar role."} Cannot manage accounts, open SSH terminals, or reveal stored credentials.`,
            accessLifetime: "30 days",
            revocationDescription:
              "Revoke it anytime in Account Settings → MCP Connections.",
            restrictions: admin
              ? "Only your approved permissions are granted. They remain limited by your current team role. Confirm your identity if prompted."
              : "Administrative access is excluded.",
            identityDescription:
              details.clientTrust === "metadata-document"
                ? `App details published by ${new URL(details.clientId).hostname}. This does not verify the app making this request.`
                : "The app supplied its own name. Towbar has not verified its identity.",
            deviceConnectionNotice: [
              "localhost",
              "127.0.0.1",
              "[::1]",
            ].includes(new URL(details.redirectUri).hostname)
              ? "This opens an app on your device. Only continue if you started this connection yourself."
              : undefined,
          }}
        />
      </>
    );
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
        <ButtonLink href={`/login?next=${encodeURIComponent(self)}`}>
          Sign in to continue
        </ButtonLink>
      ) : (
        !error && id && <QueryLoading />
      )}
    </AuthFrame>
  );
}
