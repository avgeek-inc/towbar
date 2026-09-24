"use client";

import {
  BookOpen01Icon,
  GithubIcon,
  Key01Icon,
  Logout03Icon,
  Mail01Icon,
  Message01Icon,
  News01Icon,
  Settings01Icon,
  UserAccountIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";

import type { TowbarUser } from "@workspace/towbar-web-client";
import { Avatar } from "@workspace/web-design-system/data-display/avatar";
import { useMobileNavigation } from "@workspace/web-design-system/navigation/app-layout";
import {
  Dropdown,
  Header,
} from "@workspace/web-design-system/overlays/dropdown";

const changelogUrl =
  "https://github.com/avgeek-inc/towbar/blob/main/CHANGELOG.md";
const documentationUrl = "https://www.towbar.dev/docs";
const repositoryUrl = "https://github.com/avgeek-inc/towbar";

export function AccountMenu({
  user,
  onLogoutRequest,
}: {
  user: TowbarUser;
  onLogoutRequest: () => void;
}) {
  const router = useRouter();
  const { close } = useMobileNavigation();

  const onAction = (key: React.Key) => {
    switch (key) {
      case "profile":
      case "preferences":
      case "email-password":
      case "api-keys":
        router.push(`/settings/${key}`);
        break;
      case "changelog":
        window.open(changelogUrl, "_blank", "noopener,noreferrer");
        break;
      case "documentation":
        window.open(documentationUrl, "_blank", "noopener,noreferrer");
        break;
      case "repository":
        window.open(repositoryUrl, "_blank", "noopener,noreferrer");
        break;
      case "feedback":
        window.location.href = "mailto:feedback@towbar.dev";
        break;
      case "logout":
        onLogoutRequest();
        break;
    }
    close();
  };

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={`Account menu for ${user.name}`}
        className="sidebar-identity flex min-h-16 w-full min-w-0 items-center gap-2.5 px-4 py-3 text-start text-sm"
      >
        <Avatar
          aria-hidden="true"
          className="size-9 shrink-0"
          email={user.email}
          name={user.name}
          size="md"
          src={user.avatarUrl}
        />
        <span className="grid min-w-0 flex-1 gap-0.25">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs text-foreground/70">
            {user.teamName}
          </span>
        </span>
      </Dropdown.Trigger>
      <Dropdown.Popover
        className="w-60 max-w-[calc(100vw-2rem)] rounded-2xl border border-separator"
        placement="top start"
      >
        <div className="grid gap-0.25 border-b border-separator px-3 py-3">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted">{user.email}</div>
        </div>
        <Dropdown.Menu aria-label="Account menu" onAction={onAction}>
          <Dropdown.Section className="w-full" aria-label="Account">
            <Header>Account</Header>
            <Dropdown.Item id="profile" textValue="Profile">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-muted"
                icon={UserAccountIcon}
              />
              Profile
            </Dropdown.Item>
            <Dropdown.Item id="preferences" textValue="Preferences">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-muted"
                icon={Settings01Icon}
              />
              Preferences
            </Dropdown.Item>
            <Dropdown.Item id="email-password" textValue="Auth & Security">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-muted"
                icon={Mail01Icon}
              />
              Auth &amp; Security
            </Dropdown.Item>
            <Dropdown.Item id="api-keys" textValue="My API Keys">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-muted"
                icon={Key01Icon}
              />
              My API Keys
            </Dropdown.Item>
          </Dropdown.Section>
          <Dropdown.Section
            aria-label="Help and updates"
            className="mt-1.5 w-full border-t border-separator pt-1.5"
          >
            <Dropdown.Item id="changelog" textValue="Changelog">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-muted"
                icon={News01Icon}
              />
              Changelog
            </Dropdown.Item>
            <Dropdown.Item id="documentation" textValue="Documentation">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-muted"
                icon={BookOpen01Icon}
              />
              Documentation
            </Dropdown.Item>
            <Dropdown.Item id="repository" textValue="Repo / Contribute">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-muted"
                icon={GithubIcon}
              />
              Repo / Contribute
            </Dropdown.Item>
            <Dropdown.Item id="feedback" textValue="Feedback">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-muted"
                icon={Message01Icon}
              />
              Feedback
            </Dropdown.Item>
          </Dropdown.Section>
          <Dropdown.Section
            aria-label="Session"
            className="mt-1.5 w-full border-t border-separator pt-1.5"
          >
            <Dropdown.Item id="logout" textValue="Sign out" variant="danger">
              <HugeiconsIcon
                aria-hidden="true"
                className="size-4 text-danger"
                icon={Logout03Icon}
              />
              <span className="text-danger">Sign out</span>
            </Dropdown.Item>
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
