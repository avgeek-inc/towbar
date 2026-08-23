import { z } from "zod";

const providerPattern = /^[a-z][a-z0-9-]*$/;

export const secretReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .superRefine((value, context) => {
    try {
      const reference = parseSecretReference(value);
      if (reference.provider !== "aws") {
        context.addIssue({
          code: "custom",
          message: `Unsupported secret provider '${reference.provider}' in manifest version 1`,
        });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid secret reference",
      });
    }
  });

export type SecretReference = {
  provider: string;
  reference: string;
};

/**
 * Splits only on the first colon so provider-native identifiers remain opaque.
 * Secret values are intentionally not represented by this type.
 */
export function parseSecretReference(value: string): SecretReference {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(
      "Secret references must use the form <provider>:<provider-reference>",
    );
  }

  const provider = value.slice(0, separator);
  const reference = value.slice(separator + 1);
  if (!providerPattern.test(provider)) {
    throw new Error("Secret provider names must be lowercase identifiers");
  }
  if (reference.trim() !== reference || hasControlCharacters(reference)) {
    throw new Error(
      "Secret provider references cannot contain surrounding whitespace or control characters",
    );
  }

  return { provider, reference };
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}
