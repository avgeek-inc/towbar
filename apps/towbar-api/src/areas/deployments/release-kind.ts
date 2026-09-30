import { isNormalizedCompose } from "@workspace/towbar-core";

import { conflict } from "../../http/errors.js";

import type {
  NormalizedDeployable,
  ReleaseCommitPayload,
} from "@workspace/towbar-core";

export function assertReleaseKindMatchesDeployment(
  app: NormalizedDeployable,
  release: ReleaseCommitPayload,
) {
  if (isNormalizedCompose(app) !== (release.imagePlatform === "compose")) {
    throw conflict(
      "The release provenance does not match the deployment kind",
      "RELEASE_KIND_MISMATCH",
    );
  }
}
