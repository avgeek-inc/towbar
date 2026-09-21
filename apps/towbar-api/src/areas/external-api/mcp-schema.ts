import { z } from "zod";

export function mcpInputJsonSchema(input: z.ZodType) {
  return {
    ...z.toJSONSchema(input, { io: "input", unrepresentable: "any" }),
    type: "object" as const,
  };
}
