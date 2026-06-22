import { AfterModelCallEvent, type LocalAgent } from '@strands-agents/sdk';

const NO_CREDENTIALS =
  'Unable to invoke the model: no AWS credentials found. Configure credentials ' +
  '(e.g. run `aws configure`, set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / ' +
  'AWS_SESSION_TOKEN, or assume a role) before running the agent.';
const ACCESS_DENIED =
  'Unable to invoke the model: access denied. Grant your AWS principal permission ' +
  'to call bedrock:InvokeModelWithResponseStream for your model.';

// AWS SDK v3 errors are identified by their `name` rather than `instanceof`,
// since the SDK may be loaded from more than one place. Strands wraps them in a
// ModelError, so we check the error and its `cause` chain.
const hasErrorNamed = (error: unknown, name: string): boolean => {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.name === name) return true;
    current = current.cause;
  }
  return false;
};

/** Logs model invocation errors, calling out missing credentials or denied permissions. */
export const logModelErrors = (agent: LocalAgent): void => {
  agent.addHook(AfterModelCallEvent, (event) => {
    const error = event.error;
    if (!error) return;
    if (hasErrorNamed(error, 'CredentialsProviderError')) {
      console.error(NO_CREDENTIALS);
    } else if (hasErrorNamed(error, 'AccessDeniedException')) {
      console.error(ACCESS_DENIED);
    } else {
      console.error(`Model invocation failed: ${error.message}`);
    }
  });
};
