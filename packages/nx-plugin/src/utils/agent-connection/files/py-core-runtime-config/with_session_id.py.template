from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, ExitStack, contextmanager
from typing import Any

from .session_context import get_current_session_id


@contextmanager
def with_session_id(
    agent_factory: Callable[[], AbstractContextManager[Any]],
    *,
    name: str,
    description: str,
) -> Iterator[Any]:
    """Wrap an agent factory so each session gets its own cached Agent."""
    stack = ExitStack()
    agents: dict[str, Any] = {}

    def _for_session() -> Any:
        sid = get_current_session_id() or "default"
        if sid not in agents:
            agents[sid] = stack.enter_context(agent_factory())
        return agents[sid]

    proxy_name = name
    proxy_description = description

    class _SessionRoutingAgent:
        name: str = proxy_name
        description: str = proxy_description

        def __getattr__(self, attr: str) -> Any:
            return getattr(_for_session(), attr)

        def stream_async(self, *args, **kwargs):
            return _for_session().stream_async(*args, **kwargs)

        def invoke_async(self, *args, **kwargs):
            return _for_session().invoke_async(*args, **kwargs)

    try:
        yield _SessionRoutingAgent()
    finally:
        stack.close()
