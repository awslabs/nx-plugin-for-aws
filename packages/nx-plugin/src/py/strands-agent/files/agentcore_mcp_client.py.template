import hashlib
from collections.abc import Generator
from typing import Any

import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp.mcp_client import MCPClient


class SigV4HTTPXAuth(httpx.Auth):
    """HTTPX Auth class that signs requests with AWS SigV4."""

    def __init__(self, credentials: Any, region: str):
        self.credentials = credentials
        self.service = "bedrock-agentcore"
        self.region = region
        self.signer = SigV4Auth(credentials, self.service, region)

    def auth_flow(
        self, request: httpx.Request
    ) -> Generator[httpx.Request, httpx.Response, None]:
        headers = dict(request.headers)

        headers.pop("connection", None)
        headers["x-amz-content-sha256"] = hashlib.sha256(
            request.content if request.content else b""
        ).hexdigest()

        aws_request = AWSRequest(
            method=request.method,
            url=str(request.url),
            data=request.content,
            headers=headers,
        )

        self.signer.add_auth(aws_request)

        request.headers.clear()
        request.headers.update(dict(aws_request.headers))

        yield request


class AgentCoreMCPClient:
    """Factory for clients to call MCP servers hosted on Bedrock AgentCore Runtime"""

    @staticmethod
    def _create(
        agent_runtime_arn: str,
        region: str,
        session_id: str,
        headers: dict = None,
        auth_handler: httpx.Auth = None,
    ):
        # Build the URL
        encoded_arn = agent_runtime_arn.replace(":", "%3A").replace("/", "%2F")
        url = f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"

        # Create and return the MCP client
        return MCPClient(
            lambda: streamablehttp_client(
                url,
                auth=auth_handler,
                timeout=120,
                terminate_on_close=False,
                headers={
                    "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
                    **(headers if headers is not None else {}),
                },
            )
        )

    @staticmethod
    def with_iam_auth(
        agent_runtime_arn: str, credentials: Any, region: str, session_id: str
    ) -> MCPClient:
        """Create an MCP client with IAM (SigV4) authentication."""
        return AgentCoreMCPClient._create(
            agent_runtime_arn=agent_runtime_arn,
            region=region,
            session_id=session_id,
            auth_handler=SigV4HTTPXAuth(credentials, region),
        )

    @staticmethod
    def with_jwt_auth(
        agent_runtime_arn: str, access_token: str, region: str, session_id: str
    ) -> MCPClient:
        """Create an MCP client with JWT authentication."""
        return AgentCoreMCPClient._create(
            agent_runtime_arn=agent_runtime_arn,
            region=region,
            session_id=session_id,
            headers={
                "Authorization": f"Bearer {access_token}",
            },
        )
