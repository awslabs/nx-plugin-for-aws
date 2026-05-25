import { publicProcedure } from '../init.js';
import { ActionSchema, IAction } from '../schema/index.js';
import { z } from 'zod';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const resolveSessionsBucket = async (): Promise<string> => {
  const buckets = await getAppConfig('buckets', {
    application: process.env.RUNTIME_CONFIG_APP_ID!,
    environment: 'default',
    transform: 'json',
  });
  const bucket = (buckets as Record<string, any>).StorySessions?.bucketName;
  if (!bucket)
    throw new Error('StorySessions bucket not found in runtime config');
  return bucket;
};

const s3 = new S3Client();
const LOCAL_SESSION_STORAGE_DIR = '/tmp/strands-sessions';

// Matches ``session_<sessionId>/agents/agent_<agentId>/messages/message_<idx>.json``
// written by ``strands.session.S3SessionManager`` on the agent side. We only
// ever care about the default agent id ``default`` that Strands uses when
// none is set explicitly, so hard-code the path prefix the UI needs to list.
const messagesPrefix = (sessionId: string) =>
  `session_${sessionId}/agents/agent_default/messages/`;

const messageIndex = (pathOrKey: string): number => {
  const match = pathOrKey.match(/message_(\d+)\.json$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const toAction = (body: any): IAction | undefined => {
  const message = body.redact_message ?? body.message;
  const role = message?.role;
  if (role !== 'user' && role !== 'assistant') return undefined;
  const text = Array.isArray(message.content)
    ? message.content
        .filter((b: any) => typeof b?.text === 'string')
        .map((b: any) => b.text)
        .join('')
    : String(message.content ?? '');
  if (!text) return undefined;
  return { role, content: text, messageId: body.message_id };
};

const readLocalActions = async (sessionId: string): Promise<IAction[]> => {
  const baseDir = resolve(LOCAL_SESSION_STORAGE_DIR);
  const messagesDir = resolve(baseDir, messagesPrefix(sessionId));
  if (!messagesDir.startsWith(`${baseDir}/`)) {
    throw new Error('Invalid session id');
  }

  let files: string[];
  try {
    files = await readdir(messagesDir);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const actions: IAction[] = [];
  for (const file of files
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => messageIndex(a) - messageIndex(b))) {
    const body = JSON.parse(await readFile(join(messagesDir, file), 'utf8'));
    const action = toAction(body);
    if (action) actions.push(action);
  }
  return actions;
};

const readS3Actions = async (sessionId: string): Promise<IAction[]> => {
  const bucket = await resolveSessionsBucket();
  const list = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: messagesPrefix(sessionId),
    }),
  );
  const keys = (list.Contents ?? [])
    .map((o) => o.Key!)
    .filter((k) => k.endsWith('.json'))
    .sort((a, b) => messageIndex(a) - messageIndex(b));

  const actions: IAction[] = [];
  for (const key of keys) {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const body = JSON.parse(await obj.Body!.transformToString());
    const action = toAction(body);
    if (action) actions.push(action);
  }
  return actions;
};

export const queryActions = publicProcedure
  .input(z.object({ sessionId: z.string() }))
  .output(z.object({ items: z.array(ActionSchema) }))
  .query(async ({ input }) => {
    const actions =
      process.env.SERVE_LOCAL === 'true'
        ? await readLocalActions(input.sessionId)
        : await readS3Actions(input.sessionId);
    return { items: actions };
  });
