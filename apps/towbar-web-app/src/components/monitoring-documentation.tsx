import { ButtonLink } from "@avgeek-oss/design-system/buttons/button";

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
      <span>
        Scout Agent documentation
        <span aria-hidden="true">↗</span>
      </span>
    </ButtonLink>
  );
}
