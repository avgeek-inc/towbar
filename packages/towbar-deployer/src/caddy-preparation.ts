import type { SshSession } from "./ssh.js";

export const installCaddyScript = String.raw`
set -euo pipefail
requires_cloudflare="$1"
installed_cloudflare_module=false
if test "$(id -u)" -eq 0; then SUDO=(); else SUDO=(sudo -n); fi
has_caddy=false
if command -v caddy >/dev/null; then has_caddy=true; fi
if test "$has_caddy" = true && test "$requires_cloudflare" = true && \
  ! caddy list-modules 2>/dev/null | grep -Fx dns.providers.cloudflare >/dev/null; then
  if ! dpkg-query -W -f='${"$"}{Status}' caddy 2>/dev/null | grep -Fq 'install ok installed'; then
    printf 'The existing Caddy binary is not package-managed and lacks the Cloudflare DNS module. Remove it or use a fresh server.\n' >&2
    exit 72
  fi
fi
if test "$has_caddy" = false; then
  key_source="$(mktemp)"
  keyring="$(mktemp)"
  list_file="$(mktemp)"
  curl --proto '=https' --tlsv1.2 -1fsSL \
    https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o "$key_source"
  gpg --dearmor --batch --yes --output "$keyring" "$key_source"
  curl --proto '=https' --tlsv1.2 -1fsSL \
    https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o "$list_file"
  "${"$"}{SUDO[@]}" install -m 0644 "$keyring" /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  "${"$"}{SUDO[@]}" install -m 0644 "$list_file" /etc/apt/sources.list.d/caddy-stable.list
  rm -f "$key_source" "$keyring" "$list_file"
  export DEBIAN_FRONTEND=noninteractive
  "${"$"}{SUDO[@]}" apt-get update -qq >&2
  "${"$"}{SUDO[@]}" apt-get install -y --no-install-recommends caddy >&2
fi
if test "$requires_cloudflare" = true && \
  ! caddy list-modules 2>/dev/null | grep -Fx dns.providers.cloudflare >/dev/null; then
  build_directory="$(mktemp -d)"
  "${"$"}{SUDO[@]}" docker run --rm \
    --entrypoint xcaddy \
    --volume "$build_directory:/out" \
    caddy:2.11.4-builder \
    build v2.11.4 \
    --with github.com/caddy-dns/cloudflare@v0.2.4 \
    --output /out/caddy >&2
  "${"$"}{SUDO[@]}" test -x "$build_directory/caddy"
  "${"$"}{SUDO[@]}" "$build_directory/caddy" list-modules | grep -Fx dns.providers.cloudflare >/dev/null
  if ! "${"$"}{SUDO[@]}" dpkg-divert --list /usr/bin/caddy | grep -Fq /usr/bin/caddy.default; then
    "${"$"}{SUDO[@]}" dpkg-divert --divert /usr/bin/caddy.default --rename /usr/bin/caddy >&2
  fi
  "${"$"}{SUDO[@]}" install -m 0755 "$build_directory/caddy" /usr/bin/caddy.custom
  "${"$"}{SUDO[@]}" update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.default 10 >&2
  "${"$"}{SUDO[@]}" update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.custom 50 >&2
  "${"$"}{SUDO[@]}" rm -rf "$build_directory"
  installed_cloudflare_module=true
fi
"${"$"}{SUDO[@]}" install -d -m 0755 /etc/caddy /etc/caddy/towbar
"${"$"}{SUDO[@]}" systemctl enable --now caddy >&2
if test "$installed_cloudflare_module" = true; then
  validate_args=(--config /etc/caddy/Caddyfile)
  if "${"$"}{SUDO[@]}" test -s /etc/caddy/towbar/cloudflare.env; then
    validate_args+=(--envfile /etc/caddy/towbar/cloudflare.env)
  fi
  "${"$"}{SUDO[@]}" caddy validate "${"$"}{validate_args[@]}" >/dev/null
  "${"$"}{SUDO[@]}" systemctl restart caddy >&2
fi
if test "$requires_cloudflare" = true; then
  caddy list-modules | grep -Fx dns.providers.cloudflare >/dev/null
fi
printf '%s\n' "$(caddy version | awk '{print $1}')"
`;

export const ensureCloudflareCaddyScript = String.raw`
set -euo pipefail
if test "$(id -u)" -eq 0; then
  lock=(flock -w 900 /var/lock/towbar-caddy-cloudflare.lock)
else
  lock=(sudo -n flock -w 900 /var/lock/towbar-caddy-cloudflare.lock)
fi
"${"$"}{lock[@]}" bash -s -- true <<'TOWBAR_CADDY'
${installCaddyScript}
TOWBAR_CADDY
`;

export async function ensureCloudflareCaddyModule(
  session: SshSession,
  signal?: AbortSignal,
) {
  await session.run(ensureCloudflareCaddyScript, [], {
    signal,
    timeoutMs: 16 * 60_000,
  });
}
