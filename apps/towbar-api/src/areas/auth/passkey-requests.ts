import { z } from "zod";
import { HttpError, forbidden } from "../../http/errors.js";

const credentialSchema = z
  .object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal("public-key"),
    response: z.object({ clientDataJSON: z.string().min(1) }).loose(),
  })
  .loose();

export async function validatePasskeyRequest(request: Request, path: string) {
  if (request.method !== "POST") return;
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    throw new HttpError(
      400,
      "MALFORMED_JSON",
      "Request body must be valid JSON",
    );
  }
  const input = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      createSession: z.boolean().optional(),
    })
    .loose()
    .parse(body);
  if (input.createSession)
    throw forbidden("Use your current session when adding a passkey");
  if (
    ["/passkey/verify-registration", "/passkey/verify-authentication"].includes(
      path,
    )
  )
    z.object({ response: credentialSchema }).parse(body);
}
