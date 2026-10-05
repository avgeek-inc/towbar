export async function publicationCredentials(
  identity,
  commit,
  env = process.env,
  fetcher = fetch,
) {
  if (
    !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ||
    !env.CLOUDFLARE_ACCOUNT_ID
  )
    throw new Error(
      "Publication requires a GitHub Actions OIDC token and Cloudflare account ID",
    );
  const audience = new URL(identity.distributionUrl).origin;
  const tokenUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (tokenUrl.protocol !== "https:")
    throw new Error("OIDC token endpoint must use HTTPS");
  tokenUrl.searchParams.set("audience", audience);
  const tokenResponse = await fetcher(tokenUrl, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!tokenResponse.ok)
    throw new Error("GitHub did not issue a publication token");
  const { value: token } = await tokenResponse.json();
  if (typeof token !== "string" || !token)
    throw new Error("GitHub returned an invalid publication token");
  const response = await fetcher(`${audience}/publishing/credentials`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Publication credential request failed (${response.status})`,
    );
  const credentials = await response.json();
  if (
    credentials.schemaVersion !== 1 ||
    credentials.prefix !== identity.releasePrefix ||
    credentials.bucket !== identity.releaseBucket ||
    credentials.commit !== commit ||
    credentials.endpoint !==
      `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` ||
    ![
      credentials.accessKeyId,
      credentials.secretAccessKey,
      credentials.sessionToken,
    ].every((value) => typeof value === "string" && value.length > 0) ||
    !Number.isFinite(Date.parse(credentials.expiresAt)) ||
    Date.parse(credentials.expiresAt) <= Date.now()
  )
    throw new Error("Publication credentials do not match the release");
  return credentials;
}
