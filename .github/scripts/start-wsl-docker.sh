#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Starts the WSL2 Docker daemon and selects the buildx builder. Runs on every
# job (the daemon isn't running in the freshly imported/installed distro).
# Docker Engine, binfmt and the buildx builder are already installed by
# install-wsl-docker.sh and baked into the cached distro.
#
# Run as root inside the WSL2 distro:
#   wsl -d Ubuntu-24.04 -u root -- bash /path/to/start-wsl-docker.sh
set -euo pipefail

dockerd >/var/log/dockerd.log 2>&1 &

for i in $(seq 1 15); do
  docker info >/dev/null 2>&1 && break || sleep 1
done
docker info >/dev/null 2>&1 || { echo "dockerd failed to start"; cat /var/log/dockerd.log; exit 1; }

docker buildx use linux-builder
docker buildx inspect --bootstrap --builder linux-builder

echo "Docker Engine with Buildx is ready."
docker version
docker buildx ls
