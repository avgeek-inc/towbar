import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { NotificationProviderError } from "./provider-error.js";
const providerTimeoutMs = 10_000;
export async function sendSmtpEmail(
  input: {
    subject: string;
    html: string;
    text: string;
    messageId: string;
    recipients: string[];
  },
  provider: {
    from: string;
    host: string;
    password?: string;
    port: number;
    secure: boolean;
    username?: string;
  },
  dependencies = {
    resolveAddress: resolvePublicSmtpAddress,
    createTransport: (options: SMTPTransport.Options) =>
      nodemailer.createTransport(options),
  },
) {
  const address = await dependencies.resolveAddress(provider.host);
  const transport = dependencies.createTransport({
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
    requireTLS: !provider.secure,
    socketTimeout: providerTimeoutMs,
    tls: { servername: provider.host },
  });
  try {
    const result = await transport.sendMail({
      from: provider.from,
      messageId: `<${input.messageId}@towbar.invalid>`,
      subject: input.subject,
      text: input.text,
      html: input.html,
      to: input.recipients,
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
