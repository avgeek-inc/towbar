resolve_latest_version() {
  local effective_url version
  effective_url="$(
    curl \
      --fail \
      --silent \
      --show-error \
      --location \
      --proto '=https' \
      --tlsv1.2 \
      --output /dev/null \
      --write-out '%{url_effective}' \
      "https://github.com/$TOWBAR_REPOSITORY/releases/latest"
  )"
  version="${effective_url##*/}"
  validate_version "$version"
  printf '%s\n' "$version"
}

verify_release() {
  local version="$1"
  if ! curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --proto '=https' \
    --tlsv1.2 \
    "https://api.github.com/repos/$TOWBAR_REPOSITORY/releases/tags/$version" |
    jq -e \
      --arg version "$version" \
      '.tag_name == $version and .draft == false and .prerelease == false and .published_at != null' \
      >/dev/null; then
    fail "$version is not a published stable release"
  fi
}

resolve_release_commit() {
  local version="$1" refs commit
  refs="$(
    git ls-remote \
      "https://github.com/$TOWBAR_REPOSITORY.git" \
      "refs/tags/$version" \
      "refs/tags/$version^{}"
  )"
  commit="$(
    awk \
      -v tag_ref="refs/tags/$version" \
      -v peeled_ref="refs/tags/$version^{}" \
      '$2 == tag_ref { tag = $1 } $2 == peeled_ref { peeled = $1 } END { print peeled != "" ? peeled : tag }' \
      <<<"$refs"
  )"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "could not resolve $version to a commit"
  printf '%s\n' "$commit"
}

metadata_value() {
  local release_dir="$1" key="$2"
  awk -F= -v key="$key" '$1 == key { print substr($0, length(key) + 2); exit }' \
    "$release_dir/.towbar-release"
}

download_release() {
  local version="$1" commit="$2" release_dir staging archive source_dir package_version
  local image_manifest owner image_prefix
  release_dir="$RELEASES_DIR/$version"
  if [[ -d "$release_dir" ]]; then
    [[ -f "$release_dir/.towbar-release" ]] ||
      fail "$release_dir exists without Towbar release metadata"
    [[ "$(metadata_value "$release_dir" COMMIT)" == "$commit" ]] ||
      fail "$release_dir does not match the published release commit"
    printf '%s\n' "$release_dir"
    return
  fi

  install -d -m 0755 "$RELEASES_DIR"
  staging="$(mktemp -d "$RELEASES_DIR/.staging.XXXXXX")"
  archive="$staging/release.tar.gz"
  image_manifest="$staging/towbar-images.json"
  cleanup_download() {
    rm -rf "$staging"
  }
  trap cleanup_download EXIT

  log "Downloading $version at immutable commit $commit" >&2
  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --retry 4 \
    --retry-all-errors \
    --proto '=https' \
    --tlsv1.2 \
    "https://github.com/$TOWBAR_REPOSITORY/archive/$commit.tar.gz" \
    --output "$archive"
  if ! curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --retry 4 \
    --retry-all-errors \
    --proto '=https' \
    --tlsv1.2 \
    "https://github.com/$TOWBAR_REPOSITORY/releases/download/$version/towbar-images.json" \
    --output "$image_manifest"; then
    fail "Prebuilt images for Towbar $version are not published yet. Retry after the release image workflow completes."
  fi

  if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    fail "release archive contains an unsafe path"
  fi
  tar -xzf "$archive" -C "$staging"
  source_dir="$(find "$staging" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  [[ -n "$source_dir" ]] || fail "release archive did not contain a source directory"
  [[ -f "$source_dir/docker-compose.yml" && -f "$source_dir/.env.example" && -f "$source_dir/infra/towbar" ]] ||
    fail "release archive is missing Towbar installation files"

  package_version="$(jq -r .version "$source_dir/package.json")"
  [[ "$package_version" == "${version#v}" ]] ||
    fail "$version contains package version $package_version"
  owner="${TOWBAR_REPOSITORY%%/*}"
  image_prefix="ghcr.io/${owner,,}"
  jq -e \
    --arg version "$version" \
    --arg commit "$commit" \
    --arg api "$image_prefix/towbar-api@" \
    --arg worker "$image_prefix/towbar-worker@" \
    --arg web "$image_prefix/towbar-web-app@" \
    '.version == $version and .commit == $commit and
      (.images | keys == ["api", "web-app", "worker"]) and
      (.images.api | startswith($api) and test("@sha256:[0-9a-f]{64}$")) and
      (.images.worker | startswith($worker) and test("@sha256:[0-9a-f]{64}$")) and
      (.images["web-app"] | startswith($web) and test("@sha256:[0-9a-f]{64}$"))' \
    "$image_manifest" >/dev/null ||
    fail "$version does not contain a valid immutable image manifest"
  cat >"$source_dir/.towbar-release" <<EOF
VERSION=$version
COMMIT=$commit
REPOSITORY=$TOWBAR_REPOSITORY
API_IMAGE=$(jq -r '.images.api' "$image_manifest")
WORKER_IMAGE=$(jq -r '.images.worker' "$image_manifest")
WEB_APP_IMAGE=$(jq -r '.images["web-app"]' "$image_manifest")
EOF
  mv "$source_dir" "$release_dir"
  trap - EXIT
  cleanup_download
  printf '%s\n' "$release_dir"
}

generate_config() {
  local release_dir="$1" pending_config
  CONFIG_CREATED=false
  [[ ! -e "$TOWBAR_ENV_FILE" && ! -e "$TOWBAR_YAML_FILE" ]] || return 0

  install -d -m 0700 "$TOWBAR_CONFIG_DIR"
  pending_config="$(mktemp "$TOWBAR_CONFIG_DIR/towbar.env.XXXXXX")"
  awk \
    -v postgres_password="$(openssl rand -hex 32)" \
    -v runtime_password="$(openssl rand -hex 32)" \
    -v credentials_key="$(openssl rand -base64 32 | tr -d '\n')" \
    -v hmac_secret="$(openssl rand -hex 32)" \
    'BEGIN { FS = OFS = "=" }
      $1 == "TOWBAR_POSTGRES_PASSWORD" { $2 = postgres_password }
      $1 == "TOWBAR_DATABASE_RUNTIME_PASSWORD" { $2 = runtime_password }
      $1 == "TOWBAR_CREDENTIALS_KEY" { $2 = credentials_key }
      $1 == "TOWBAR_INTERNAL_HMAC_SECRET" { $2 = hmac_secret }
      { print }' \
    "$release_dir/.env.example" >"$pending_config"
  chmod 600 "$pending_config"
  mv "$pending_config" "$TOWBAR_ENV_FILE"
  CONFIG_CREATED=true
  log "Generated installation secrets"
}
