terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
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

variable "application_id" {
  description = "AppConfig application ID (from `core/runtime-config/appconfig.application_id`)."
  type        = string
}

variable "environment_id" {
  description = "AppConfig environment ID (from `core/runtime-config/appconfig.environment_id`)."
  type        = string
}

variable "deployment_strategy_id" {
  description = "AppConfig deployment strategy ID (from `core/runtime-config/appconfig.deployment_strategy_id`)."
  type        = string
}

variable "configuration_profile_ids" {
  description = "Map of namespace to Configuration Profile ID (from `core/runtime-config/appconfig.configuration_profile_ids`)."
  type        = map(string)
}

variable "namespaces" {
  description = "List of namespaces to aggregate + deploy. Must match the keys of `configuration_profile_ids`."
  type        = list(string)
  default     = ["connection", "agentcore"]
}

locals {
  config_dir  = "${path.module}/../../../../../../../dist/packages/common/terraform/runtime-config"
  entries_dir = "${local.config_dir}/entries"
}

# Aggregate the per-entry leaf JSON files into a single JSON file per
# namespace. Runs at apply time so every contributor's entry file is
# guaranteed to be on disk when aggregation happens.
resource "null_resource" "aggregate_namespace" {
  for_each = toset(var.namespaces)

  triggers = {
    namespace = each.key
    # Re-run the aggregation every apply so newly-written entries are
    # always picked up. The local-exec is idempotent.
    always = timestamp()
  }

  provisioner "local-exec" {
    command = <<-EOT
      uv run python -c "
import json
import pathlib
import sys

namespace = '${each.key}'
entries_dir = pathlib.Path('${local.entries_dir}') / namespace
output_file = pathlib.Path('${local.config_dir}') / f'{namespace}.json'

def deep_merge(target: dict, source: dict) -> dict:
    for k, v in source.items():
        if k in target and isinstance(target[k], dict) and isinstance(v, dict):
            deep_merge(target[k], v)
        else:
            target[k] = v
    return target

# Each entry file is named '<key>-<sha>.json' — callers that share the
# same (namespace, key) pair hash their value into a distinct sha suffix,
# and their contributions are deep-merged back together under 'key' here.
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
print(f'Aggregated {namespace}.json with {len(merged)} section(s)')
"
    EOT
  }
}

data "local_file" "namespace_content" {
  for_each = toset(var.namespaces)

  filename   = "${local.config_dir}/${each.key}.json"
  depends_on = [null_resource.aggregate_namespace]
}

resource "aws_appconfig_hosted_configuration_version" "namespace" {
  for_each = toset(var.namespaces)

  application_id           = var.application_id
  configuration_profile_id = var.configuration_profile_ids[each.key]
  content_type             = "application/json"
  content                  = data.local_file.namespace_content[each.key].content
}

resource "aws_appconfig_deployment" "namespace" {
  for_each = toset(var.namespaces)

  application_id           = var.application_id
  environment_id           = var.environment_id
  configuration_profile_id = var.configuration_profile_ids[each.key]
  configuration_version    = aws_appconfig_hosted_configuration_version.namespace[each.key].version_number
  deployment_strategy_id   = var.deployment_strategy_id
}

output "hosted_configuration_version_numbers" {
  description = "Map of namespace to hosted configuration version number."
  value       = { for k, v in aws_appconfig_hosted_configuration_version.namespace : k => v.version_number }
}
