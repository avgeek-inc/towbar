import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  artifactNames,
  sha256,
  validateImages,
  validateRelease,
} from "./release.mjs";

const [directory, version, commit, imageFile, notesFile] =
  process.argv.slice(2);
if (
  !directory ||
  !imageFile ||
  !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
  !/^[a-f0-9]{40}$/.test(commit)
)
  throw new Error(
    "Usage: assemble.mjs DIRECTORY TAG COMMIT IMAGE_MANIFEST [NOTES]",
  );
const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 128 * 1024 * 1024 });
if (
  git("rev-parse", "HEAD").toString().trim() !== commit ||
  git("rev-parse", `${version}^{commit}`).toString().trim() !== commit
)
  throw new Error("Release tag must match checked-out HEAD");
if (
  JSON.parse(git("show", `${commit}:package.json`)).version !== version.slice(1)
)
  throw new Error("Package version differs from release tag");
const release = {
  schemaVersion: 1,
  version,
  commit,
  createdAt: git("show", "-s", "--format=%cI", commit).toString().trim(),
  artifacts: {},
  body: notesFile ? (await readFile(notesFile, "utf8")).slice(0, 16000) : "",
};
const images = await readFile(imageFile);
validateImages(JSON.parse(images), release);
await mkdir(directory, { recursive: true });
for (const name of artifactNames) {
  let body;
  if (name === "source.tar.gz")
    body = git("archive", "--format=tar.gz", "--prefix=towbar/", commit);
  else if (name === "towbar-images.json") body = images;
  else
    body = git(
      "show",
      `${commit}:${name === "towbar" ? "infra/towbar" : name.endsWith(".v2.json") ? "packages/towbar-core/schemas/" + name : name}`,
    );
  release.artifacts[name] = sha256(body);
  await writeFile(`${directory}/${name}`, body);
}
const sums = artifactNames
  .map((name) => `${release.artifacts[name]}  ${name}\n`)
  .join("");
await writeFile(`${directory}/SHA256SUMS`, sums);
release.artifacts.SHA256SUMS = sha256(sums);
validateRelease(release);
await writeFile(
  `${directory}/release.json`,
  JSON.stringify(release, null, 2) + "\n",
);
