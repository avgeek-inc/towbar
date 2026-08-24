const fallbackPath = "/";
const validationOrigin = "https://towbar.invalid";

export function safeNextPath(candidate: string | null) {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return fallbackPath;
  }

  try {
    const target = new URL(candidate, validationOrigin);
    if (target.origin !== validationOrigin) return fallbackPath;
    const decodedPathname = decodeURIComponent(target.pathname);
    if (
      decodedPathname.startsWith("//") ||
      decodedPathname.includes("\\") ||
      target.pathname === "/login" ||
      target.pathname === "/logout"
    ) {
      return fallbackPath;
    }
    const path = `${target.pathname}${target.search}${target.hash}`;
    return path;
  } catch {
    return fallbackPath;
  }
}
