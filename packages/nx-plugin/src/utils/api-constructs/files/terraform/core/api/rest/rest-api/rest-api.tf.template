# Core REST API Gateway module
# This module creates the API Gateway REST API, deployment, stage, and logging resources

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.33"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1"
    }
  }
}

# Core REST API Gateway Variables

variable "api_name" {
  description = "Name of the REST API Gateway"
  type        = string
}

variable "api_description" {
  description = "Description of the REST API Gateway"
  type        = string
  default     = "REST API Gateway"
}

variable "stage_name" {
  description = "Name of the API Gateway stage"
  type        = string
  default     = "prod"
}

variable "stage_auto_deploy" {
  description = "Whether to automatically deploy the API stage"
  type        = bool
  default     = true
}

variable "enable_waf" {
  description = "Whether to enable AWS WAFv2 with the default managed ruleset (AWSManagedRulesCommonRuleSet and AWSManagedRulesKnownBadInputsRuleSet). The Web ACL is created here and associated with the stage in the consuming module."
  type        = bool
  default     = true
}

# CORS Configuration

variable "cors_allow_headers" {
  description = "List of allowed headers for CORS"
  type        = list(string)
  default     = ["authorization", "content-type", "x-amz-content-sha256", "x-amz-date", "x-amz-security-token"]
}

variable "cors_allow_methods" {
  description = "List of allowed HTTP methods for CORS"
  type        = list(string)
  default     = ["*"]
}

variable "cors_allow_origins" {
  description = "List of allowed origins for CORS"
  type        = list(string)
  default     = ["*"]
}

# Tags

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# Data sources
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# Resources

# Note: CloudWatch logging removed due to account-level CloudWatch Logs role ARN requirement

# REST API Gateway
resource "aws_api_gateway_rest_api" "rest_api" {
  name        = var.api_name
  description = var.api_description

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = var.tags
}

# Note: Deployment and stage are created in the consuming module (e.g., foo-api.tf)
# after all methods and integrations are defined

# Note: CloudWatch Log Group removed due to account-level CloudWatch Logs role ARN requirement

# Gateway Response for CORS (4XX errors)
resource "aws_api_gateway_gateway_response" "cors_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.rest_api.id
  response_type = "DEFAULT_4XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${join(",", var.cors_allow_origins)}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'${join(",", var.cors_allow_headers)}'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'${join(",", var.cors_allow_methods)}'"
  }
}

# Gateway Response for CORS (5XX errors)
resource "aws_api_gateway_gateway_response" "cors_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.rest_api.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${join(",", var.cors_allow_origins)}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'${join(",", var.cors_allow_headers)}'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'${join(",", var.cors_allow_methods)}'"
  }
}

resource "aws_wafv2_web_acl" "api_waf" {
  #checkov:skip=CKV2_AWS_31:Logging configuration is defined below in aws_wafv2_web_acl_logging_configuration.api_waf_logging; Checkov does not resolve the separate resource
  count = var.enable_waf ? 1 : 0

  name  = "${var.api_name}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "CRSRule"
    priority = 0

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # Count instead of Block: the CRS 8 KB body limit is too restrictive for most APIs.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.api_name}WebAcl-CRS"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "KnownBadInputsRule"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.api_name}WebAcl-KnownBadInputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.api_name}WebAcl"
    sampled_requests_enabled   = true
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

# CloudWatch Log Group for WAF request logs. Name must start with `aws-waf-logs-`.
resource "aws_cloudwatch_log_group" "api_waf_logs" {
  #checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption
  #checkov:skip=CKV_AWS_338:Log retention set to one month which is sufficient for WAF logs
  count = var.enable_waf ? 1 : 0

  name              = "aws-waf-logs-${var.api_name}-${random_id.waf_log_suffix[0].hex}"
  retention_in_days = 30
  tags              = var.tags
}

resource "random_id" "waf_log_suffix" {
  count       = var.enable_waf ? 1 : 0
  byte_length = 4
}

resource "aws_wafv2_web_acl_logging_configuration" "api_waf_logging" {
  count = var.enable_waf ? 1 : 0

  log_destination_configs = [aws_cloudwatch_log_group.api_waf_logs[0].arn]
  resource_arn            = aws_wafv2_web_acl.api_waf[0].arn
}


# Outputs

output "api_id" {
  description = "ID of the REST API Gateway"
  value       = aws_api_gateway_rest_api.rest_api.id
}

output "api_arn" {
  description = "ARN of the REST API Gateway"
  value       = aws_api_gateway_rest_api.rest_api.arn
}

output "api_endpoint" {
  description = "Base URL of the REST API Gateway"
  value       = "https://${aws_api_gateway_rest_api.rest_api.id}.execute-api.${data.aws_region.current.id}.amazonaws.com"
}

output "api_execution_arn" {
  description = "Execution ARN of the REST API Gateway"
  value       = aws_api_gateway_rest_api.rest_api.execution_arn
}

output "api_root_resource_id" {
  description = "Root resource ID of the REST API Gateway"
  value       = aws_api_gateway_rest_api.rest_api.root_resource_id
}

output "waf_web_acl_arn" {
  description = "ARN of the WAFv2 Web ACL associated with the API, or null if WAF is disabled"
  value       = var.enable_waf ? aws_wafv2_web_acl.api_waf[0].arn : null
}

# Note: Stage and deployment outputs are provided by the consuming module

# Note: CloudWatch log group outputs removed due to account-level CloudWatch Logs role ARN requirement