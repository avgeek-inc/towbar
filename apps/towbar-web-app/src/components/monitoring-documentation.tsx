import { ButtonLink } from "@workspace/web-design-system/buttons/button";

import { ScoutIcon } from "./scout-icons";

export function MonitoringDocumentation() {
  return (
    <ButtonLink
      href="https://www.towbar.dev/docs/scout"
      variant="secondary"
      target="_blank"
      rel="noreferrer"
    >
      <ScoutIcon name="docs" />
      Scout Agent documentation →
    </ButtonLink>
  );
}
