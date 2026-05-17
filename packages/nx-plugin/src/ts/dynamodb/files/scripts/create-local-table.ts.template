import {
  AttributeDefinition,
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  GlobalSecondaryIndexDescription,
  KeySchemaElement,
  Projection,
  ResourceInUseException,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb';

const [tableName, port] = process.argv.slice(2);
const endpoint = `http://localhost:${port}`;

const client = new DynamoDBClient({
  endpoint,
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'accessKeyId',
    secretAccessKey: 'secretAccessKey',
  },
});

export type GSIDefinition = {
  IndexName: string;
  KeySchema: KeySchemaElement[];
  Projection: Projection;
  AttributeDefinitions: AttributeDefinition[];
};

// GSIs to synchronize on the local table at startup — indexes are added or removed to match this list.
// ElectroDB names GSI keys gsi{n}pk / gsi{n}sk — add one entry per index defined in your entities.
const GLOBAL_SECONDARY_INDEXES: GSIDefinition[] = [
  {
    IndexName: 'gsi1pk-gsi1sk-index',
    KeySchema: [
      { AttributeName: 'gsi1pk', KeyType: 'HASH' },
      { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
    ],
    Projection: { ProjectionType: 'ALL' },
    AttributeDefinitions: [
      { AttributeName: 'gsi1pk', AttributeType: 'S' },
      { AttributeName: 'gsi1sk', AttributeType: 'S' },
    ],
  },
  {
    IndexName: 'gsi2pk-gsi2sk-index',
    KeySchema: [
      { AttributeName: 'gsi2pk', KeyType: 'HASH' },
      { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
    ],
    Projection: { ProjectionType: 'ALL' },
    AttributeDefinitions: [
      { AttributeName: 'gsi2pk', AttributeType: 'S' },
      { AttributeName: 'gsi2sk', AttributeType: 'S' },
    ],
  },
];

const ensureTable = async (
  tblClient: DynamoDBClient,
  tblName: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await tblClient.send(
        new CreateTableCommand({
          TableName: tblName,
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        }),
      );
      console.log(`Created table: ${tblName}`);
      return;
    } catch (e) {
      if (e instanceof ResourceInUseException) {
        console.log(`Table already exists: ${tblName}`);
        return;
      }
      if (attempt === 29) throw e;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

const ensureGlobalSecondaryIndexes = async (
  gsiClient: DynamoDBClient,
  gsiTableName: string,
  desiredGSIs: GSIDefinition[],
): Promise<void> => {
  const { Table } = await gsiClient.send(
    new DescribeTableCommand({ TableName: gsiTableName }),
  );
  const existingGSIs = Table?.GlobalSecondaryIndexes ?? [];
  const existingNames = new Set(
    existingGSIs.map((g: GlobalSecondaryIndexDescription) => g.IndexName!),
  );
  const desiredNames = new Set(desiredGSIs.map((g) => g.IndexName));

  for (const existing of existingGSIs) {
    if (!desiredNames.has(existing.IndexName!)) {
      await gsiClient.send(
        new UpdateTableCommand({
          TableName: gsiTableName,
          GlobalSecondaryIndexUpdates: [
            { Delete: { IndexName: existing.IndexName! } },
          ],
        }),
      );
      console.log(`Deleted GSI: ${existing.IndexName}`);
      await waitForTableActive(gsiClient, gsiTableName);
    }
  }

  for (const desired of desiredGSIs) {
    if (existingNames.has(desired.IndexName)) {
      console.log(`GSI already exists: ${desired.IndexName}`);
    } else {
      await gsiClient.send(
        new UpdateTableCommand({
          TableName: gsiTableName,
          AttributeDefinitions: desired.AttributeDefinitions,
          GlobalSecondaryIndexUpdates: [
            {
              Create: {
                IndexName: desired.IndexName,
                KeySchema: desired.KeySchema,
                Projection: desired.Projection,
              },
            },
          ],
        }),
      );
      console.log(`Created GSI: ${desired.IndexName}`);
      await waitForTableActive(gsiClient, gsiTableName);
    }
  }
};

const waitForTableActive = async (
  waitClient: DynamoDBClient,
  waitTableName: string,
): Promise<void> => {
  for (;;) {
    const { Table } = await waitClient.send(
      new DescribeTableCommand({ TableName: waitTableName }),
    );
    const allActive =
      Table?.TableStatus === 'ACTIVE' &&
      (Table?.GlobalSecondaryIndexes ?? []).every(
        (g: GlobalSecondaryIndexDescription) => g.IndexStatus === 'ACTIVE',
      );
    if (allActive) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

await ensureTable(client, tableName);
await ensureGlobalSecondaryIndexes(client, tableName, GLOBAL_SECONDARY_INDEXES);
