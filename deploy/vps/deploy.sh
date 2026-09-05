#!/usr/bin/env bash
set -Eeuo pipefail

sha=${1:-}
registry_user=${2:-}
mode=${3:-}
repo=/opt/lanka-price-lens
config=/etc/lanka-price-lens
backups=/var/backups/lanka-price-lens
volume=lanka-price-lens-operations
# Set when this script re-executes itself from the commit being deployed (see below).
docker_config=${LPL_DEPLOY_DOCKER_CONFIG:-}

if [[ $EUID -ne 0 || ! $sha =~ ^[0-9a-f]{40}$ || ( -n $mode && $mode != --verify-only && $mode != --configure-r2 ) ]]; then
  echo "Usage: sudo lanka-price-lens-deploy COMMIT_SHA [GHCR_USERNAME] [--verify-only|--configure-r2]" >&2
  exit 2
fi

update_env() {
  local key=$1 value=$2 temporary line found=0
  temporary=$(mktemp "$config/app.env.XXXXXX")
  {
    while IFS= read -r line || [[ -n $line ]]; do
      if [[ $line == "$key="* ]]; then
        printf '%s=%s\n' "$key" "$value"
        found=1
      else
        printf '%s\n' "$line"
      fi
    done < "$config/app.env"
    if [[ $found -eq 0 ]]; then
      printf '%s=%s\n' "$key" "$value"
    fi
  } > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$config/app.env"
}

if [[ $mode == --configure-r2 ]]; then
  IFS= read -r cloudflare_account_id
  IFS= read -r cloudflare_api_token
  if [[ ! $cloudflare_account_id =~ ^[a-f0-9]{32}$ || -z $cloudflare_api_token ]]; then
    echo "Valid Cloudflare R2 credentials are required" >&2
    exit 2
  fi
  update_env CLOUDFLARE_ACCOUNT_ID "$cloudflare_account_id"
  update_env CLOUDFLARE_API_TOKEN "$cloudflare_api_token"
  docker compose --env-file "$config/app.env" --env-file "$config/release.env" -f "$repo/compose.yaml" up -d --no-build --force-recreate --wait --wait-timeout 90 api
  exit
fi

if [[ $mode == --verify-only ]]; then
  # A short, bounded sync proves the workflow runs on this host with the deployed image and settings:
  # discovery, downloads, and a handful of pending documents, without retry cooldowns. The nightly timer
  # does the full sweep. The lock is the timer's, so verification waits for a running sync instead of overlapping it.
  if ! flock -w 1800 /run/lock/lanka-price-lens.lock \
    docker compose --env-file "$config/app.env" --env-file "$config/release.env" -f "$repo/compose.yaml" \
    --profile tools run --rm --no-deps foundry sync --process-limit 5 --retry-attempts 1; then
    exit 1
  fi
  systemctl is-active lanka-pricelens-foundry.timer
  systemctl is-active lanka-pricelens-retail.timer
  exit
fi

cleanup() {
  if [[ -n $docker_config ]]; then
    rm -rf -- "$docker_config"
  fi
}

trap cleanup EXIT

if [[ -z ${LPL_DEPLOY_REEXEC:-} ]]; then
  exec 9>/run/lock/lanka-price-lens.lock
  flock -n 9 || { echo "Another deployment or foundry run is active" >&2; exit 1; }
fi

cd "$repo"
git fetch --quiet origin main
git merge-base --is-ancestor "$sha" origin/main || { echo "Commit is not on origin/main" >&2; exit 1; }

if [[ -n $registry_user && -z ${LPL_DEPLOY_REEXEC:-} ]]; then
  docker_config=$(mktemp -d /run/lanka-price-lens-docker.XXXXXX)
  chmod 700 "$docker_config"
  export DOCKER_CONFIG="$docker_config"
  docker login ghcr.io --username "$registry_user" --password-stdin
fi

previous_commit=${LPL_DEPLOY_PREVIOUS_COMMIT:-$(git rev-parse HEAD)}
previous_image=$(sed -n 's/^LPL_IMAGE=//p' "$config/release.env" 2>/dev/null || true)
image="ghcr.io/prabhavalabs/lanka-price-lens:sha-$sha"

write_release() {
  local value=$1 temporary
  temporary=$(mktemp "$config/release.env.XXXXXX")
  printf 'LPL_IMAGE=%s\nLPL_VCS_REF=%s\n' "$value" "${value##*sha-}" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$config/release.env"
}

compose() {
  docker compose --env-file "$config/app.env" --env-file "$config/release.env" -f "$repo/compose.yaml" "$@"
}

rollback() {
  trap - ERR
  echo "Deployment failed; restoring the previous release" >&2
  git checkout --quiet --detach "$previous_commit" || true
  if [[ -n $previous_image ]]; then
    write_release "$previous_image"
    compose up -d --no-build --wait --wait-timeout 90 api || true
  fi
}

git checkout --quiet --detach "$sha"

# The warehouse database needs a password in app.env; generate one on first use so a deploy never fails on a missing setting.
if ! grep -q '^POSTGRES_PASSWORD=.\+' "$config/app.env"; then
  update_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  echo "Generated POSTGRES_PASSWORD in $config/app.env"
fi

# Continue with the deploy script from the commit being deployed, so changes to this
# file (new systemd units, new steps) apply to the deployment that introduces them
# rather than the next one. The lock (fd 9), docker login, and the rollback target
# carry over to the re-executed process.
if [[ -z ${LPL_DEPLOY_REEXEC:-} ]] && ! cmp -s "$0" "$repo/deploy/vps/deploy.sh"; then
  echo "Deploy script changed in $sha; continuing with the new version"
  exec env LPL_DEPLOY_REEXEC=1 LPL_DEPLOY_PREVIOUS_COMMIT="$previous_commit" LPL_DEPLOY_DOCKER_CONFIG="$docker_config" \
    bash "$repo/deploy/vps/deploy.sh" "$sha" "$registry_user" ${mode:+"$mode"}
fi

docker pull "$image"
write_release "$image"
compose config --quiet
trap rollback ERR

if [[ -n $(compose ps -q api) ]]; then
  compose stop --timeout 30 api
fi

if mountpoint=$(docker volume inspect --format '{{ .Mountpoint }}' "$volume" 2>/dev/null) && [[ -n $(find "$mountpoint" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
  mkdir -p "$backups"
  tar -czf "$backups/operations-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C "$mountpoint" .
fi

compose up -d --no-build --wait --wait-timeout 90 api
compose --profile tools run --rm --no-deps foundry warehouse migrate
# A deploy may ship new mapping labels or rules: promote the snapshots of the last week under them and refresh the warehouse.
compose --profile tools run --rm --no-deps foundry remap --all --days 7
compose --profile tools run --rm --no-deps foundry warehouse sync
trap - ERR

install -m 0755 "$repo/deploy/vps/deploy.sh" /usr/local/sbin/lanka-price-lens-deploy
install -m 0644 "$repo/deploy/systemd/lanka-pricelens-foundry.service" /etc/systemd/system/
install -m 0644 "$repo/deploy/systemd/lanka-pricelens-foundry.timer" /etc/systemd/system/
install -m 0644 "$repo/deploy/systemd/lanka-pricelens-retail.service" /etc/systemd/system/
install -m 0644 "$repo/deploy/systemd/lanka-pricelens-retail.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lanka-pricelens-foundry.timer
systemctl enable --now lanka-pricelens-retail.timer
echo "Deployed $sha"
