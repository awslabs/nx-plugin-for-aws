import { Agent } from '@strands-agents/sdk';
import { getCurrentSessionId } from './session-context.js';

/** Wrap an Agent factory so each session gets its own cached Agent. */
export const withSessionId = (factory: () => Promise<Agent>): Agent => {
  const agents = new Map<string, Promise<Agent>>();
  const forSession = (): Promise<Agent> => {
    const sid = getCurrentSessionId() ?? 'default';
    let pending = agents.get(sid);
    if (!pending) {
      pending = factory();
      agents.set(sid, pending);
    }
    return pending;
  };

  class SessionRoutingAgent extends Agent {
    override async invoke(...args: Parameters<Agent['invoke']>) {
      return (await forSession()).invoke(...args);
    }
    override async *stream(...args: Parameters<Agent['stream']>) {
      return yield* (await forSession()).stream(...args);
    }
  }

  return new SessionRoutingAgent();
};
