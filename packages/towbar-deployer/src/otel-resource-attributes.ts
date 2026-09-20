const resourceAttributeKey = /^[A-Za-z][A-Za-z0-9_.-]*$/u;

function escapeResourceAttributeValue(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(",", "\\,")
    .replaceAll("=", "\\=");
}

export function otelResourceAttributes(
  attributes: Record<string, string | undefined>,
) {
  return Object.entries(attributes)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => {
      if (!resourceAttributeKey.test(key))
        throw new Error(`Invalid OpenTelemetry resource attribute: ${key}`);
      return `${key}=${escapeResourceAttributeValue(value)}`;
    })
    .join(",");
}
