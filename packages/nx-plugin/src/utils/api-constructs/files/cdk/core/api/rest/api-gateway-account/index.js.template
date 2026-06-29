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

const hasLiveRole = async () => {
  const { cloudwatchRoleArn } = await apigw.send(new GetAccountCommand({}));
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

const RETRYABLE = ['BadRequestException', 'TooManyRequestsException'];

const setRole = async (value) => {
  const command = new UpdateAccountCommand({
    patchOperations: [{ op: 'replace', path: '/cloudwatchRoleArn', value }],
  });
  // Retry while the freshly created role propagates through IAM, and on throttling
  for (let attempt = 0; ; attempt++) {
    try {
      return await apigw.send(command);
    } catch (e) {
      if (RETRYABLE.includes(e.name) && attempt < 11) {
        await sleep(5000);
      } else {
        throw e;
      }
    }
  }
};

exports.handler = async (event) => {
  if (event.RequestType !== 'Delete' && !(await hasLiveRole())) {
    await setRole(event.ResourceProperties.CloudWatchRoleArn);
  }
  return { PhysicalResourceId: 'ApiGatewayAccount' };
};
