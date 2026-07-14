/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
} from '@nx/devkit';
import { esmVars } from '../module-format';

export type AgentChatProtocol = 'http' | 'a2a' | 'ag-ui';
export type AgentChatAuth = 'iam' | 'cognito';

export interface AddAgentChatScriptsOptions {
  /** Absolute (tree) directory to emit the chat scripts into. */
  scriptsDir: string;
  protocol: AgentChatProtocol;
  /** Agent server language. Only affects the HTTP chat adapter. */
  language: 'ts' | 'py';
  /** Construct class name — the runtime-config key for the deployed agent. */
  agentNameClassName: string;
  /** Authentication used by the deployed agent. */
  auth: AgentChatAuth;
  /**
   * Import path to the agent's `client.ts` (TypeScript HTTP agents only),
   * relative to the chat script.
   */
  relativeAgentImport?: string;
}

/**
 * Emit the chat CLI scripts for an agent. Every protocol gets a small
 * `chat.ts` that connects to the local `dev` server by default, and
 * to the deployed agent on Bedrock AgentCore (resolved from runtime config)
 * when `RUNTIME_CONFIG_APP_ID` is set. The shared `agentcore.ts` helper
 * handles ARN resolution and request authentication.
 */
export const addAgentChatScripts = (
  tree: Tree,
  options: AddAgentChatScriptsOptions,
): void => {
  const templateContext = {
    agentNameClassName: options.agentNameClassName,
    auth: options.auth,
    relativeAgentImport: options.relativeAgentImport ?? '',
    ...esmVars(tree),
  };

  // Shared remote-resolution + auth helper, used by every protocol.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'common'),
    options.scriptsDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Protocol-specific chat adapter. HTTP differs by server language; A2A and
  // AG-UI speak standard protocols so the same script serves both languages.
  const protocolDir =
    options.protocol === 'http' ? `http-${options.language}` : options.protocol;
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', protocolDir),
    options.scriptsDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
};
