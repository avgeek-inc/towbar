export function publicApiOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "TOWBAR_API_BASE_URL must be an HTTPS origin or loopback HTTP origin",
    );
  return url.origin;
}
