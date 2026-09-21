"use client";

import { FieldDescription } from "@workspace/web-design-system/forms/field";
import {
  TableCellStack,
  TableCellDescription,
} from "@workspace/towbar-web-ui/table-cell-text";

import { TeamAuditLogs } from "./team-audit-logs";
import { hasHttpsExternalAccess } from "@/lib/config";
import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UserAccountIcon,
  Settings01Icon,
  Add01Icon,
  Mail01Icon,
  FileSearchIcon,
  ComputerTerminal01Icon,
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
import { Button } from "@workspace/web-design-system/buttons/button";
import { Label } from "@workspace/web-design-system/forms/label";
import { Select, ListBox } from "@workspace/web-design-system/forms/select";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import {
  DashboardPage,
  FormCard,
  SimpleForm,
  ActionButton,
} from "./page-parts";
import { SecondaryItems } from "./secondary-sidebar";
import { PageSelectionTitle } from "./page-selection-title";
import { AuthForm } from "./auth-form";
import { RelativeTime } from "./last-synced-time";
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
  deliveryStatus: string | null;
  errorCode: string | null;
};
type Dialog = {
  mode: "create" | "invite" | "role";
  member?: Member;
  instance: number;
};
export function RoleSelect({
  value,
  onChange,
}: {
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
}) {
  return (
    <Select
      selectedKey={value}
      onSelectionChange={(key) => {
        if (isWorkspaceRole(key)) onChange(key);
      }}
      fullWidth
      isRequired
      variant="secondary"
    >
      <Label isRequired>Role</Label>
      <Select.Trigger>
        <Select.Value>{roleLabels[value]}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="w-(--trigger-width)">
        <ListBox>
          {workspaceRoles.map((role) => (
            <ListBox.Item id={role} key={role} textValue={roleLabels[role]}>
              <div className="grid min-w-0 flex-1 gap-1 pr-3">
                <span className="font-medium">{roleLabels[role]}</span>
                <span className="text-xs leading-relaxed font-normal text-muted whitespace-normal">
                  {roleDescriptions[role]}
                </span>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
export type TeamSettingsPage =
  "members" | "general" | "api-keys" | "audit-logs" | "ssh-keys";

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
  "ssh-keys": {
    icon: ComputerTerminal01Icon,
    label: "SSH keys",
    permission: "privateKey.manage",
  },
};

const teamSettingsGroups = [
  { title: "Account", pages: ["general", "members"] },
  { title: "Security", pages: ["api-keys", "audit-logs", "ssh-keys"] },
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
          .filter((id) => id !== "api-keys" || hasHttpsExternalAccess)
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
      <FormCard
        title="Team details"
        icon={<HugeiconsIcon icon={Settings01Icon} />}
      >
        <SimpleForm
          key={query.data.team.name}
          fields={[
            {
              name: "name",
              label: "Team name",
              required: true,
              maxLength: 120,
              defaultValue: query.data.team.name,
              variant: "secondary",
            },
            {
              name: "description",
              label: "Description",
              type: "textarea",
              rows: 3,
              maxLength: 500,
              defaultValue: query.data.team.description ?? "",
              variant: "secondary",
            },
          ]}
          submitLabel="Update"
          successMessage="Team updated"
          onSubmit={async (values) => {
            await api.patch("/v1/core/team", values);
            refreshApiQueries();
            window.dispatchEvent(new Event("towbar:identity-changed"));
          }}
        />
      </FormCard>
    </div>
  );
}
function TeamMembers() {
  const { user } = useAccess();
  const [offset, setOffset] = useState(0);
  const members = useApiQuery<{ members: Member[]; total: number }>(
    `/v1/core/team/members?offset=${offset}&limit=25`,
  );
  const invitations = useApiQuery<{ invitations: Invitation[] }>(
    "/v1/core/team/invitations",
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
  const columns: ResourceTableColumn<Member>[] = [
    {
      key: "member",
      header: "Member",
      cell: (member) => (
        <TableCellStack as="div">
          <span>
            {member.name}
            {member.userId === user?.id ? " (you)" : ""}
          </span>
          <TableCellDescription className="break-words">
            {member.email}
          </TableCellDescription>
        </TableCellStack>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (member) => (
        <StatusBadge status={member.role} label={roleLabels[member.role]} />
      ),
    },
    {
      key: "account",
      header: "Account",
      cell: (member) => (
        <StatusBadge
          status={member.mustChangePassword ? "pending" : "active"}
          label={
            member.mustChangePassword ? "Password setup pending" : "Active"
          }
        />
      ),
    },
    {
      key: "two-factor",
      header: "2FA",
      cell: (member) => (
        <StatusBadge
          status={member.twoFactorEnabled ? "healthy" : "disabled"}
          label={member.twoFactorEnabled ? "Enabled" : "Not enabled"}
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (member) => (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => edit("role", member)}>
            Edit
          </Button>
          <ActionButton
            variant="danger"
            success="Team access removed"
            confirm={{
              title: `Remove ${member.name}?`,
              description:
                "This revokes their sessions and personal API keys. Operational history is retained.",
              actionLabel: "Remove access",
            }}
            action={async () => {
              await api.delete(`/v1/core/team/members/${member.id}`);
              refreshApiQueries();
              window.dispatchEvent(new Event("towbar:identity-changed"));
            }}
          >
            Remove
          </ActionButton>
        </div>
      ),
    },
  ];
  const pending = (invitations.data?.invitations ?? []).filter(
    (invitation) => invitation.status === "pending",
  );
  const inviteColumns: ResourceTableColumn<Invitation>[] = [
    {
      key: "email",
      header: "Pending Invitations",
      cell: (invitation) => (
        <span className="break-words">{invitation.email}</span>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (invitation) => (
        <StatusBadge
          status={invitation.role}
          label={roleLabels[invitation.role]}
        />
      ),
    },
    {
      key: "expires",
      header: "Expires",
      cell: (invitation) => (
        <RelativeTime value={invitation.expiresAt} label="Expires" />
      ),
    },
    {
      key: "delivery",
      header: "Delivery",
      cell: (invitation) => (
        <TableCellStack as="div">
          <StatusBadge
            status={
              invitation.deliveryStatus === "sent"
                ? "succeeded"
                : (invitation.deliveryStatus ?? "pending")
            }
            label={
              invitation.deliveryStatus === "sent"
                ? "Sent to mail server"
                : invitation.deliveryStatus === "failed"
                  ? "Delivery failed"
                  : "Pending"
            }
          />
          {invitation.errorCode === "SMTP_NOT_CONFIGURED" ? (
            <TableCellDescription>
              Configure SMTP in Integrations.
            </TableCellDescription>
          ) : null}
        </TableCellStack>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (invitation) => (
        <div className="flex justify-end gap-2">
          <CopyTextButton
            text={() => `${window.location.origin}/invite/${invitation.id}`}
          >
            Copy link
          </CopyTextButton>
          <ActionButton
            variant="secondary"
            success="New invitation created"
            confirm={{
              title: "Resend invitation?",
              description: `Send a new invitation to ${invitation.email}? Their previous invitation will no longer work.`,
              actionLabel: "Resend",
            }}
            action={async () => {
              await api.post("/v1/core/team/invitations", {
                email: invitation.email,
                role: invitation.role,
              });
              refreshApiQueries();
            }}
          >
            Resend
          </ActionButton>
          <ActionButton
            variant="danger"
            success="Invitation revoked"
            confirm={{
              title: "Revoke invitation?",
              description: `The invitation for ${invitation.email} will no longer work.`,
              actionLabel: "Revoke",
            }}
            action={async () => {
              await api.delete(`/v1/core/team/invitations/${invitation.id}`);
              refreshApiQueries();
            }}
          >
            Revoke
          </ActionButton>
        </div>
      ),
    },
  ];
  if (members.error) return <QueryError message={members.error} />;
  if (!members.data) return <QueryLoading />;
  return (
    <div className="content-grid">
      <PageSelectionTitle label="Members" actions={actions} />
      <ResourceTable
        ariaLabel="Team members"
        columns={columns}
        items={members.data.members}
        emptyTitle="No members"
        emptyDescription="Add a team member to get started."
        getRowKey={(member) => member.id}
      />
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
        <ResourceTable
          ariaLabel="Pending invitations"
          columns={inviteColumns}
          items={pending}
          getRowKey={(invitation) => invitation.id}
          emptyTitle="No pending invitations"
          emptyDescription="Invite someone by email to let them choose their own password."
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
  const [role, setRole] = useState<WorkspaceRole>(
    dialog.member?.role ?? "member",
  );
  const [inviteUrl, setInviteUrl] = useState<string>();
  const title =
    dialog.mode === "create"
      ? "Add user"
      : dialog.mode === "invite"
        ? "Create invitation"
        : `Edit ${dialog.member?.name}`;
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container size="sm" scroll="inside">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {inviteUrl ? (
              <div className="content-grid">
                <p>
                  Invitation created. The recipient must verify their email
                  before joining.
                </p>
                <CopyTextButton text={inviteUrl}>
                  Copy invitation link
                </CopyTextButton>
                <Button variant="secondary" onPress={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <AuthForm
                variant="secondary"
                errorPresentation="toast"
                onCancel={() => onOpenChange(false)}
                fields={
                  dialog.mode === "role"
                    ? [
                        {
                          name: "name",
                          label: "Name",
                          defaultValue: dialog.member?.name,
                          required: true,
                          maxLength: 120,
                          autoComplete: "off",
                        },
                      ]
                    : [
                        ...(dialog.mode === "create"
                          ? [
                              {
                                name: "name",
                                label: "Name",
                                required: true,
                                maxLength: 120,
                                autoComplete: "off",
                              },
                            ]
                          : []),
                        {
                          name: "email",
                          label: "Email",
                          type: "email",
                          required: true,
                          maxLength: 320,
                          autoComplete: "off",
                        },
                        ...(dialog.mode === "create"
                          ? [
                              {
                                name: "password",
                                label: "Temporary password",
                                type: "password",
                                required: true,
                                minLength: 15,
                                maxLength: 1024,
                                autoComplete: "new-password",
                              },
                            ]
                          : []),
                      ]
                }
                submitLabel={
                  dialog.mode === "role"
                    ? "Update"
                    : dialog.mode === "invite"
                      ? "Create invitation"
                      : "Add user"
                }
                onSubmit={async (values) => {
                  if (dialog.mode === "create") {
                    await api.post("/v1/core/team/members", {
                      ...values,
                      role,
                    });
                  } else if (dialog.mode === "role")
                    await api.patch(
                      `/v1/core/team/members/${dialog.member!.id}`,
                      { role, name: values.name },
                    );
                  else {
                    const result = await api.post<{ inviteUrl: string }>(
                      "/v1/core/team/invitations",
                      { ...values, role },
                    );
                    setInviteUrl(result.inviteUrl);
                  }
                  refreshApiQueries();
                  window.dispatchEvent(new Event("towbar:identity-changed"));
                  if (dialog.mode !== "invite") onOpenChange(false);
                }}
              >
                <RoleSelect value={role} onChange={setRole} />
                {dialog.mode === "create" ? (
                  <FieldDescription>
                    This password is valid only for the first sign-in. The user
                    will choose a new password during account setup.
                  </FieldDescription>
                ) : null}
              </AuthForm>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
