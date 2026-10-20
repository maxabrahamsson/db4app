import { randomUUID } from 'crypto';

/**
 * Artillery processor for generating unique connection IDs
 * Each virtual user gets a unique connection ID
 */
export default {
  generateConnectionId: (context) => {
    // Generate unique connection ID for each virtual user
    const connectionId = randomUUID();
    context.vars.connectionId = connectionId;
    return connectionId;
  },
  
  // Called before each scenario
  beforeScenario: (req, userContext, events, done) => {
    // Generate connection ID for this virtual user
    userContext.vars.connectionId = randomUUID();
    done();
  }
};
