import type { ConfigurationFile } from "@workspace/towbar-core";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

export function ContainerRuntimeDetails({
  container,
}: {
  container: {
    port?: number;
    command?: string[];
    entrypoint?: string;
    configFiles?: ConfigurationFile[];
  };
}) {
  return (
    <>
      <Attributes.Item label="Entrypoint">
        {container.entrypoint === undefined ? (
          "Image default"
        ) : container.entrypoint === "" ? (
          "Cleared"
        ) : (
          <TypographyCode className="break-all">
            {container.entrypoint}
          </TypographyCode>
        )}
      </Attributes.Item>
      <Attributes.Item label="Startup command" className="col-span-2">
        {container.command?.length ? (
          <TypographyCode className="break-all">
            {container.command.join(" ")}
          </TypographyCode>
        ) : (
          "Image default"
        )}
      </Attributes.Item>
      <Attributes.Item label="Configuration files" className="col-span-2">
        {container.configFiles?.length ? (
          <span className="grid gap-2">
            {container.configFiles.map((file) => (
              <span className="grid min-w-0 gap-1" key={file.mountPath}>
                <TypographyCode className="break-all">
                  {file.source} → {file.mountPath}
                </TypographyCode>
                <span className="typography--body-xs text-muted">
                  Read-only{file.mode === "0555" ? " · Executable" : ""}
                </span>
              </span>
            ))}
          </span>
        ) : (
          "None"
        )}
      </Attributes.Item>
    </>
  );
}
