/**
 * Configures the account-level API Gateway CloudWatch Logs role required for
 * REST API access logging. The setting is a singleton per region per account,
 * so this handler only writes when no live role is already configured (the
 * first stack to deploy wins, others defer) and never resets it on delete.
 */
const {
  APIGatewayClient,
  GetAccountCommand,
  UpdateAccountCommand,
} = require('@aws-sdk/client-api-gateway');
const { IAMClient, GetRoleCommand } = require('@aws-sdk/client-iam');

const apigw = new APIGatewayClient();
const iam = new IAMClient();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE = ['BadRequestException', 'TooManyRequestsException'];

// Throttling may surface as a bare 429 with no modeled error code, so check
// response metadata as well as error names
const isRetryable = (e) =>
  RETRYABLE.includes(e.name) ||
  e.$metadata?.httpStatusCode === 429 ||
  e.$retryable?.throttling === true;

// Retry while the freshly created role propagates through IAM, and on
// throttling of the account-level API (shared across concurrent deployments)
const send = async (command) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await apigw.send(command);
    } catch (e) {
      if (isRetryable(e) && attempt < 11) {
        await sleep(5000);
      } else {
        throw e;
      }
    }
  }
};

const hasLiveRole = async () => {
  const { cloudwatchRoleArn } = await send(new GetAccountCommand({}));
  if (!cloudwatchRoleArn) return false;
  try {
    await iam.send(
      new GetRoleCommand({ RoleName: cloudwatchRoleArn.split('/').pop() }),
    );
    return true;
  } catch (e) {
    if (e.name === 'NoSuchEntityException') return false;
    throw e;
  }
};

const setRole = (value) =>
  send(
    new UpdateAccountCommand({
      patchOperations: [{ op: 'replace', path: '/cloudwatchRoleArn', value }],
    }),
  );

exports.handler = async (event) => {
  if (event.RequestType !== 'Delete' && !(await hasLiveRole())) {
    await setRole(event.ResourceProperties.CloudWatchRoleArn);
  }
  return { PhysicalResourceId: 'ApiGatewayAccount' };
};
