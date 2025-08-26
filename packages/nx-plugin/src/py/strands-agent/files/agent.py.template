from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time


# Define a custom tool
@tool
def add(a: int, b: int) -> int:
    return a + b


@contextmanager
def get_agent(session_id: str):
    yield Agent(
        system_prompt="""
You are an addition wizard.
Use the 'add' tool for addition tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[add, current_time],
    )
