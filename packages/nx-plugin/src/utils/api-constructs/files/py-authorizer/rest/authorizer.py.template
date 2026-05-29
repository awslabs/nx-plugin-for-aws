from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.parser import event_parser
from aws_lambda_powertools.utilities.parser.models import (
    ApiGatewayAuthorizerRequest,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
tracer = Tracer()


@tracer.capture_lambda_handler
@logger.inject_lambda_context
@event_parser(model=ApiGatewayAuthorizerRequest)
def handler(event: ApiGatewayAuthorizerRequest, context: LambdaContext) -> dict:
    # TODO: Implement your custom authorization logic here.
    # Example: validate a bearer token, check an API key, verify a JWT, etc.
    #
    # token = event.headers.get("authorization") if event.headers else None
    # if is_valid(token):
    #     return _generate_policy("user", "Allow", event.methodArn)

    return _generate_policy("user", "Deny", event.methodArn)


def _generate_policy(principal_id: str, effect: str, resource: str) -> dict:
    return {
        "principalId": principal_id,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": effect,
                    "Resource": resource,
                }
            ],
        },
    }
