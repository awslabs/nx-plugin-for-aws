terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

# Shared AppConfig application — call this module once per deployment and
# thread its outputs into every API / agent / MCP / lambda module that
# contributes a runtime-config entry. Aggregation and deployment of the
# collected entries happens in the sibling `appconfig-deployment` module,
# which you call once at the end of the root module with `depends_on`
# covering every entry-contributing module.

variable "application_name" {
  description = "Name of the AppConfig application"
  type        = string
}

variable "namespaces" {
  description = "List of runtime-config namespaces this AppConfig application should expose (one Configuration Profile is created per namespace)."
  type        = list(string)
  default     = ["connection", "agentcore"]
}

variable "deployment_strategy_id" {
  description = "Optional AppConfig Deployment Strategy ID to use. When null (the default), this module provisions a zero-wait strategy so deployed config is visible to consumers as soon as terraform apply completes. Pass an existing strategy ID (e.g. `AppConfig.AllAtOnce` or a custom one) to reuse it across multiple AppConfig applications."
  type        = string
  default     = null
}

resource "aws_appconfig_application" "runtime_config" {
  name        = var.application_name
  description = "Runtime configuration for ${var.application_name}"
}

resource "aws_appconfig_environment" "default" {
  name           = "default"
  application_id = aws_appconfig_application.runtime_config.id
}

# Instant (zero-wait) deployment strategy — only provisioned when the
# caller doesn't pass a shared `deployment_strategy_id`.
resource "aws_appconfig_deployment_strategy" "instant" {
  count = var.deployment_strategy_id == null ? 1 : 0

  name                           = "${var.application_name}-instant"
  deployment_duration_in_minutes = 0
  growth_factor                  = 100
  replicate_to                   = "NONE"
  final_bake_time_in_minutes     = 0
}

# Configuration Profile per namespace
resource "aws_appconfig_configuration_profile" "namespace" {
  for_each = toset(var.namespaces)

  application_id = aws_appconfig_application.runtime_config.id
  name           = each.key
  location_uri   = "hosted"
  type           = "AWS.Freeform"
}

locals {
  resolved_deployment_strategy_id = coalesce(
    var.deployment_strategy_id,
    try(aws_appconfig_deployment_strategy.instant[0].id, null),
  )
}

output "application_id" {
  description = "AppConfig Application ID"
  value       = aws_appconfig_application.runtime_config.id
}

output "application_arn" {
  description = "AppConfig Application ARN"
  value       = aws_appconfig_application.runtime_config.arn
}

output "environment_id" {
  description = "AppConfig Environment ID"
  value       = aws_appconfig_environment.default.environment_id
}

output "deployment_strategy_id" {
  description = "AppConfig Deployment Strategy ID — either the one supplied via `var.deployment_strategy_id` or the zero-wait strategy provisioned by this module."
  value       = local.resolved_deployment_strategy_id
}

output "configuration_profile_ids" {
  description = "Map of namespace to Configuration Profile ID."
  value       = { for k, p in aws_appconfig_configuration_profile.namespace : k => p.configuration_profile_id }
}

output "namespaces" {
  description = "Passthrough of the namespaces configured on this application."
  value       = var.namespaces
}
