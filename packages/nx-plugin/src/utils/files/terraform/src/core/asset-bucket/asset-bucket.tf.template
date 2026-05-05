terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

variable "bucket_name_prefix" {
  description = "Optional prefix to apply to the generated bucket name. Useful when you want a stable, human-recognisable identifier in addition to the account/region/random suffix."
  type        = string
  default     = "assets"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "random_string" "suffix" {
  length  = 8
  special = false
  upper   = false
}

# Access logs bucket for the asset bucket.
resource "aws_s3_bucket" "access_logs" {
  #checkov:skip=CKV2_AWS_61:Lifecycle configuration not required for access log bucket
  #checkov:skip=CKV_AWS_144:Cross-region replication not required for access log bucket
  #checkov:skip=CKV2_AWS_62:Event notifications not required for access log bucket
  #checkov:skip=CKV_AWS_18:Access logging the access log bucket would create a cycle
  #checkov:skip=CKV_AWS_145:AES256 (S3-managed) encryption is sufficient for access logs
  bucket        = "${var.bucket_name_prefix}-logs-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}-${random_string.suffix.result}"
  force_destroy = true

  tags = var.tags
}

resource "aws_s3_bucket_versioning" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureConnections"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.access_logs.arn,
          "${aws_s3_bucket.access_logs.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid       = "AllowS3LogDelivery"
        Effect    = "Allow"
        Principal = {
          Service = "logging.s3.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.access_logs.arn}/*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# Shared asset bucket
resource "aws_s3_bucket" "assets" {
  #checkov:skip=CKV2_AWS_61:Lifecycle configuration not required for transient build artefacts
  #checkov:skip=CKV_AWS_144:Cross-region replication not required for asset bucket
  #checkov:skip=CKV2_AWS_62:Event notifications not required for asset bucket
  #checkov:skip=CKV_AWS_145:AES256 (S3-managed) encryption is sufficient for build artefacts
  bucket        = "${var.bucket_name_prefix}-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}-${random_string.suffix.result}"
  force_destroy = true

  tags = var.tags
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "assets" {
  bucket = aws_s3_bucket.assets.id

  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "s3-access-logs/"
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureConnections"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.assets.arn,
          "${aws_s3_bucket.assets.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

output "bucket_name" {
  description = "Name of the shared asset bucket — pass to app modules' `asset_bucket_name` input."
  value       = aws_s3_bucket.assets.id
}

output "bucket_arn" {
  description = "ARN of the shared asset bucket"
  value       = aws_s3_bucket.assets.arn
}

output "access_logs_bucket_name" {
  description = "Name of the access-logs bucket that receives S3 access logs for the asset bucket."
  value       = aws_s3_bucket.access_logs.id
}

output "access_logs_bucket_arn" {
  description = "ARN of the access-logs bucket"
  value       = aws_s3_bucket.access_logs.arn
}
