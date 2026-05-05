terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
  }
}

# Variables
variable "namespace" {
  description = "Namespace for the configuration entry (e.g., 'connection', 'tables')"
  type        = string
  default     = "connection"
}

variable "key" {
  description = "Section name within the namespace (e.g., 'apis', 'cognitoProps'). Multiple `entry` modules may share the same key — the `appconfig` / `read` aggregation deep-merges their contributions under that key."
  type        = string
}

variable "value" {
  description = "Value to set at the key. When the value is an object, its fields are deep-merged with any other `entry` module that targets the same (namespace, key) pair."
  type        = any
}

locals {
  entries_dir = "${path.module}/../../../../../../../dist/packages/common/terraform/runtime-config/entries"
  # A per-entry SHA256 so two modules writing to the same (namespace, key)
  # produce distinct leaf files — the `appconfig-deployment` / `read`
  # modules deep-merge them back together at apply time.
  entry_id        = sha256(jsonencode({ key = var.key, value = var.value }))
  entry_file_path = "${local.entries_dir}/${var.namespace}/${var.key}-${local.entry_id}.json"
}

# Write this entry's contribution as a standalone JSON file.
resource "local_file" "entry" {
  filename        = local.entry_file_path
  content         = jsonencode(var.value)
  file_permission = "0644"
}

# Outputs
output "entry_file_path" {
  description = "Absolute path to the JSON file that stores this entry's value"
  value       = local_file.entry.filename
}

output "namespace" {
  description = "Namespace this entry was written under"
  value       = var.namespace
}

output "key" {
  description = "Key this entry was written as"
  value       = var.key
}
