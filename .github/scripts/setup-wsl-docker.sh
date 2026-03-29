#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Sets up Docker Engine with BuildKit + QEMU inside WSL2 Ubuntu.
# Run as root inside the WSL2 distro:
#   wsl -d Ubuntu-24.04 -u root -- bash /path/to/setup-wsl-docker.sh
set -euo pipefail

# ── Install Docker Engine ────────────────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl >/dev/null 2>&1

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  >/etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin >/dev/null 2>&1

# ── Configure DNS & start daemon ─────────────────────────────────────────────
mkdir -p /etc/docker
echo '{"dns":["8.8.8.8","8.8.4.4"]}' >/etc/docker/daemon.json

dockerd >/var/log/dockerd.log 2>&1 &

for i in $(seq 1 15); do
  docker info >/dev/null 2>&1 && break || sleep 1
done
docker info >/dev/null 2>&1 || { echo "dockerd failed to start"; cat /var/log/dockerd.log; exit 1; }

# ── QEMU + Buildx ────────────────────────────────────────────────────────────
docker run --rm --privileged tonistiigi/binfmt --install all
docker buildx create --name linux-builder --driver docker-container --use
docker buildx inspect --bootstrap --builder linux-builder

echo "Docker Engine with Buildx is ready."
docker version
docker buildx ls
