export function environmentSyncDependencies(
  state: () => {
    root: string;
    snapshotCommit: string;
    keys: string[];
    broken: boolean;
  },
) {
  return {
    snapshot: () => {
      const { root, snapshotCommit, keys, broken } = state();
      return Promise.resolve({
        commitSha: snapshotCommit,
        root,
        configuration: {
          version: 2 as const,
          environments: { production: {}, staging: {} },
        },
        directories: [".towbar/apps"],
        files: [
          {
            path: ".towbar/apps/site.app.yml",
            content: JSON.stringify({
              id: "site",
              name: "Site",
              dockerfile: "Dockerfile",
              container: { port: 3000 },
              secrets: { runtime: keys },
              environments: {
                production: {
                  server: "host",
                  domains: { primary: "prod.example.com" },
                },
                staging: {
                  server: broken ? "missing-host" : "host",
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
