import responseSchemas from "./response-schemas.json" with { type: "json" };
import { z } from "zod";
import {
  secretEnvironmentSchema,
  secretStageSchema,
} from "@workspace/towbar-core";
import { operationDescription } from "../../http/operation.js";
import { controlPlaneRoutes } from "../../routes/v1/core/index.js";
import { referenceGroup } from "./reference-groups.js";

export const operations = controlPlaneRoutes.routes.flatMap((route) => {
  const description = operationDescription(route.handler);
  if (!description || description.browserOnly) return [];
  const parameters = [...route.path.matchAll(/:([A-Za-z]+)/g)].map(
    (match) => match[1]!,
  );
  const pathSchema = z
    .object(
      Object.fromEntries(
        parameters.map((name) => [
          name,
          name === "environment"
            ? secretEnvironmentSchema
            : name === "stage"
              ? secretStageSchema
              : z.uuid(),
        ]),
      ),
    )
    .strict();
  const input = z
    .object({
      ...(parameters.length ? { path: pathSchema } : {}),
      ...(description.query ? { query: description.query.optional() } : {}),
      ...(description.body ? { body: description.body } : {}),
      ...(description.idempotencyKey
        ? {
            idempotencyKey: z
              .string()
              .trim()
              .min(1)
              .max(255)
              .describe(
                "Unique key for this action. Reuse only when retrying the same request.",
              ),
          }
        : {}),
    })
    .strict();
  const name = `${route.method.toLowerCase()}${route.path
    .replace(/:([A-Za-z]+Id)/g, "by_id")
    .replace(/:([A-Za-z]+)/g, "by_$1")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_$/, "")}`;
  return [
    {
      ...description,
      method: route.method,
      path: route.path,
      name,
      input,
      pathSchema,
    },
  ];
});

export function createOpenApiDocument(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const jsonSchema = (schema: z.ZodType) =>
    z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const errorResponseDefinition = {
    description:
      "Request failed. The error object contains code, message, and requestId.",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "requestId"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
  const errorResponse = { $ref: "#/components/responses/ApiError" };
  for (const op of operations) {
    const path = op.path.replace(/:([A-Za-z]+)/g, "{$1}");
    const params: unknown[] = Object.entries(op.pathSchema.shape).map(
      ([name, schema]) => ({
        name,
        in: "path",
        required: true,
        schema: jsonSchema(schema),
      }),
    );
    if (op.query) {
      const query = jsonSchema(op.query);
      for (const [name, schema] of Object.entries(query.properties ?? {}))
        params.push({
          name,
          in: "query",
          required: query.required?.includes(name) ?? false,
          schema,
        });
    }
    if (op.idempotencyKey)
      params.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 255 },
      });
    const success = {
      description:
        op.response +
        (op.status === 202
          ? " Accepted work continues asynchronously; poll its ID." +
            (op.idempotencyKey ? " An idempotent replay returns 200." : "")
          : ""),
      ...(op.status !== 204
        ? {
            content: {
              ...(op.stream
                ? {
                    "application/json": {
                      schema: (
                        responseSchemas.schemas as Record<string, unknown>
                      )[op.responseSchema],
                    },
                  }
                : {}),
              [op.stream ? "text/event-stream" : "application/json"]: {
                schema: op.stream
                  ? { type: "string" }
                  : ((responseSchemas.schemas as Record<string, unknown>)[
                      op.responseSchema
                    ] ?? { type: "object" }),
              },
            },
          }
        : {}),
    };
    paths[path] ??= {};
    paths[path]![op.method.toLowerCase()] = {
      operationId: op.name,
      summary: op.summary,
      tags: [referenceGroup(op.path).join(" / ")],
      description: `${op.ownerOnly ? "Requires workspace owner permission. " : "Available to workspace members and owners. "}${op.method === "GET" ? "Read-only and full-access keys are accepted." : "Requires a full-access key."}${op.stream ? " SSE deployment events containing deployment, logs, and steps. Reconnect after the bounded stream ends using Last-Event-ID. MCP returns a finite snapshot; call again to poll." : ""}`,
      security: [{ bearerAuth: [] }],
      parameters: params,
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: jsonSchema(op.body) } },
            },
          }
        : {}),
      responses: {
        [op.status ?? 200]: success,
        ...Object.fromEntries(
          (op.additionalStatuses ?? []).map((status) => [status, success]),
        ),
        ...(op.status === 202 && op.idempotencyKey ? { 200: success } : {}),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        413: errorResponse,
        422: errorResponse,
        429: { $ref: "#/components/responses/RateLimited" },
        500: errorResponse,
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Towbar API",
      version: "1.5.2",
      description:
        "Manage your Towbar control plane with a bearer API key. Keys inherit current workspace permissions.",
    },
    servers: [{ url: baseUrl }],
    components: {
      schemas: responseSchemas.definitions,
      responses: {
        ApiError: errorResponseDefinition,
        RateLimited: {
          ...errorResponseDefinition,
          headers: {
            "Retry-After": {
              description: "Seconds before retrying",
              schema: { type: "integer" },
            },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Towbar API key",
        },
      },
    },
    paths,
  };
}
