// Soak engine entry (bundled by engine.ts): in a worker thread it plays and verifies the matches the
// pool sends it, one at a time; imported in-process it just provides playAndVerify.
import { parentPort } from 'node:worker_threads';
import { playAndVerify, type MatchSpec } from './match';

export { playAndVerify };

const port = parentPort;
if (port) port.on('message', (spec: MatchSpec) => port.postMessage(playAndVerify(spec)));
