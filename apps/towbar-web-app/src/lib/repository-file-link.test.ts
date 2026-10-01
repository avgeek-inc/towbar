import assert from "node:assert/strict";
import test from "node:test";
import { repositoryFileLink } from "./repository-file-link";

const repository = {
  repositoryOwner: "example-inc",
  repositoryName: "platform",
};

test("GitHub manifest links use the synced revision and file path", () => {
  assert.deepEqual(
    repositoryFileLink(
      {
        ...repository,
        provider: "github",
        repositoryUrl: "https://github.com/example-inc/platform/",
      },
      "abc123",
      ".towbar/services/web.service.yml",
    ),
    {
      href: "https://github.com/example-inc/platform/blob/abc123/.towbar/services/web.service.yml",
      label: "Open in GitHub",
    },
  );
});

test("GitLab manifest links preserve the configured host and nested namespace", () => {
  assert.deepEqual(
    repositoryFileLink(
      {
        ...repository,
        provider: "gitlab",
        repositoryOwner: "example-inc/ops",
        repositoryUrl:
          "https://gitlab.example.com/gitlab/example-inc/ops/platform.git/",
      },
      "abc123",
      ".towbar/datastores/postgres.datastore.yml",
    ),
    {
      href: "https://gitlab.example.com/gitlab/example-inc/ops/platform/-/blob/abc123/.towbar/datastores/postgres.datastore.yml",
      label: "Open in GitLab",
    },
  );
});

test("sources without repository URLs fall back to their provider and preserve namespace segments", () => {
  assert.equal(
    repositoryFileLink(
      { ...repository, provider: "gitlab", repositoryOwner: "example inc/ops" },
      "main",
      "towbar.yml",
    ).href,
    "https://gitlab.com/example%20inc/ops/platform/-/blob/main/towbar.yml",
  );
  assert.equal(
    repositoryFileLink(
      { ...repository, provider: "github" },
      "main",
      "towbar.yml",
    ).href,
    "https://github.com/example-inc/platform/blob/main/towbar.yml",
  );
});

test("branch revisions and file names are encoded without losing file directories", () => {
  assert.equal(
    repositoryFileLink(
      { ...repository, provider: "gitlab" },
      "feature/manifest links",
      ".towbar/services/web #1.service.yml",
    ).href,
    "https://gitlab.com/example-inc/platform/-/blob/feature%2Fmanifest%20links/.towbar/services/web%20%231.service.yml",
  );
});
