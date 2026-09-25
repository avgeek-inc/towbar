import { z } from "zod";

export const logDrainProviders = [
  "newrelic",
  "axiom",
  "betterstack",
  "datadog",
  "otlp",
  "loki",
] as const;
export const logDrainProviderSchema = z.enum(logDrainProviders);
export type LogDrainProvider = z.infer<typeof logDrainProviderSchema>;
export const logDrainHealthSchema = z
  .object({
    provider: logDrainProviderSchema,
    revision: z.string().min(1).max(64),
    status: z.enum(["configured", "retrying", "auth_failure", "rate_limited"]),
    rateLimitCount: z.number().int().min(0).max(3),
    failureCount: z.number().int().min(0).max(20),
    lastHttpStatus: z.number().int().min(100).max(599).nullable(),
    retryAt: z.iso.datetime().nullable(),
    changedAt: z.iso.datetime(),
    lastSuccessAt: z.iso.datetime().nullable(),
    incidentId: z.uuid().nullable(),
    acceptedBatches: z.number().int().nonnegative(),
    droppedBatches: z.number().int().nonnegative(),
  })
  .strict();
export type LogDrainHealth = z.infer<typeof logDrainHealthSchema>;
export const logDrainHealthListSchema = z
  .array(logDrainHealthSchema)
  .max(logDrainProviders.length);
export const logDrainsSchema = z
  .array(logDrainProviderSchema)
  .max(logDrainProviders.length)
  .refine(
    (items) => new Set(items).size === items.length,
    "Log destinations must be unique",
  );
const reservedLogAttributes = new Set([
  "message",
  "timestamp",
  "container_name",
  "stream",
  "service",
  "app_id",
  "compose_service",
  "deployment_id",
  "environment",
  "repository_id",
  "server_id",
  "team_id",
]);
export const logDrainAttributesSchema = z.partialRecord(
  logDrainProviderSchema,
  z
    .record(
      z
        .string()
        .regex(
          /^[a-z][a-z0-9_]{0,63}$/,
          "Use lowercase letters, numbers and underscores",
        ),
      z
        .string()
        .trim()
        .min(1)
        .max(256)
        .refine(
          (value) =>
            [...value].every((character) => {
              const code = character.charCodeAt(0);
              return code >= 32 && code !== 127;
            }) &&
            !value.includes("{{") &&
            !value.includes("}}"),
          "Use plain text without control characters or templates",
        ),
    )
    .refine(
      (attributes) => Object.keys(attributes).length <= 16,
      "Use at most 16 attributes per provider",
    )
    .refine(
      (attributes) =>
        Object.keys(attributes).every((key) => !reservedLogAttributes.has(key)),
      "Do not override Towbar log fields",
    ),
);
export type LogDrainAttributes = z.infer<typeof logDrainAttributesSchema>;
const apiKey = z
  .string()
  .min(8)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/, "Enter a token without spaces or line breaks")
  .refine(
    (value) => !value.includes("{{") && !value.includes("}}"),
    "Enter a literal token without template expressions",
  );
const headerValue = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x20-\x7e]+$/, "Enter a value without line breaks");
export const logDrainEndpointSchema = z
  .string()
  .trim()
  .max(2048)
  .regex(/^[^\s\\{}]+$/, "Enter a URL without whitespace or braces")
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/[\s\\{}]/.test(value)
    );
  }, "Enter an HTTPS URL without credentials, a query, or a fragment");

function isCertificateChain(value: string) {
  if (!value) return true;
  const begin = "-----BEGIN CERTIFICATE-----";
  const end = "-----END CERTIFICATE-----";
  let remainder = value;
  let certificateCount = 0;
  while (remainder) {
    if (!remainder.startsWith(begin)) return false;
    const endIndex = remainder.indexOf(end, begin.length);
    if (endIndex < 0) return false;
    const body = remainder.slice(begin.length, endIndex).replace(/\s/gu, "");
    if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(body))
      return false;
    certificateCount += 1;
    if (certificateCount > 8) return false;
    remainder = remainder.slice(endIndex + end.length).trim();
  }
  return certificateCount > 0;
}

const caCertificate = z
  .string()
  .trim()
  .max(32768)
  .default("")
  .refine(isCertificateChain, "Enter a PEM CA certificate");
const destinationText = z
  .string()
  .trim()
  .max(256)
  .refine(
    (value) =>
      [...value].every(
        (character) =>
          character.charCodeAt(0) >= 32 &&
          character.charCodeAt(0) !== 127 &&
          character !== "{" &&
          character !== "}",
      ),
    "Enter a value without control characters or braces",
  );
const destinationHeader = destinationText.pipe(
  z.string().regex(/^[\x20-\x7e]*$/, "Enter a value using ASCII characters"),
);
export const logDrainHeaderSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
      .refine(
        (name) =>
          ![
            "host",
            "content-type",
            "content-length",
            "content-encoding",
            "transfer-encoding",
            "connection",
            "keep-alive",
            "te",
            "trailer",
            "upgrade",
            "proxy-connection",
            "cookie",
            "proxy-authorization",
          ].includes(name.toLowerCase()),
        "This header is managed by Towbar",
      ),
    value: headerValue.refine(
      (value) => !value.includes("{{") && !value.includes("}}"),
      "Enter a literal header value without template expressions",
    ),
  })
  .strict();
const authenticatedEndpoint = {
  endpoint: logDrainEndpointSchema,
  auth: z.enum(["none", "bearer", "basic", "headers"]),
  username: destinationText.default(""),
  apiKey: z.union([z.literal(""), headerValue]).default(""),
  headers: z.array(logDrainHeaderSchema).max(16).default([]),
  caCertificate,
};
function validateAuthentication(
  value: z.infer<z.ZodObject<typeof authenticatedEndpoint>>,
  context: z.RefinementCtx,
) {
  const issue = (field: string, message: string) =>
    context.addIssue({ code: "custom", path: [field], message });
  if ((value.auth === "bearer" || value.auth === "basic") && !value.apiKey)
    issue("apiKey", "Enter the authentication credential");
  if (value.auth === "bearer" && /\s/.test(value.apiKey))
    issue("apiKey", "Enter a bearer token without spaces");
  if (
    value.auth === "basic" &&
    (!value.username || value.username.includes(":"))
  )
    issue("username", "Enter a username without a colon");
  if (value.auth !== "basic" && value.username)
    issue("username", "Username is only used for Basic authentication");
  if (!["basic", "bearer"].includes(value.auth) && value.apiKey)
    issue(
      "apiKey",
      "This authentication method does not use a token or password",
    );
  if (value.auth === "headers" && !value.headers.length)
    issue("headers", "Add an authentication header");
  if (value.auth !== "headers" && value.headers.length)
    issue("headers", "Select custom headers to configure headers");
  if (
    new Set(value.headers.map((header) => header.name.toLowerCase())).size !==
    value.headers.length
  )
    issue("headers", "Header names must be unique");
}
export const logDrainCredentialSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("newrelic"),
      apiKey,
      region: z.enum(["us", "eu", "jp"]),
    })
    .strict(),
  z
    .object({
      provider: z.literal("axiom"),
      apiKey,
      dataset: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
      ingestHost: z
        .string()
        .max(253)
        .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.edge\.axiom\.co$/),
    })
    .strict(),
  z
    .object({
      provider: z.literal("betterstack"),
      apiKey,
      ingestHost: z
        .string()
        .max(253)
        .regex(
          /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*\.betterstackdata\.com|in\.logs\.betterstack\.com)$/,
        ),
    })
    .strict(),
  z
    .object({
      provider: z.literal("datadog"),
      apiKey,
      site: z.enum([
        "datadoghq.com",
        "us3.datadoghq.com",
        "us5.datadoghq.com",
        "datadoghq.eu",
        "ap1.datadoghq.com",
        "ap2.datadoghq.com",
        "us2.ddog-gov.com",
        "ddog-gov.com",
        "uk1.datadoghq.com",
      ]),
    })
    .strict(),
  z
    .object({ provider: z.literal("otlp"), ...authenticatedEndpoint })
    .strict()
    .superRefine(validateAuthentication),
  z
    .object({
      provider: z.literal("loki"),
      ...authenticatedEndpoint,
      tenantId: destinationHeader.default(""),
    })
    .strict()
    .superRefine(validateAuthentication),
]);
export type LogDrainCredential = z.infer<typeof logDrainCredentialSchema>;
export function logDrainPublicConfiguration(credential: LogDrainCredential) {
  const { apiKey, ...configuration } = credential;
  return {
    ...configuration,
    apiKeyConfigured: Boolean(apiKey),
    ...("headers" in credential
      ? { headers: credential.headers.map(({ name }) => ({ name, value: "" })) }
      : {}),
  };
}
export function mergeLogDrainCredential(
  input: Record<string, unknown>,
  existing?: LogDrainCredential,
) {
  const sameAuth =
    existing && (!("auth" in existing) || input.auth === existing.auth);
  return logDrainCredentialSchema.parse({
    ...input,
    apiKey: input.apiKey || (sameAuth ? existing.apiKey : ""),
    ...(Array.isArray(input.headers)
      ? {
          headers: input.headers.map((header: unknown) => {
            if (!header || typeof header !== "object") return header;
            const entry = header as Record<string, unknown>;
            const stored =
              sameAuth && "headers" in existing
                ? existing.headers.find(
                    (item) =>
                      typeof entry.name === "string" &&
                      item.name.toLowerCase() ===
                        entry.name.trim().toLowerCase(),
                  )
                : undefined;
            return { ...entry, value: entry.value || stored?.value };
          }),
        }
      : {}),
  });
}
export function logDrainSecret(
  credential: LogDrainCredential,
  header?: string,
) {
  if (header !== undefined)
    return "headers" in credential
      ? credential.headers.find(
          (item) => item.name.toLowerCase() === header.toLowerCase(),
        )?.value
      : undefined;
  return credential.apiKey;
}
export type LogDrainTarget = {
  appId: string;
  composeService?: string;
  containerName: string;
  deploymentId: string;
  repositoryId: string;
  teamId: string;
  name: string;
  environment: string;
  kind: "container";
  providers: LogDrainProvider[];
  attributes?: LogDrainAttributes;
};

export function logDrainEndpoint(credential: LogDrainCredential) {
  switch (credential.provider) {
    case "newrelic":
      return {
        url: {
          us: "https://log-api.newrelic.com/log/v1",
          eu: "https://log-api.eu.newrelic.com/log/v1",
          jp: "https://log-api.jp.nr-data.net/log/v1",
        }[credential.region],
        headers: { "Api-Key": credential.apiKey },
      };
    case "axiom":
      return {
        url: `https://${credential.ingestHost}/v1/ingest/${encodeURIComponent(credential.dataset)}`,
        headers: { Authorization: `Bearer ${credential.apiKey}` },
      };
    case "betterstack":
      return {
        url: `https://${credential.ingestHost}/`,
        headers: { Authorization: `Bearer ${credential.apiKey}` },
      };
    case "datadog":
      return {
        url: `https://http-intake.logs.${credential.site}/api/v2/logs`,
        headers: { "DD-API-KEY": credential.apiKey },
      };
    case "otlp":
    case "loki":
      return {
        url: credential.endpoint,
        headers: Object.fromEntries(
          credential.headers.map(({ name, value }) => [name, value]),
        ),
      };
  }
}
