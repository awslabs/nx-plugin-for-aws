import { Entity } from 'electrodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export const createInventoryEntity = (client?: DynamoDBClient) =>
  new Entity(
    {
      model: {
        entity: 'Inventory',
        version: '1',
        service: 'game',
      },
      attributes: {
        playerName: { type: 'string', required: true, readOnly: true },
        lastUpdated: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
        },
        itemName: {
          type: 'string',
          required: true,
        },
        emoji: {
          type: 'string',
          required: false,
        },
        quantity: {
          type: 'number',
          required: true,
        },
      },
      indexes: {
        primary: {
          pk: { field: 'pk', composite: ['playerName'] },
          sk: { field: 'sk', composite: ['itemName'] },
        },
      },
    },
    { client, table: process.env.TABLE_NAME },
  );
