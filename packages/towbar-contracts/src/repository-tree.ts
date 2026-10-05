export type RepositoryTreeEntry = {
  mode: string;
  path: string;
  sha: string;
  type: "blob" | "commit";
};

export type RepositoryTree = {
  complete: boolean;
  entries: RepositoryTreeEntry[];
};
