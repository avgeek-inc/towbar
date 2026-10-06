"use client";

import { TeamAuditLogs } from "./team-audit-logs";
import { canShowApiMcpSettings } from "@/lib/config";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UserAccountIcon,
  Settings01Icon,
  Add01Icon,
  Mail01Icon,
  FileSearchIcon,
} from "@hugeicons/core-free-icons";
import {
  roleLabels,
  roleDescriptions,
  workspaceRoles,
  isWorkspaceRole,
  type Action,
  type WorkspaceRole,
} from "@workspace/towbar-access";
import { CopyTextButton } from "./copy-text-button";
import { ApiMcpSettings } from "./api-mcp-settings";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@avgeek-oss/design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { DashboardPage } from "./page-parts";
import { SecondaryItems } from "./secondary-sidebar";
import { PageSelectionTitle } from "./page-selection-title";
import {
  TeamGeneralSettings,
  AddMemberDialog,
  InviteMemberDialog,
  MemberEditDialog,
  MembersTable,
  InvitationsTable,
  RemoveMemberDialog,
} from "@avgeek-oss/design-system";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
import { RelativeTime } from "./last-synced-time";
import { getPendingInvitations } from "@/lib/pending-invitations";
import { useAccess } from "./access-context";
import { useApiQuery, refreshApiQueries } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  mustChangePassword: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
};
type Invitation = {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  expiresAt: string;
};
type Dialog = {
  mode: "create" | "invite" | "role";
  member?: Member;
  instance: number;
};

const noInvitations: Invitation[] = [];

function usePendingInvitations(invitations: Invitation[]) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      const currentTime = Date.now();
      setNow(currentTime);
      const pending = getPendingInvitations(invitations, currentTime);
      const nextExpiry = Math.min(
        ...pending.map((item) => Date.parse(item.expiresAt)),
      );
      if (Number.isFinite(nextExpiry)) {
        timer = setTimeout(
          refresh,
          Math.min(nextExpiry - currentTime, 2_147_483_647),
        );
      }
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [invitations]);
  return getPendingInvitations(invitations, now);
}
const roleOptions = workspaceRoles.map((role) => ({
  id: role,
  label: roleLabels[role],
  description: roleDescriptions[role],
}));
function requireRole(role: string): WorkspaceRole {
  if (!isWorkspaceRole(role)) throw new Error("Choose a valid role");
  return role;
}
function teamChanged() {
  refreshApiQueries();
  window.dispatchEvent(new Event("towbar:identity-changed"));
}
export type TeamSettingsPage =
  "members" | "general" | "api-keys" | "audit-logs";

const teamSettingsPages: Record<
  TeamSettingsPage,
  {
    icon: ComponentProps<typeof HugeiconsIcon>["icon"];
    label: string;
    permission: Action;
  }
> = {
  general: {
    icon: Settings01Icon,
    label: "General",
    permission: "team.read",
  },
  members: {
    icon: UserAccountIcon,
    label: "Members",
    permission: "team.read",
  },
  "api-keys": {
    icon: Key01Icon,
    label: "API Keys",
    permission: "team.read",
  },
  "audit-logs": {
    icon: FileSearchIcon,
    label: "Audit Logs",
    permission: "team.read",
  },
};

const teamSettingsGroups = [
  { title: "Account", pages: ["general", "members"] },
  { title: "Security", pages: ["api-keys", "audit-logs"] },
] as const satisfies Array<{
  title: string;
  pages: readonly TeamSettingsPage[];
}>;

export function TeamSettingsShell({
  children,
  page,
}: {
  children: ReactNode;
  page: TeamSettingsPage;
}) {
  const router = useRouter();
  const { can } = useAccess();
  const active = teamSettingsPages[page];
  if (!can(active.permission))
    return (
      <QueryError message="You do not have permission to manage this team setting." />
    );
  return (
    <DashboardPage title={active.label} icon={active.icon}>
      {teamSettingsGroups.map((group) => {
        const items = group.pages
          .filter((id) => id !== "api-keys" || canShowApiMcpSettings())
          .map((id) => ({ id, ...teamSettingsPages[id] }))
          .filter((item) => can(item.permission));
        return items.length ? (
          <SecondaryItems
            key={group.title}
            title={group.title}
            selected={page}
            onSelect={(value) => router.push(`/team-settings/${value}`)}
            items={items.map((item) => ({
              id: item.id,
              label: item.label,
              icon: <HugeiconsIcon icon={item.icon} />,
            }))}
          />
        ) : null;
      })}
      {children}
    </DashboardPage>
  );
}

export function TeamSettings({
  page,
}: {
  page: "members" | "general" | "api-keys" | "audit-logs";
}) {
  return (
    <TeamSettingsShell page={page}>
      {page === "audit-logs" ? (
        <TeamAuditLogs />
      ) : page === "members" ? (
        <TeamMembers />
      ) : page === "api-keys" ? (
        <ApiMcpSettings section="team-keys" />
      ) : (
        <TeamGeneral />
      )}
    </TeamSettingsShell>
  );
}

function TeamGeneral() {
  const query = useApiQuery<{
    team: { name: string; description: string | null };
  }>("/v1/core/team");
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  return (
    <div className="content-grid lg:grid-cols-2 lg:items-start">
      <TeamGeneralSettings
        mode="details"
        value={{
          name: query.data.team.name,
          description: query.data.team.description ?? "",
        }}
        onSave={async (values) => {
          await api.patch("/v1/core/team", values);
          refreshApiQueries();
          window.dispatchEvent(new Event("towbar:identity-changed"));
        }}
      />
    </div>
  );
}
function TeamMembers() {
  const [offset, setOffset] = useState(0);
  const members = useApiQuery<{ members: Member[]; total: number }>(
    `/v1/core/team/members?offset=${offset}&limit=25`,
  );
  const invitations = useApiQuery<{ invitations: Invitation[] }>(
    "/v1/core/team/invitations",
  );
  const pending = usePendingInvitations(
    invitations.data?.invitations ?? noInvitations,
  );
  const [dialog, setDialog] = useState<Dialog>({ mode: "invite", instance: 0 });
  const [open, setOpen] = useState(false);
  const edit = (mode: Dialog["mode"], member?: Member) => {
    setDialog((previous) => ({
      mode,
      member,
      instance: previous.instance + 1,
    }));
    setOpen(true);
  };
  const actions = useMemo(
    () => (
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onPress={() => {
            setDialog((previous) => ({
              mode: "create",
              instance: previous.instance + 1,
            }));
            setOpen(true);
          }}
        >
          <HugeiconsIcon icon={Add01Icon} className="size-4" />
          Add user
        </Button>
        <Button
          onPress={() => {
            setDialog((previous) => ({
              mode: "invite",
              instance: previous.instance + 1,
            }));
            setOpen(true);
          }}
        >
          <HugeiconsIcon icon={Mail01Icon} className="size-4" />
          Create invite
        </Button>
      </div>
    ),
    [],
  );
  const [removing, setRemoving] = useState<Member | null>(null);
  if (members.error) return <QueryError message={members.error} />;
  if (!members.data) return <QueryLoading />;
  return (
    <div className="content-grid">
      <PageSelectionTitle label="Members" actions={actions} />
      <MembersTable
        roles={roleOptions}
        items={members.data.members.map((member) => ({
          ...member,
          passkeyEnabled: member.twoFactorEnabled,
          accountStatus: {
            label: member.mustChangePassword
              ? "Password setup pending"
              : "Active",
            color: member.mustChangePassword
              ? ("warning" as const)
              : ("success" as const),
          },
        }))}
        actions={(member) => (
          <>
            <Button variant="secondary" onPress={() => edit("role", member)}>
              Edit
            </Button>
            <Button variant="danger" onPress={() => setRemoving(member)}>
              Remove
            </Button>
          </>
        )}
      />
      {removing ? (
        <RemoveMemberDialog
          isOpen
          onOpenChange={(value) => {
            if (!value) setRemoving(null);
          }}
          member={removing}
          onRemove={async () => {
            await api.delete(`/v1/core/team/members/${removing.id}`);
            teamChanged();
            toast.success("Team access removed");
          }}
        />
      ) : null}
      {members.data.total > 25 ? (
        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-muted">
            {offset + 1}–{Math.min(offset + 25, members.data.total)} of{" "}
            {members.data.total}
          </span>
          <Button
            variant="secondary"
            isDisabled={offset === 0}
            onPress={() => setOffset(Math.max(0, offset - 25))}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            isDisabled={offset + 25 >= members.data!.total}
            onPress={() => setOffset(offset + 25)}
          >
            Next
          </Button>
        </div>
      ) : null}

      {invitations.error ? (
        <QueryError message={invitations.error} />
      ) : (
        <InvitationsTable
          roles={roleOptions}
          items={pending.map((invitation) => ({
            ...invitation,
            status: undefined,
          }))}
          formatDate={(value) => (
            <RelativeTime value={value} label="Expires" display="relative" />
          )}
          actions={(invitation) => (
            <CopyTextButton
              text={() => `${window.location.origin}/invite/${invitation.id}`}
            >
              Copy link
            </CopyTextButton>
          )}
          onResend={async (invitation) => {
            await api.post("/v1/core/team/invitations", {
              email: invitation.email,
              role: invitation.role,
            });
            refreshApiQueries();
            toast.success("New invitation created");
          }}
          onRevoke={async (invitation) => {
            await api.delete(`/v1/core/team/invitations/${invitation.id}`);
            refreshApiQueries();
            toast.success("Invitation revoked");
          }}
        />
      )}
      <MemberDialog
        key={dialog.instance}
        dialog={dialog}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
function MemberDialog({
  dialog,
  open,
  onOpenChange,
}: {
  dialog: Dialog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const shared = { isOpen: open, onOpenChange, roles: roleOptions };
  if (dialog.mode === "create")
    return (
      <AddMemberDialog
        {...shared}
        onAdd={async (values) => {
          await api.post("/v1/core/team/members", {
            ...values,
            role: requireRole(values.role),
          });
          teamChanged();
          toast.success("User added");
        }}
      />
    );
  if (dialog.mode === "role") {
    if (!dialog.member) return null;
    const member = dialog.member;
    return (
      <MemberEditDialog
        {...shared}
        member={member}
        onSave={async (values) => {
          await api.patch(`/v1/core/team/members/${member.id}`, {
            ...values,
            role: requireRole(values.role),
          });
          teamChanged();
          toast.success("Member updated");
        }}
      />
    );
  }
  return (
    <InviteMemberDialog
      {...shared}
      resultGuidance={
        <p>The recipient must verify their email before joining.</p>
      }
      onInvite={async (values) => {
        const result = await api.post<{ inviteUrl: string }>(
          "/v1/core/team/invitations",
          { ...values, role: requireRole(values.role) },
        );
        teamChanged();
        toast.success("Invitation created");
        return result;
      }}
    />
  );
}
