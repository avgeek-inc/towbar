import { z } from "zod";

const branchPageSchema = z.array(z.object({ name: z.string().min(1) }));

export async function collectGitLabBranches(input: {
  maxPages: number;
  readJson: (response: Response) => Promise<unknown>;
  requestPage: (page: number) => Promise<Response>;
  tooManyError: Error;
}) {
  const names = new Set<string>();
  let page = 1;
  for (let pagesFetched = 0; pagesFetched < input.maxPages; pagesFetched += 1) {
    const response = await input.requestPage(page);
    const branches = branchPageSchema.parse(await input.readJson(response));
    for (const branch of branches) names.add(branch.name);

    const nextPageHeader = response.headers.get("x-next-page");
    if (nextPageHeader !== null) {
      const nextPage = Number(nextPageHeader);
      if (nextPage === 0) return [...names].sort();
      if (!Number.isInteger(nextPage) || nextPage <= page)
        throw new Error("GitLab returned an invalid next branch page");
      page = nextPage;
    } else {
      if (branches.length < 100) return [...names].sort();
      page += 1;
    }
  }
  throw input.tooManyError;
}
