import {
  Body,
  Button,
  Container,
  Font,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { render, toPlainText } from "react-email";
import {
  isWorkspaceRole,
  roleDescriptions,
  roleLabels,
} from "@workspace/towbar-access";

const emailTheme = {
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  background: "#f5f5f5",
  surface: "#ffffff",
  foreground: "#18181b",
  muted: "#71717a",
  accent: "#856300",
} as const;
const logoSource =
  "https://www.towbar.dev/cdn-cgi/imagedelivery/phvjnb9w1G6QHeeoMJptkQ/brands/towbar/logo/light-transparent-edge/w=128,fit=scale-down,format=png";

export const transactionalTemplates = [
  "invitation",
  "invitation-verification",
  "email-verification",
  "email-change-verification",
  "email-changed",
  "account-created",
  "invitation-accepted",
  "role-changed",
  "access-removed",
  "password-reset",
  "password-changed",
  "mfa-changed",
  "team-key-created",
  "team-key-revoked",
] as const;
export type TransactionalTemplate = (typeof transactionalTemplates)[number];
export type TransactionalEmailData = {
  name?: string;
  teamName: string;
  actionUrl?: string;
  role?: string;
  previousRole?: string;
  keyName?: string;
  verificationCode?: string;
};
type Message = {
  title: string;
  paragraphs: string[];
  teamName: string;
  actionUrl?: string;
  actionLabel?: string;
  code?: string;
};
function message(
  template: TransactionalTemplate,
  data: TransactionalEmailData,
): Message {
  const role = isWorkspaceRole(data.role) ? roleLabels[data.role] : "Member";
  const access = isWorkspaceRole(data.role)
    ? roleDescriptions[data.role]
    : roleDescriptions.member;
  const team = data.teamName;
  const messages: Record<
    TransactionalTemplate,
    Pick<Message, "title" | "paragraphs" | "actionLabel">
  > = {
    invitation: {
      title: `Join ${team}`,
      paragraphs: [
        `You have been invited to ${team} as ${role}.`,
        access,
        "This invitation expires in seven days. Verify your email to join. If you weren't expecting it, you can ignore this message.",
      ],
      actionLabel: "View invitation",
    },
    "invitation-verification": {
      title: "Verify your email",
      paragraphs: [
        "Enter this code in Towbar to finish joining your team. It expires in 10 minutes. If you didn't request it, ignore this email.",
      ],
    },
    "email-verification": {
      title: "Verify your email",
      paragraphs: [
        "Confirm this email address for your Towbar account. This link expires in one hour.",
      ],
      actionLabel: "Verify email",
    },
    "email-change-verification": {
      title: "Confirm your new email address",
      paragraphs: [
        "Confirm this address to update the email you use to sign in to Towbar. Your current email stays active until you confirm.",
        "This link expires in one hour and can be used once. If you did not request this change, ignore this email.",
      ],
      actionLabel: "Confirm email change",
    },
    "email-changed": {
      title: "Your sign-in email was changed",
      paragraphs: [
        "The email address for your Towbar account has been updated. All browser sessions were signed out.",
        "If you did not make this change, contact your team administrator immediately.",
      ],
      actionLabel: "Open Towbar",
    },
    "account-created": {
      title: `Your ${team} account is ready`,
      paragraphs: [
        `An administrator created your account with ${role} access.`,
        access,
        "Ask your administrator for your temporary password through a secure channel. You will choose a new password when you first sign in.",
      ],
      actionLabel: "Sign in",
    },
    "invitation-accepted": {
      title: "A new member joined",
      paragraphs: [
        `${data.name ?? "A team member"} accepted an invitation to ${team} as ${role}.`,
      ],
    },
    "role-changed": {
      title: "Your team access changed",
      paragraphs: [
        `Your role in ${team} is now ${role}.`,
        access,
        "Personal API keys remain limited to their original grants and your current access. Removed permissions are not restored by a later promotion.",
      ],
    },
    "access-removed": {
      title: "Your team access was removed",
      paragraphs: [
        `Your access to ${team} has been removed. Your sessions and personal API keys have been revoked. Contact a team administrator if this was unexpected.`,
      ],
    },
    "password-reset": {
      title: "Reset your password",
      paragraphs: [
        "Use this link to choose a new Towbar password. It expires in one hour and can be used once. If you didn't request a reset, you can ignore this email.",
      ],
      actionLabel: "Reset password",
    },
    "password-changed": {
      title: "Your password changed",
      paragraphs: [
        "Your Towbar password was changed. If you didn't make this change, contact your administrator and recover your account immediately.",
      ],
      actionLabel: "Open account security",
    },
    "mfa-changed": {
      title: "Your account security changed",
      paragraphs: [
        "Your passkey, authenticator, or recovery-code settings were changed. If you didn't make this change, contact your administrator immediately.",
      ],
      actionLabel: "Review account security",
    },
    "team-key-created": {
      title: "Team API key created",
      paragraphs: [
        `A team API key named “${data.keyName ?? "Team key"}” was created for ${team}. Review it in Team Settings if this was unexpected.`,
      ],
    },
    "team-key-revoked": {
      title: "Team API key revoked",
      paragraphs: [
        `The team API key “${data.keyName ?? "Team key"}” was revoked. Automations using it can no longer access ${team}.`,
      ],
    },
  };
  return {
    ...messages[template],
    teamName: team,
    actionUrl: data.actionUrl,
    code:
      template === "invitation-verification"
        ? data.verificationCode
        : undefined,
  };
}
function EmailShell({ message: content }: { message: Message }) {
  const actionUrl = content.actionUrl ? new URL(content.actionUrl) : null;
  if (actionUrl && !["http:", "https:"].includes(actionUrl.protocol))
    throw new Error("Invalid email action URL");
  return (
    <Html lang="en">
      <Head>
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Arial"
          webFont={{
            url: "https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@5.3.0/latin-wght-normal.woff2",
            format: "woff2",
          }}
          fontWeight="100 900"
          fontStyle="normal"
        />
      </Head>
      <Preview>{content.title}</Preview>
      <Body
        style={{
          backgroundColor: emailTheme.background,
          color: emailTheme.foreground,
          fontFamily: emailTheme.fontFamily,
          WebkitFontSmoothing: "antialiased",
          margin: 0,
          padding: "32px 12px",
        }}
      >
        <Container
          style={{
            backgroundColor: emailTheme.surface,
            borderRadius: 24,
            maxWidth: 560,
            padding: "32px 24px",
          }}
        >
          <Img
            src={logoSource}
            alt="Towbar"
            width={48}
            height={48}
            style={{ display: "block", margin: "0 0 24px" }}
          />
          <Heading
            as="h1"
            style={{
              color: emailTheme.foreground,
              fontFamily: emailTheme.fontFamily,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-0.6px",
              lineHeight: "32px",
              margin: "0 0 20px",
            }}
          >
            {content.title}
          </Heading>
          {content.paragraphs.map((paragraph, index) => (
            <Text
              key={index}
              style={{
                color: emailTheme.foreground,
                fontFamily: emailTheme.fontFamily,
                fontSize: 16,
                fontWeight: 400,
                lineHeight: "24px",
                margin: "0 0 16px",
              }}
            >
              {paragraph}
            </Text>
          ))}
          {content.code ? (
            <Text
              style={{
                color: emailTheme.foreground,
                fontFamily: '"Geist Mono", ui-monospace, monospace',
                fontSize: 32,
                fontWeight: 600,
                letterSpacing: 6,
              }}
            >
              {content.code}
            </Text>
          ) : null}
          {actionUrl ? (
            <Section style={{ margin: "24px 0" }}>
              <Button
                href={actionUrl.href}
                style={{
                  backgroundColor: emailTheme.accent,
                  color: emailTheme.surface,
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontFamily: emailTheme.fontFamily,
                  fontSize: 14,
                  fontWeight: 500,
                  lineHeight: "20px",
                  textDecoration: "none",
                }}
              >
                {content.actionLabel ?? "Open Towbar"}
              </Button>
              <Text
                style={{
                  fontFamily: emailTheme.fontFamily,
                  fontSize: 14,
                  lineHeight: "20px",
                  color: emailTheme.muted,
                  overflowWrap: "anywhere",
                }}
              >
                Or open this link:{" "}
                <Link
                  href={actionUrl.href}
                  style={{
                    color: emailTheme.accent,
                    textDecoration: "underline",
                    overflowWrap: "anywhere",
                  }}
                >
                  {actionUrl.href}
                </Link>
              </Text>
            </Section>
          ) : null}
          <Text
            style={{
              color: emailTheme.muted,
              fontFamily: emailTheme.fontFamily,
              fontSize: 12,
              lineHeight: "16px",
              margin: "24px 0 0",
            }}
          >
            {content.teamName}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
async function renderMessage(content: Message) {
  const html = await render(<EmailShell message={content} />);
  return {
    subject: `[Towbar] ${content.title}`.replace(/[\r\n]/g, " ").slice(0, 255),
    html,
    text: toPlainText(html),
  };
}
export function renderTransactionalEmail(
  template: TransactionalTemplate,
  data: TransactionalEmailData,
) {
  return renderMessage(message(template, data));
}
export function TransactionalEmail({
  template,
  data,
}: {
  template: TransactionalTemplate;
  data: TransactionalEmailData;
}) {
  return <EmailShell message={message(template, data)} />;
}
export type OperationalEmailData = {
  title: string;
  summary: string;
  actionUrl: string;
  details: Record<string, string | number | boolean | null | undefined>;
};
function operationalMessage(input: OperationalEmailData): Message {
  return {
    title: input.title,
    paragraphs: [
      input.summary,
      ...Object.entries(input.details)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => `${key}: ${value}`),
    ],
    teamName: "Towbar notifications",
    actionUrl: input.actionUrl,
    actionLabel: "View in Towbar",
  };
}
export function OperationalEmail(input: OperationalEmailData) {
  return <EmailShell message={operationalMessage(input)} />;
}
export function renderOperationalEmail(input: OperationalEmailData) {
  return renderMessage(operationalMessage(input));
}
