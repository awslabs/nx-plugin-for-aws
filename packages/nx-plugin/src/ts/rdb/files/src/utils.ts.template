import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

export type DatabaseConfig = {
  hostname: string;
  port: number;
  database: string;
  adminUser: string;
  dbUser: string;
  region: string;
};

export type DatabaseSecret = {
  dbname: string;
  username: string;
  password: string;
  host: string;
  port: number;
};

const databaseConfigPromises: Record<string, Promise<DatabaseConfig>> = {};

const getSecretValue = async (secretArn: string): Promise<string> => {
  const client = new SecretsManagerClient();
  const data = await client.send(
    new GetSecretValueCommand({
      SecretId: secretArn,
    }),
  );

  if (!data.SecretString) {
    throw new Error('Database secret does not contain SecretString.');
  }

  return data.SecretString;
};

export const getDatabaseSecret = async (): Promise<DatabaseSecret> => {
  const secretArn = process.env.DATABASE_SECRET_ARN;

  if (!secretArn) {
    throw new Error(
      'Missing required environment variable DATABASE_SECRET_ARN.',
    );
  }

  return JSON.parse(await getSecretValue(secretArn)) as DatabaseSecret;
};

const loadDatabaseConfig = async (
  runtimeConfigKey: string,
): Promise<DatabaseConfig> => {
  const appId = process.env.RUNTIME_CONFIG_APP_ID;

  if (!appId) {
    throw new Error(
      'Missing required environment variable RUNTIME_CONFIG_APP_ID.',
    );
  }

  const config = await getAppConfig<{
    [key: string]: DatabaseConfig | undefined;
  }>('database', {
    application: appId,
    environment: 'default',
    transform: 'json',
  });

  const databaseConfig = config?.[runtimeConfigKey];

  if (!databaseConfig) {
    throw new Error(`RuntimeConfig is missing database.${runtimeConfigKey}.`);
  }

  return databaseConfig;
};

export const getDatabaseConfig = (
  runtimeConfigKey: string,
): Promise<DatabaseConfig> => {
  databaseConfigPromises[runtimeConfigKey] ??=
    loadDatabaseConfig(runtimeConfigKey);
  return databaseConfigPromises[runtimeConfigKey];
};
