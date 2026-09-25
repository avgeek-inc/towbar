import { Alert } from "@workspace/web-design-system/feedback/alert";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";

export function DeployableReadiness({
  ready,
  serverId,
  serverIp,
}: {
  ready: boolean;
  serverId: string;
  serverIp: string;
}) {
  if (ready) return null;

  return (
    <Alert
      status="warning"
      className="grid! grid-cols-[auto_minmax(0,1fr)] gap-y-3 sm:flex!"
    >
      <Alert.Indicator />
      <Alert.Content className="min-w-0 sm:flex-1">
        <Alert.Title>Deployment blocked by server setup</Alert.Title>
        <Alert.Description>
          Set up server {serverIp} before deployments and log captures can run.
        </Alert.Description>
      </Alert.Content>
      <ButtonLink
        className="col-start-2 justify-self-start whitespace-nowrap sm:ml-auto sm:shrink-0"
        href={`/servers/${serverId}`}
        variant="secondary"
      >
        Open Server Setup
      </ButtonLink>
    </Alert>
  );
}
