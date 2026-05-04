terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = ">= 3.0"
    }
  }
}

variable "namespace" {
  description = "Namespace to read (e.g., 'connection')."
  type        = string
  default     = "connection"
}

locals {
  config_dir      = "${path.module}/../../../../../../../dist/packages/common/terraform/runtime-config"
  entries_dir     = "${local.config_dir}/entries/${var.namespace}"
  namespace_path  = "${local.config_dir}/${var.namespace}.json"
}

# Aggregate leaf entry files into the namespace JSON on every apply. The
# `entry` module writes `local_file` resources into `entries/<namespace>/`,
# and the same aggregation runs in the `appconfig` module — we duplicate
# it here so `read` can be used independently (eg the static-website
# module reads `connection.json` without needing an AppConfig application).
resource "null_resource" "aggregate_namespace" {
  triggers = {
    namespace = var.namespace
    always    = timestamp()
  }

  provisioner "local-exec" {
    command = <<-EOT
      uv run python -c "
import json
import pathlib
import sys

entries_dir = pathlib.Path('${local.entries_dir}')
output_file = pathlib.Path('${local.namespace_path}')

def deep_merge(target: dict, source: dict) -> dict:
    for k, v in source.items():
        if k in target and isinstance(target[k], dict) and isinstance(v, dict):
            deep_merge(target[k], v)
        else:
            target[k] = v
    return target

merged: dict = {}
if entries_dir.is_dir():
    for entry_path in sorted(entries_dir.glob('*.json')):
        section = entry_path.stem.rsplit('-', 1)[0]
        try:
            contribution = json.loads(entry_path.read_text())
        except json.JSONDecodeError as e:
            print(f'Skipping malformed entry {entry_path}: {e}', file=sys.stderr)
            continue
        existing = merged.get(section)
        if isinstance(existing, dict) and isinstance(contribution, dict):
            deep_merge(existing, contribution)
        else:
            merged[section] = contribution

output_file.parent.mkdir(parents=True, exist_ok=True)
output_file.write_text(json.dumps(merged, indent=2))
"
    EOT
  }
}

data "local_file" "runtime_config" {
  filename   = local.namespace_path
  depends_on = [null_resource.aggregate_namespace]
}

# Outputs
output "config" {
  description = "Runtime configuration object for the namespace"
  value       = jsondecode(data.local_file.runtime_config.content)
}

output "config_json" {
  description = "Runtime configuration as JSON string for the namespace"
  value       = data.local_file.runtime_config.content
}
