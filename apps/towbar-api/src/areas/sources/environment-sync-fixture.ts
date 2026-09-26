import type { ManifestNotifications } from "@workspace/towbar-core";

export function environmentSyncDependencies(
  state: () => {
    root: string;
    snapshotCommit: string;
    keys: string[];
    broken: boolean;
    notifications?: ManifestNotifications;
  },
) {
  return {
    snapshot: () => {
      const { root, snapshotCommit, keys, broken, notifications } = state();
      return Promise.resolve({
        commitSha: snapshotCommit,
        root,
        configuration: {
          version: 2 as const,
          environments: { production: {}, staging: {} },
        },
        directories: [".towbar/services"],
        files: [
          {
            path: ".towbar/services/site.service.yml",
            content: JSON.stringify({
              id: "site",
              name: "Site",
              dockerfile: "Dockerfile",
              container: { port: 3000 },
              secrets: { runtime: keys },
              ...(notifications ? { notifications } : {}),
              environments: {
                production: {
                  server: "192.0.2.10",
                  domains: { primary: "prod.example.com" },
                },
                staging: {
                  server: broken ? "192.0.2.99" : "192.0.2.10",
                  domains: { primary: "stage.example.com" },
                },
              },
            }),
          },
        ],
      });
    },
    tree: () => Promise.resolve({ complete: true, entries: [] }),
  };
}
