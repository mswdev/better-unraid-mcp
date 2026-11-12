import { Agent } from "undici";

/** How long an idle keep-alive socket to the Unraid API stays open. */
export const KEEP_ALIVE_TIMEOUT_MS = 30_000;

/** Builds one undici connection pool from its options; injectable so tests can see them. */
export type AgentFactory = (options: Agent.Options) => Agent;

/** The real factory: a plain undici `Agent`. */
function createAgent(options: Agent.Options): Agent {
  return new Agent(options);
}

/**
 * Connection-pool options for one TLS mode. Certificate verification stays on
 * (undici's default) unless the user opted into a self-signed server.
 */
function agentOptionsFor(allowSelfSigned: boolean): Agent.Options {
  if (!allowSelfSigned) {
    return { keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS };
  }
  return { keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS, connect: { rejectUnauthorized: false } };
}

/**
 * Keep-alive connection pools for the Unraid API, one per TLS mode, created
 * on first use and shared by every later request (never built per request).
 */
export class DispatcherPool {
  private readonly agents = new Map<boolean, Agent>();

  /**
   * @param create - Builds each pool's undici Agent (tests record the options).
   */
  constructor(private readonly create: AgentFactory = createAgent) {}

  /**
   * Returns the shared pool for a TLS mode, building it on first use.
   *
   * @param allowSelfSigned - True only when the user opted into skipping certificate verification.
   * @returns The verifying pool, or the non-verifying one for the self-signed opt-in.
   */
  for(allowSelfSigned: boolean): Agent {
    const existing = this.agents.get(allowSelfSigned);
    if (existing) {
      return existing;
    }
    const agent = this.create(agentOptionsFor(allowSelfSigned));
    this.agents.set(allowSelfSigned, agent);
    return agent;
  }
}
