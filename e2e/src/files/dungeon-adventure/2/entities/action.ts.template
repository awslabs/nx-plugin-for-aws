import { Entity } from 'electrodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export const createActionEntity = (client?: DynamoDBClient) =>
  new Entity(
    {
      model: {
        entity: 'Action',
        version: '1',
        service: 'game',
      },
      attributes: {
        playerName: { type: 'string', required: true, readOnly: true },
        timestamp: {
          type: 'string',
          required: true,
          readOnly: true,
          set: () => new Date().toISOString(),
          default: () => new Date().toISOString(),
        },
        role: { type: 'string', required: true, readOnly: true },
        content: { type: 'string', required: true, readOnly: true },
      },
      indexes: {
        primary: {
          pk: { field: 'pk', composite: ['playerName'] },
          sk: { field: 'sk', composite: ['timestamp'] },
        },
      },
    },
    { client, table: process.env.TABLE_NAME },
  );
