from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_session_id_var: ContextVar[str | None] = ContextVar(
    "agentcore_session_id", default=None
)


def get_current_session_id() -> str | None:
    """The session ID for the current async scope, or ``None``."""
    return _session_id_var.get()


@contextmanager
def session_id_context(session_id: str) -> Iterator[None]:
    """Bind *session_id* as the current session for the scope of the block."""
    token = _session_id_var.set(session_id)
    try:
        yield
    finally:
        _session_id_var.reset(token)
