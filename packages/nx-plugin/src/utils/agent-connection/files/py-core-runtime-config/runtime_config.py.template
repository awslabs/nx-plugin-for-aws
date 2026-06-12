import os
from typing import Any, cast

from aws_lambda_powertools.utilities import parameters
from botocore.config import Config


def get_agentcore_runtime_config() -> dict[str, Any]:
    """Read the runtime-config ``agentcore`` namespace from AppConfig.

    Returns a dict of the shape ``{"agentRuntimes": {name: arn, ...},
    "gateways": {name: url, ...}}``, where keys are the class names of
    connected target constructs.

    ``RUNTIME_CONFIG_APP_ID`` is set on the AgentCore runtime by the generated
    CDK/Terraform construct for this project.
    """
    application = os.environ.get("RUNTIME_CONFIG_APP_ID")
    if not application:
        raise RuntimeError(
            "RUNTIME_CONFIG_APP_ID is not set — cannot resolve connected agent ARNs from AppConfig."
        )
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION"))
    provider = parameters.AppConfigProvider(
        environment="default",
        application=application,
        config=Config(region_name=region) if region else None,
    )
    return cast(dict[str, Any], provider.get("agentcore", transform="json"))
