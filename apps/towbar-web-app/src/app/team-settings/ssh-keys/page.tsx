import { ApiMcpSettings } from "@/components/api-mcp-settings";
import { TeamSettingsShell } from "@/components/team-settings";

export default function Page() {
  return (
    <TeamSettingsShell page="ssh-keys">
      <ApiMcpSettings section="private-keys" />
    </TeamSettingsShell>
  );
}
