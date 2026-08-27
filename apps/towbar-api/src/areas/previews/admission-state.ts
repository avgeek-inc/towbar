export function shouldDeferPreviewAdmission(status: string | undefined) {
  return status === "deleting";
}
