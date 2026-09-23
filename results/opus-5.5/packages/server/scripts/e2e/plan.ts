// Which flows run, on which server, and which of them must not overlap. Flows in the same lane
// run one after another (flows sharing a ranked queue would otherwise be matched across flows);
// lanes run concurrently.
import type { FlowSpec } from './harness';
import { casualFlow } from './flows/casual';
import { rankedDuelFlow, rankedForfeitFlow } from './flows/ranked';
import { rankedFfaFlow, rankedFfaLeaverFlow } from './flows/rankedFfa';
import { reconnectFlow, takeoverFlow } from './flows/reconnect';
import { lagFlow } from './flows/lag';
import { queueWaitFlow } from './flows/queue';
import { robustnessFlow } from './flows/robustness';
import { tutorialFlow } from './flows/tutorial';

export type ServerName = 'realtime' | 'fast' | 'lagged';

export interface PlannedFlow {
  spec: FlowSpec;
  /**
   * 'realtime' = the real-time server; 'fast' = the sped-up server (long casual match only);
   * 'lagged' = a real-time server with DEV_LAG_MS artificial latency.
   */
  server: ServerName;
  lane: string;
  seed: number;
}

export const FLOW_PLAN: readonly PlannedFlow[] = [
  { spec: tutorialFlow, server: 'realtime', lane: 'tutorial', seed: 1 },
  { spec: casualFlow, server: 'fast', lane: 'casual', seed: 2 },
  { spec: queueWaitFlow, server: 'realtime', lane: 'duel-queue', seed: 11 },
  { spec: rankedDuelFlow, server: 'realtime', lane: 'duel-queue', seed: 3 },
  { spec: rankedForfeitFlow, server: 'realtime', lane: 'duel-queue', seed: 4 },
  { spec: reconnectFlow, server: 'realtime', lane: 'reconnect', seed: 5 },
  { spec: takeoverFlow, server: 'realtime', lane: 'takeover', seed: 6 },
  { spec: rankedFfaFlow, server: 'realtime', lane: 'ffa-queue', seed: 7 },
  { spec: rankedFfaLeaverFlow, server: 'realtime', lane: 'ffa-queue', seed: 9 },
  { spec: robustnessFlow, server: 'realtime', lane: 'robustness', seed: 8 },
  { spec: lagFlow, server: 'lagged', lane: 'lag', seed: 10 },
];
