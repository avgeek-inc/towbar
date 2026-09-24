"use client";
import { FieldDescription } from "@workspace/web-design-system/forms/field";
import Image from "next/image";
import QRCode from "qrcode";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { CodeBlock } from "@workspace/web-design-system/typography/code-block";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { PasskeySettings } from "./passkey-settings";
import { FormCard, ActionButton } from "./page-parts";
import { AuthForm } from "./auth-form";
import { useAccess } from "./access-context";
import { api } from "@/lib/api";
export function SecuritySettings() {
  const { user } = useAccess();
  const [setup, setSetup] = useState<{
    uri: string;
    qr: string;
    backupCodes: string[];
  } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [mode, setMode] = useState<"idle" | "disable" | "recovery">("idle");
  const changed = () => {
    window.dispatchEvent(new Event("towbar:identity-changed"));
    setMode("idle");
  };
  if (!user) return null;
  return (
    <div className="content-grid lg:grid-cols-2 lg:items-start">
      <FormCard
        title="Authenticator app"
        icon={<HugeiconsIcon icon={SecurityCheckIcon} />}
        headerEnd={
          <StatusBadge
            status={user.twoFactorEnabled ? "healthy" : "disabled"}
            label={user.twoFactorEnabled ? "MFA enabled" : "Not enabled"}
            tooltip={
              user.twoFactorEnabled
                ? "Your authenticator app is enabled for sign-in."
                : "Set up an authenticator app to enable two-factor authentication."
            }
          />
        }
      >
        <div className="content-grid">
          <FieldDescription>
            An authenticator app adds a one-time code to your password when you
            sign in. Recommended for admins.
          </FieldDescription>
          {setup ? (
            <>
              <FieldDescription>
                Scan this QR code with your authenticator app.
              </FieldDescription>
              <Image
                src={setup.qr}
                alt="Authenticator setup QR code"
                width={192}
                height={192}
                unoptimized
              />
              <div className="content-grid gap-2">
                <CodeBlock>
                  <CodeBlock.Header>
                    <CodeBlock.Filename>Setup key</CodeBlock.Filename>
                    <CodeBlock.CopyButton
                      code={new URL(setup.uri).searchParams.get("secret") ?? ""}
                    />
                  </CodeBlock.Header>
                  <CodeBlock.Code
                    code={new URL(setup.uri).searchParams.get("secret") ?? ""}
                  />
                </CodeBlock>
              </div>
              <AuthForm
                variant="secondary"
                fields={[
                  {
                    name: "code",
                    label: "Authenticator code",
                    autoComplete: "one-time-code",
                    required: true,
                    maxLength: 6,
                  },
                ]}
                submitLabel="Enable MFA"
                cancelLabel="Cancel setup"
                onCancel={() => {
                  setSetup(null);
                  setMode("idle");
                }}
                onSubmit={async (values) => {
                  await api.post(
                    "/v1/public/auth/identity/two-factor/verify-totp",
                    values,
                  );
                  setCodes(setup.backupCodes);
                  setSetup(null);
                  changed();
                }}
              />
            </>
          ) : mode !== "idle" ? (
            <AuthForm
              variant="secondary"
              key={mode}
              fields={[
                {
                  name: "code",
                  label: "Authenticator code",
                  autoComplete: "one-time-code",
                  required: true,
                  maxLength: 6,
                },
              ]}
              submitLabel={
                mode === "disable" ? "Disable MFA" : "Generate recovery codes"
              }
              onCancel={() => setMode("idle")}
              onSubmit={async (values) => {
                const result = await api.post<{ backupCodes: string[] }>(
                  "/v1/core/profile/two-factor/manage",
                  { code: values.code, action: mode },
                );
                setCodes(result.backupCodes);
                changed();
              }}
            >
              <FieldDescription>
                {mode === "disable"
                  ? "Future sign-ins will use only your password."
                  : "Your previous recovery codes will stop working."}
              </FieldDescription>
            </AuthForm>
          ) : (
            <div className="flex flex-wrap gap-3">
              {user.twoFactorEnabled ? (
                <>
                  <Button
                    variant="secondary"
                    onPress={() => setMode("recovery")}
                  >
                    Replace recovery codes
                  </Button>
                  <Button variant="danger" onPress={() => setMode("disable")}>
                    Disable MFA
                  </Button>
                </>
              ) : (
                <ActionButton
                  variant="primary"
                  success="Scan the QR code to continue"
                  action={async () => {
                    const result = await api.post<{
                      totpURI: string;
                      backupCodes: string[];
                    }>("/v1/core/profile/two-factor/setup", {});
                    setSetup({
                      uri: result.totpURI,
                      qr: await QRCode.toDataURL(result.totpURI, {
                        width: 192,
                        margin: 2,
                      }),
                      backupCodes: result.backupCodes,
                    });
                  }}
                >
                  Set up authenticator
                </ActionButton>
              )}
            </div>
          )}
          {codes.length > 0 ? (
            <div className="content-grid">
              <h3 className="font-medium">Save your recovery codes</h3>
              <p className="text-muted text-sm">
                Each code can be used once if you lose access to your
                authenticator. Store them in a password manager.
              </p>
              <CodeBlock>
                <CodeBlock.Header>
                  <CodeBlock.Filename>Recovery codes</CodeBlock.Filename>
                  <CodeBlock.CopyButton code={codes.join("\n")} />
                </CodeBlock.Header>
                <CodeBlock.Code code={codes.join("\n")} />
              </CodeBlock>
              <Button variant="secondary" onPress={() => setCodes([])}>
                I saved my codes
              </Button>
            </div>
          ) : null}
        </div>
      </FormCard>
      <PasskeySettings />
    </div>
  );
}
