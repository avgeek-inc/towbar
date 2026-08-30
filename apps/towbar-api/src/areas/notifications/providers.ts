import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import nodemailer from "nodemailer";

import {
  notificationEventPayloadSchema,
  slackNotificationConfigSchema,
  smtpNotificationConfigSchema,
} from "@workspace/towbar-core";

import type { NotificationProviderConfiguration } from "./configuration.js";

import type {
  NotificationEventPayload,
  NotificationEventType,
  NotificationProvider,
} from "@workspace/towbar-core";

const providerTimeoutMs = 10_000;

export class NotificationProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly providerStatus?: string,
  ) {
    super(message);
    this.name = "NotificationProviderError";
  }
}

export async function deliverNotification(input: {
  config: unknown;
  eventId: string;
  eventType: NotificationEventType;
  payload: NotificationEventPayload;
  provider: NotificationProvider;
  providerConfiguration: NotificationProviderConfiguration;
  thread?: { messageId: string; threadId: string; updateRoot: boolean } | null;
}) {
  const payload = notificationEventPayloadSchema.parse(input.payload);
  if (input.provider === "slack") {
    if (input.providerConfiguration.provider !== "slack") {
      throw invalidProviderConfiguration("Slack");
    }
    const result = await sendSlackNotification({
      config: slackNotificationConfigSchema.parse(input.config),
      eventId: input.eventId,
      eventType: input.eventType,
      payload,
      providerConfiguration: input.providerConfiguration,
      thread: input.thread,
    });
    return {
      providerMessageId: result.messageId,
      rootUpdated: result.rootUpdated,
      providerStatus: "accepted",
      providerThreadId: result.threadId,
    };
  }
  if (input.providerConfiguration.provider !== "smtp") {
    throw invalidProviderConfiguration("SMTP");
  }
  return await sendSmtpNotification({
    config: smtpNotificationConfigSchema.parse(input.config),
    eventId: input.eventId,
    payload,
    providerConfiguration: input.providerConfiguration,
  });
}

type SlackApiRequest = (
  method: "chat.postMessage" | "chat.update",
  payload: Record<string, unknown>,
  botToken: string,
) => Promise<Record<string, unknown>>;

export async function sendSlackNotification(
  input: {
    config: { channelId: string };
    eventId: string;
    eventType: NotificationEventType;
    payload: NotificationEventPayload;
    providerConfiguration: { appBaseUrl: string; botToken: string };
    thread?: {
      messageId: string;
      threadId: string;
      updateRoot: boolean;
    } | null;
  },
  request: SlackApiRequest = slackApiRequest,
) {
  const message = input.eventType.startsWith("deployment.")
    ? renderSlackDeploymentMessage(input)
    : renderSlackGenericMessage(input);
  if (!input.thread) {
    const created = await request(
      "chat.postMessage",
      {
        ...message,
        channel: input.config.channelId,
        client_msg_id: input.eventId,
      },
      input.providerConfiguration.botToken,
    );
    const messageId = requireSlackMessageId(created);
    return { messageId, rootUpdated: true, threadId: messageId };
  }
  if (input.thread.updateRoot) {
    await request(
      "chat.update",
      {
        ...message,
        channel: input.config.channelId,
        ts: input.thread.messageId,
      },
      input.providerConfiguration.botToken,
    );
  }
  await request(
    "chat.postMessage",
    {
      blocks: renderSlackLifecycleReply(input),
      channel: input.config.channelId,
      client_msg_id: input.eventId,
      text: message.text,
      thread_ts: input.thread.threadId,
    },
    input.providerConfiguration.botToken,
  );
  return { ...input.thread, rootUpdated: input.thread.updateRoot };
}

function renderSlackGenericMessage(input: {
  payload: NotificationEventPayload;
}) {
  return {
    blocks: [
      {
        text: {
          text: escapeSlack(input.payload.title),
          type: "plain_text",
        },
        type: "header",
      },
      {
        text: {
          text: escapeSlack(input.payload.message),
          type: "mrkdwn",
        },
        type: "section",
      },
      ...(compactSlackDetails(input.payload.details).length
        ? [
            {
              fields: compactSlackDetails(input.payload.details),
              type: "section",
            },
          ]
        : []),
      {
        elements: [
          {
            text: `${escapeSlack(input.payload.source.name)} · ${formatSlackTimestamp(input.payload.occurredAt)}`,
            type: "mrkdwn",
          },
        ],
        type: "context",
      },
    ],
    text: `${input.payload.title}: ${input.payload.message}`.slice(0, 3_000),
  };
}

export function renderSlackDeploymentMessage(input: {
  eventId: string;
  eventType: NotificationEventType;
  payload: NotificationEventPayload;
  providerConfiguration: { appBaseUrl: string };
}) {
  const details = compactSlackDetails(input.payload.details);
  const deploymentUrl = new URL(
    `/sources/${input.payload.source.id}/deployments/${input.payload.entity.id}`,
    input.providerConfiguration.appBaseUrl,
  ).toString();
  return {
    blocks: [
      {
        text: {
          text: `${deploymentStatusIcon(input.eventType)} ${escapeSlack(input.payload.entity.name)}`,
          type: "plain_text",
        },
        type: "header",
      },
      {
        fields: [
          {
            text: `*Status*\n${escapeSlack(deploymentStatus(input.eventType))}`,
            type: "mrkdwn",
          },
          {
            text: `*Source*\n${escapeSlack(input.payload.source.name)}`,
            type: "mrkdwn",
          },
          ...details,
        ].slice(0, 10),
        type: "section",
      },
      {
        elements: [
          {
            text: escapeSlack(input.payload.message),
            type: "mrkdwn",
          },
        ],
        type: "context",
      },
      {
        elements: [
          {
            text: { text: "View deployment", type: "plain_text" },
            type: "button",
            url: deploymentUrl,
          },
        ],
        type: "actions",
      },
    ],
    text: `${input.payload.title}: ${input.payload.message}`.slice(0, 3_000),
  };
}

function renderSlackLifecycleReply(input: {
  eventId: string;
  eventType: NotificationEventType;
  payload: NotificationEventPayload;
}) {
  return [
    {
      text: {
        text: `*${deploymentStatusIcon(input.eventType)} ${escapeSlack(input.payload.title)}*\n${escapeSlack(input.payload.message)}`,
        type: "mrkdwn",
      },
      type: "section",
    },
    {
      elements: [
        {
          text: `${formatSlackTimestamp(input.payload.occurredAt)} · event ${input.eventId}`,
          type: "mrkdwn",
        },
      ],
      type: "context",
    },
  ];
}

async function slackApiRequest(
  method: "chat.postMessage" | "chat.update",
  payload: Record<string, unknown>,
  botToken: string,
) {
  let response: Response;
  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      body: JSON.stringify(payload),
      headers: {
        authorization: `Bearer ${botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(providerTimeoutMs),
    });
  } catch (error) {
    throw classifyNetworkError(error, "Slack could not be reached");
  }
  const result = await readBoundedResponse(response);
  if (response.ok && result.ok === true) return result;
  const retryable =
    response.status === 429 ||
    response.status >= 500 ||
    result.error === "ratelimited";
  throw new NotificationProviderError(
    retryable ? "SLACK_TEMPORARY_FAILURE" : "SLACK_REJECTED",
    retryable
      ? "Slack temporarily rejected the notification"
      : "Slack rejected the notification configuration",
    retryable,
    typeof result.error === "string"
      ? result.error.slice(0, 100)
      : String(response.status),
  );
}

function requireSlackMessageId(result: Record<string, unknown>) {
  if (typeof result.ts === "string" && result.ts.length <= 100) {
    return result.ts;
  }
  throw new NotificationProviderError(
    "SLACK_INVALID_RESPONSE",
    "Slack accepted the notification without returning a message ID",
    true,
  );
}

function compactSlackDetails(details: NotificationEventPayload["details"]) {
  return Object.entries(details)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    )
    .slice(0, 6)
    .map(([key, value]) => ({
      text: `*${escapeSlack(titleCase(key))}*\n${escapeSlack(String(value))}`,
      type: "mrkdwn",
    }));
}

function deploymentStatus(type: NotificationEventType) {
  return type.startsWith("deployment.")
    ? titleCase(type.slice("deployment.".length))
    : "Updated";
}

function deploymentStatusIcon(type: NotificationEventType) {
  if (type === "deployment.succeeded") return "✅";
  if (type === "deployment.failed" || type === "deployment.cancelled") {
    return "❌";
  }
  if (type === "deployment.started") return "🔵";
  return "🟡";
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

function formatSlackTimestamp(value: string) {
  const epoch = Math.floor(new Date(value).getTime() / 1_000);
  return Number.isFinite(epoch)
    ? `<!date^${epoch}^{date_short_pretty} at {time}|${value}>`
    : value;
}

async function sendSmtpNotification(input: {
  config: { recipients: string[] };
  eventId: string;
  payload: NotificationEventPayload;
  providerConfiguration: {
    from: string;
    host: string;
    password?: string;
    port: number;
    secure: boolean;
    subjectPrefix: string;
    username?: string;
  };
}) {
  const provider = input.providerConfiguration;
  const address = await resolvePublicSmtpAddress(provider.host);
  const transport = nodemailer.createTransport({
    auth:
      provider.username && provider.password
        ? { pass: provider.password, user: provider.username }
        : undefined,
    connectionTimeout: providerTimeoutMs,
    disableFileAccess: true,
    disableUrlAccess: true,
    greetingTimeout: providerTimeoutMs,
    host: address,
    port: provider.port,
    secure: provider.secure,
    socketTimeout: providerTimeoutMs,
    tls: { servername: provider.host },
  });
  try {
    const result = await transport.sendMail({
      from: provider.from,
      messageId: `<${input.eventId}@towbar.invalid>`,
      subject: `[${provider.subjectPrefix}] ${input.payload.title}`.slice(
        0,
        255,
      ),
      text: renderPlainText(input.payload, input.eventId),
      to: input.config.recipients,
    });
    return { providerStatus: result.response.slice(0, 100) };
  } catch (error) {
    throw classifySmtpError(error);
  } finally {
    transport.close();
  }
}

export async function resolvePublicSmtpAddress(host: string) {
  if (host.includes("://") || host.includes("/") || host.includes("@")) {
    throw new NotificationProviderError(
      "INVALID_SMTP_HOST",
      "SMTP host must be a public hostname",
      false,
    );
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new NotificationProviderError(
      "SMTP_DNS_FAILED",
      "SMTP host could not be resolved",
      true,
    );
  }
  const publicAddress = addresses.find(
    ({ address }) => !isPrivateOrReservedAddress(address),
  );
  if (
    !publicAddress ||
    addresses.some(({ address }) => isPrivateOrReservedAddress(address))
  ) {
    throw new NotificationProviderError(
      "UNSAFE_SMTP_HOST",
      "SMTP host must resolve only to public network addresses",
      false,
    );
  }
  return publicAddress.address;
}

export function isPrivateOrReservedAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return isPrivateOrReservedIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPrivateOrReservedAddress(normalized.slice(7));
    }
    return isPrivateOrReservedIpv6(normalized);
  }
  return true;
}

function isPrivateOrReservedIpv4(address: string) {
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
  return (
    isPrivateIpv4(a, b) ||
    isDocumentationIpv4(a, b, c) ||
    isSpecialPurposeIpv4(a, b, c)
  );
}

function isPrivateIpv4(a: number, b: number) {
  return (
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isDocumentationIpv4(a: number, b: number, c: number) {
  return (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isSpecialPurposeIpv4(a: number, b: number, c: number) {
  return (
    a === 0 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateOrReservedIpv6(address: string) {
  const prefixes = [
    "fc",
    "fd",
    "100:",
    "2001:db8:",
    "fe8",
    "fe9",
    "fea",
    "feb",
    "ff",
  ];
  return (
    address === "::" ||
    address === "::1" ||
    prefixes.some((prefix) => address.startsWith(prefix))
  );
}

function renderPlainText(payload: NotificationEventPayload, eventId: string) {
  const details = Object.entries(payload.details)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
  return [
    payload.title,
    "",
    payload.message,
    "",
    `Source: ${payload.source.name}`,
    `${capitalize(payload.entity.kind)}: ${payload.entity.name}`,
    ...(details ? [details] : []),
    "",
    `Towbar event: ${eventId}`,
    `Occurred: ${payload.occurredAt}`,
  ]
    .join("\n")
    .slice(0, 20_000);
}

function classifyNetworkError(error: unknown, message: string) {
  const timeout =
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name);
  return new NotificationProviderError(
    timeout ? "DELIVERY_RESULT_UNKNOWN" : "PROVIDER_UNREACHABLE",
    timeout
      ? "The provider response timed out; delivery may have completed"
      : message,
    !timeout,
  );
}

function classifySmtpError(error: unknown) {
  const candidate = error as {
    code?: string;
    responseCode?: number;
  };
  const responseCode = candidate?.responseCode;
  const retryable =
    typeof responseCode === "number"
      ? responseCode >= 400 && responseCode < 500
      : ["ECONNECTION", "EDNS", "ECONNREFUSED"].includes(candidate?.code ?? "");
  const unknown = ["ETIMEDOUT", "ESOCKET"].includes(candidate?.code ?? "");
  return new NotificationProviderError(
    unknown
      ? "DELIVERY_RESULT_UNKNOWN"
      : retryable
        ? "SMTP_TEMPORARY_FAILURE"
        : "SMTP_REJECTED",
    unknown
      ? "The SMTP response timed out; delivery may have completed"
      : retryable
        ? "The SMTP server temporarily rejected the notification"
        : "The SMTP server rejected the notification",
    retryable && !unknown,
    responseCode ? String(responseCode) : candidate?.code,
  );
}

function escapeSlack(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function invalidProviderConfiguration(provider: string) {
  return new NotificationProviderError(
    "PROVIDER_NOT_CONFIGURED",
    `${provider} notifications are not configured for this Towbar instance`,
    false,
  );
}

async function readBoundedResponse(response: Response) {
  const text = (await response.text()).slice(0, 16 * 1_024);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
