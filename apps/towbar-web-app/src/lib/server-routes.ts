const serverSections = new Set([
  "overview",
  "preparation",
  "terminal",
  "performance",
  "alerts",
  "incidents",
  "apps",
  "resources",
  "checks",
  "settings",
]);

const serverSectionChildren: Record<string, Set<string>> = {
  settings: new Set([
    "credentials",
    "configuration",
    "monitoring",
    "cleanup",
    "danger",
  ]),
};

export function isServerSectionPath(sectionPath: string[]) {
  const [section, child] = sectionPath;
  return Boolean(
    section &&
    serverSections.has(section) &&
    sectionPath.length <= 2 &&
    (!child || serverSectionChildren[section]?.has(child)),
  );
}
