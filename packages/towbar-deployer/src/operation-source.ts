export function requireOperationSource(sourceId: string | null) {
  if (!sourceId) throw new Error("Resource operation has no Source context");
  return sourceId;
}
