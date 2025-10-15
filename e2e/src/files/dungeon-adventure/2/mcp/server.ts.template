import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import z from 'zod-v3';
import { createInventoryEntity } from ':dungeon-adventure/game-api';

/**
 * Create the MCP Server
 */
export const createServer = () => {
  const server = new McpServer({
    name: 'inventory-mcp-server',
    version: '1.0.0',
  });

  const dynamoDb = new DynamoDBClient();
  const inventory = createInventoryEntity(dynamoDb);

  server.tool(
    'list-inventory-items',
    "List items in the player's inventory. Leave cursor blank unless you are requesting subsequent pages",
    {
      playerName: z.string(),
      cursor: z.string().optional(),
    },
    async ({ playerName }) => {
      const results = await inventory.query
        .primary({
          playerName,
        })
        .go();

      return {
        content: [{ type: 'text', text: JSON.stringify(results) }],
      };
    },
  );

  server.tool(
    'add-to-inventory',
    "Add an item to the player's inventory. Quantity defaults to 1 if omitted.",
    {
      playerName: z.string(),
      itemName: z.string(),
      emoji: z.string(),
      quantity: z.number().optional().default(1),
    },
    async ({ playerName, itemName, emoji, quantity = 1 }) => {
      await inventory
        .put({
          playerName,
          itemName,
          quantity,
          emoji,
        })
        .go();

      return {
        content: [
          {
            type: 'text',
            text: `Added ${itemName} (x${quantity}) to inventory`,
          },
        ],
      };
    },
  );

  server.tool(
    'remove-from-inventory',
    "Remove an item from the player's inventory. If quantity is omitted, all items are removed.",
    {
      playerName: z.string(),
      itemName: z.string(),
      quantity: z.number().optional(),
    },
    async ({ playerName, itemName, quantity }) => {
      // If quantity is omitted, remove the entire item
      if (quantity === undefined) {
        try {
          await inventory.delete({ playerName, itemName }).go();
          return {
            content: [
              { type: 'text', text: `${itemName} removed from inventory.` },
            ],
          } as const;
        } catch {
          return {
            content: [
              { type: 'text', text: `${itemName} not found in inventory` },
            ],
          } as const;
        }
      }

      // If quantity is specified, fetch current quantity and update
      const item = await inventory.get({ playerName, itemName }).go();

      if (!item.data) {
        return {
          content: [
            { type: 'text', text: `${itemName} not found in inventory` },
          ],
        } as const;
      }

      const newQuantity = item.data.quantity - quantity;

      if (newQuantity <= 0) {
        await inventory.delete({ playerName, itemName }).go();
        return {
          content: [
            { type: 'text', text: `${itemName} removed from inventory.` },
          ],
        } as const;
      }

      await inventory
        .put({
          playerName,
          itemName,
          quantity: newQuantity,
          emoji: item.data.emoji,
        })
        .go();

      return {
        content: [
          {
            type: 'text',
            text: `Removed ${itemName} (x${quantity}) from inventory. ${newQuantity} remaining.`,
          },
        ],
      };
    },
  );

  return server;
};
