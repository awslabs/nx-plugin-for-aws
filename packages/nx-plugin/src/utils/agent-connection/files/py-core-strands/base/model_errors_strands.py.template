import logging

from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError
from strands.hooks import AfterModelCallEvent, HookRegistry

logger = logging.getLogger(__name__)

_NO_CREDENTIALS = (
    "Unable to invoke the model: no AWS credentials found. Configure credentials "
    "(e.g. run `aws configure`, set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / "
    "AWS_SESSION_TOKEN, or assume a role) before running the agent."
)
_ACCESS_DENIED = (
    "Unable to invoke the model: access denied. Grant your AWS principal permission "
    "to call bedrock:InvokeModelWithResponseStream for your model."
)


def _is_access_denied(error: BaseException) -> bool:
    return isinstance(error, ClientError) and error.response.get("Error", {}).get("Code") == "AccessDeniedException"


class _LogModelErrors:
    def register_hooks(self, registry: HookRegistry, **_kwargs) -> None:
        registry.add_callback(AfterModelCallEvent, self._on_after_model_call)

    @staticmethod
    def _on_after_model_call(event: AfterModelCallEvent) -> None:
        error = event.exception
        if error is None:
            return
        if isinstance(error, (NoCredentialsError, PartialCredentialsError)):
            logger.error(_NO_CREDENTIALS)
        elif _is_access_denied(error):
            logger.error(_ACCESS_DENIED)
        else:
            logger.error("Model invocation failed: %s", error)


log_model_errors = _LogModelErrors()
