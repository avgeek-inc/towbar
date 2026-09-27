# MCP connection visual review

This fixture renders the real `/oauth/consent` and `/settings/api-keys` pages with local sample data. It does not create credentials or grant access. Approve and Deny deliberately return a sample failure so the recovery state can be reviewed.

From the repository root, start Next in one terminal:

```sh
NEXT_PUBLIC_TOWBAR_APP_BASE_URL=http://localhost:4420 pnpm --filter towbar-web-app exec next dev --hostname 127.0.0.1 --port 4038
```

In another terminal:

```sh
pnpm --filter towbar-web-app exec node scripts/mcp-oauth-review.ts
```

Open `http://localhost:4420`. The fixture binds IPv6 loopback (`::1`) so it can coexist with the standard fixture on `127.0.0.1:4420`. Use `--ipv4` if IPv6 is unavailable and port 4420 is free. Do not stop another review server to reuse its port.

| Route                               | State                                           |
| ----------------------------------- | ----------------------------------------------- |
| `/oauth/consent?request=review`     | ChatGPT, published domain, read-only access     |
| `/oauth/consent?request=edit`       | Edit access, including secret updates           |
| `/oauth/consent?request=unknown`    | Unverified app and local return destination     |
| `/oauth/consent?request=viewer`     | Viewer asked for edit access; approval disabled |
| `/oauth/consent?request=expired`    | Expired or previously used link                 |
| `/oauth/consent?request=signed-out` | Sign-in link preserving the return path         |
| `/oauth/consent`                    | Incomplete link                                 |
| `/settings/api-keys`                | Known app, unverified app and existing API key  |

To compare with the existing sign-in screen, restart this fixture with `--signed-out` and open `/login`. Restart without the flag before reviewing the key inventory.

For the empty key inventory, stop only this review fixture, restart it with `--empty-keys`, and reload `/settings/api-keys`. Next can remain running. Restart without that flag to restore the sample keys.

Review at desktop (1280 or 1440 × 900) and narrow (390 × 844) sizes. On narrow screens, scroll the table sideways to reach expiry and Revoke. Expand **Connection details** with Enter or Space and verify that complete URLs wrap without horizontal page overflow. The controls use Towbar’s shared compact sizing without local height overrides. App identities use 16px icons and 14px text: medium weight on consent and regular weight in key rows. The consent form starts 32px below the introduction. The auth content keeps the existing 384px maximum width. The return URL is available only inside Connection details.

These are visual fixtures. Protocol, token exchange, expiry, revocation, redirect and permission guarantees are covered separately by the API integration tests in `src/areas/mcp-oauth`.
