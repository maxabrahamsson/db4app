
import { Db4AppAgent, DEFAULT_RELAY_URL } from './agent'

export { Db4AppAgent, DEFAULT_RELAY_URL }
export type { AgentOptions, AgentStatus } from './agent'

// Add a simple singleton manager for shared relay sessions
let sharedAgent: Db4AppAgent | null = null

export function getSharedAgent(): Db4AppAgent | null {
    return sharedAgent
}

export function setSharedAgent(agent: Db4AppAgent) {
    sharedAgent = agent
}
export * from './shim'
export * from './protocol'
export * from './logger'
