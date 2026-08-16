import logging

from strands.hooks import AfterToolCallEvent, HookRegistry

logger = logging.getLogger(__name__)


class _LogToolErrors:
    def register_hooks(self, registry: HookRegistry, **_kwargs) -> None:
        registry.add_callback(AfterToolCallEvent, self._on_after_tool_call)

    @staticmethod
    def _on_after_tool_call(event: AfterToolCallEvent) -> None:
        tool_name = event.tool_use.get("name", "<unknown>")
        if event.exception is not None:
            logger.error("Tool '%s' failed: %s", tool_name, event.exception)
            return
        if event.result.get("status") != "error":
            return
        message = " ".join(block["text"] for block in event.result.get("content", []) if "text" in block)
        logger.error("Tool '%s' failed%s", tool_name, f": {message}" if message else "")


log_tool_errors = _LogToolErrors()
