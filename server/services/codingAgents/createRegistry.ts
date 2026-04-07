/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Factory for the coding agent registry singleton.
 * Separated from registry.ts to avoid circular imports with remoteAggregator.ts.
 */

import { CodingAgentRegistry } from './registry';
import { RemoteAggregator } from './remoteAggregator';
import { getRemoteServers } from './remoteConfig';

function createRegistry(): CodingAgentRegistry {
  const remotes = getRemoteServers();
  if (remotes.length > 0) {
    console.log(`[CodingAgents] Remote aggregation enabled: ${remotes.map(r => r.name).join(', ')}`);
    return new RemoteAggregator(remotes);
  }
  return new CodingAgentRegistry();
}

export const codingAgentRegistry = createRegistry();
