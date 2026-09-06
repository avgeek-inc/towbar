import catalog from "./resource-image-catalog.json";

export type ResourceBrand = {
  label: string;
  logo: string;
  logoDark?: string;
  darkPlate?: boolean;
  darkBackground?: boolean;
};

const fallback: ResourceBrand = {
  label: "Image",
  logo: "/resource-types/image.png",
};
const managed: Record<"postgres" | "redis", ResourceBrand> = {
  postgres: { label: "PostgreSQL", logo: "/resource-types/postgres.png" },
  redis: { label: "Redis", logo: "/resource-types/redis.png" },
};

/** Match repository identities, never arbitrary suffixes or product substrings. */
export function normalizeImageRepository(image: string): string | undefined {
  const value = image.trim();
  if (!value || value.length > 1024 || /\s|:\/\//u.test(value)) return;
  const [named, digest, ...extra] = value.split("@");
  if (
    extra.length ||
    (digest !== undefined &&
      !/^[a-z][a-z0-9_+.-]*:[a-fA-F0-9]{32,}$/u.test(digest))
  )
    return;
  let repository = named!;
  const colon = repository.lastIndexOf(":");
  if (colon > repository.lastIndexOf("/")) {
    if (!/^[\w][\w.-]{0,127}$/u.test(repository.slice(colon + 1))) return;
    repository = repository.slice(0, colon);
  }
  const segments = repository.split("/");
  let registry = "docker.io";
  const first = segments[0]!;
  if (
    segments.length > 1 &&
    (first.includes(".") || first.includes(":") || first === "localhost")
  ) {
    registry = segments.shift()!.toLowerCase();
  }
  if (registry === "index.docker.io" || registry === "registry-1.docker.io")
    registry = "docker.io";
  if (
    !segments.every((segment) =>
      /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/u.test(segment),
    )
  )
    return;
  if (registry === "docker.io" && segments.length === 1)
    segments.unshift("library");
  return `${registry}/${segments.join("/")}`;
}

const byRepository = new Map(
  catalog.flatMap((brand) =>
    brand.repositories.map(
      (repository) => [normalizeImageRepository(repository)!, brand] as const,
    ),
  ),
);

export function resourceImageBrand(
  kind: "image" | "postgres" | "redis",
  image: string,
): ResourceBrand {
  if (kind !== "image") return managed[kind];
  const repository = normalizeImageRepository(image);
  return (repository ? byRepository.get(repository) : undefined) ?? fallback;
}
