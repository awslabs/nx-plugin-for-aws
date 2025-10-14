import os
from contextlib import contextmanager

import boto3
from strands import Agent

from .agentcore_mcp_client import AgentCoreMCPClient

# Obtain the region and credentials
region = os.environ["AWS_REGION"]
boto_session = boto3.Session(region_name=region)
credentials = boto_session.get_credentials()


@contextmanager
def get_agent(player_name: str, genre: str, session_id: str):
    mcp_client = AgentCoreMCPClient.with_iam_auth(
        agent_runtime_arn=os.environ["INVENTORY_MCP_ARN"],
        credentials=credentials,
        region=region,
        session_id=session_id,
    )
    with mcp_client:
        yield Agent(
            system_prompt=f"""
You are running a text adventure game in the genre <genre>{genre}</genre> for player <player>{player_name}</player>.
Construct a scenario and give the player decisions to make.
Use the tools to manage the player's inventory as items are obtained or lost.
When adding, removing or updating items in the inventory, always list items to check the current state,
and be careful to match item names exactly. Item names in the inventory must be Title Case.
Ensure you specify a suitable emoji when adding items if available.
When starting a game, populate the inventory with a few initial items. Items should be a key part of the narrative.
Keep responses under 100 words.
""",
            tools=[*mcp_client.list_tools_sync()],
        )
