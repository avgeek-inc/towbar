"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Key } from "react";

import { AwsIntegration } from "@/components/aws-integration";
import { GitHubSettings } from "@/components/github-settings";
import { ResponsiveSubtabs } from "@/components/responsive-subtabs";

const integrationKeys = new Set(["github", "aws"]);

export function Integrations() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("integration");
  const selectedKey =
    requested && integrationKeys.has(requested) ? requested : "github";

  function selectIntegration(key: Key) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("integration", String(key));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <ResponsiveSubtabs
      ariaLabel="Integrations"
      collapseOnMobile
      defaultSelectedKey="github"
      selectedKey={selectedKey}
      tabs={[
        { content: <GitHubSettings />, label: "GitHub", value: "github" },
        { content: <AwsIntegration />, label: "AWS", value: "aws" },
      ]}
      onSelectionChange={selectIntegration}
    />
  );
}
