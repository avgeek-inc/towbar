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
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content className="min-w-0 flex-1">
        <Alert.Title>Deployment blocked by server setup</Alert.Title>
        <Alert.Description>
          Set up server {serverIp} before deployments and log captures can run.
        </Alert.Description>
      </Alert.Content>
      <ButtonLink
        className="ml-auto shrink-0 whitespace-nowrap"
        href={`/servers/${serverId}`}
        variant="secondary"
      >
        Open Server Setup
      </ButtonLink>
    </Alert>
  );
}
