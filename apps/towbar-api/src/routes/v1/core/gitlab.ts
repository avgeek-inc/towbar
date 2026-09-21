import { Hono } from "hono";
import { z } from "zod";
import {
  listAvailableGitLabConnections,
  listGitLabBranches,
  listGitLabGroups,
  listGitLabRepositories,
} from "../../../areas/gitlab/service.js";
import { operation } from "../../../http/operation.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";
import {
  beginGitLabAuthorization,
  completeGitLabAuthorization,
  disconnectGitLabAuthorization,
} from "../../../areas/gitlab/oauth.js";
import { getEnv } from "../../../env.js";
import { unauthorized } from "../../../http/errors.js";

const pagedQuery = z
  .object({
    integration: z.string().min(1).max(64),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
const branchesQuery = z
  .object({
    integration: z.string().min(1).max(64),
    owner: z.string().min(1).max(255),
    repository: z.string().min(1).max(255),
  })
  .strict();

export const gitlabRoutes = new Hono<TowbarHonoEnvironment>();

gitlabRoutes.post(
  "/oauth/start",
  operation({
    permissions: ["integration.manage"],
    browserOnly: true,
    responseSchema: 'gitlab.ts:post:"/oauth/start"',
    response: "GitLab OAuth authorization URL and expiry.",
    status: 200,
    summary: "Start GitLab OAuth authorization",
  }),
  async (context) => {
    const user = context.get("user");
    if (!user.id) throw unauthorized();
    return context.json(
      await beginGitLabAuthorization({
        userId: user.id,
        workspaceId: user.workspaceId,
      }),
    );
  },
);

gitlabRoutes.get(
  "/oauth/callback",
  operation({
    permissions: ["integration.manage"],
    browserOnly: true,
    query: z
      .object({ code: z.string().min(1), state: z.string().min(32) })
      .strict(),
    responseSchema: 'gitlab.ts:get:"/oauth/callback"',
    response: "Redirect to the GitLab integration after authorization.",
    status: 302,
    summary: "Complete GitLab OAuth authorization",
  }),
  async (context) => {
    const user = context.get("user");
    if (!user.id) throw unauthorized();
    const query = z
      .object({ code: z.string().min(1), state: z.string().min(32) })
      .strict()
      .parse(context.req.query());
    await completeGitLabAuthorization({
      ...query,
      userId: user.id,
      workspaceId: user.workspaceId,
    });
    return context.redirect(
      new URL(
        "/manage/integrations/gitlab?connected=true",
        getEnv().TOWBAR_APP_BASE_URL,
      ).toString(),
      302,
    );
  },
);

gitlabRoutes.delete(
  "/oauth/connection",
  operation({
    permissions: ["integration.manage"],
    browserOnly: true,
    responseSchema: 'gitlab.ts:delete:"/oauth/connection"',
    response: "No response body.",
    status: 204,
    summary: "Disconnect GitLab OAuth authorization",
  }),
  async (context) => {
    await disconnectGitLabAuthorization({
      workspaceId: context.get("user").workspaceId,
    });
    return context.body(null, 204);
  },
);

gitlabRoutes.get(
  "/connections",
  operation({
    permissions: ["repository.connect"],
    responseSchema: 'gitlab.ts:get:"/connections"',
    response: "Connected GitLab providers available for repository access.",
    status: 200,
    summary: "List available GitLab connections",
  }),
  async (context) =>
    context.json({
      connections: await listAvailableGitLabConnections(
        context.get("user").workspaceId,
      ),
    }),
);

gitlabRoutes.get(
  "/repositories",
  operation({
    permissions: ["repository.connect"],
    query: pagedQuery,
    responseSchema: 'gitlab.ts:get:"/repositories"',
    response: "A bounded page of repositories visible to a GitLab integration.",
    status: 200,
    summary: "List GitLab repositories",
  }),
  async (context) =>
    context.json(
      await listGitLabRepositories({
        ...pagedQuery.parse(context.req.query()),
        workspaceId: context.get("user").workspaceId,
      }),
    ),
);

gitlabRoutes.get(
  "/groups",
  operation({
    permissions: ["repository.connect"],
    query: pagedQuery,
    responseSchema: 'gitlab.ts:get:"/groups"',
    response: "A bounded page of GitLab groups visible to the integration.",
    status: 200,
    summary: "List GitLab groups",
  }),
  async (context) =>
    context.json(
      await listGitLabGroups({
        ...pagedQuery.parse(context.req.query()),
        workspaceId: context.get("user").workspaceId,
      }),
    ),
);

gitlabRoutes.get(
  "/branches",
  operation({
    permissions: ["repository.connect"],
    query: branchesQuery,
    responseSchema: 'gitlab.ts:get:"/branches"',
    response: "Branch names visible to the selected GitLab integration.",
    status: 200,
    summary: "List GitLab repository branches",
  }),
  async (context) => {
    const input = branchesQuery.parse(context.req.query());
    return context.json({
      branches: await listGitLabBranches({
        integration: input.integration,
        repositoryName: input.repository,
        repositoryOwner: input.owner,
        workspaceId: context.get("user").workspaceId,
      }),
    });
  },
);
