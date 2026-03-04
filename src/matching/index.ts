/**
 * Smart Document Matching — Barrel Export
 *
 * Public API for the matching module (Phase 14).
 *
 * Exports:
 * - Types: MatchSignal, MatchCandidate, MatchDecision, MatchOutcome, SignalType
 * - Config: matchingConfig, MatchingConfig
 * - Thread Store: storeThreadMapping, getThreadContactId
 * - Decision Log: logMatchDecision, getMatchDecision
 * - Signal Collectors: collectThreadSignal, collectSenderSignal, collectEmailMetadataSignals
 * - Agent Tools: MATCHING_TOOLS, executeToolCall
 */

// Types
export type {
  SignalType,
  MatchSignal,
  MatchCandidate,
  MatchDecision,
  MatchOutcome,
} from './types.js';

// Config
export { matchingConfig } from './config.js';
export type { MatchingConfig } from './config.js';

// Thread Store
export { storeThreadMapping, getThreadContactId } from './thread-store.js';

// Decision Log
export { logMatchDecision, getMatchDecision } from './decision-log.js';

// Signal Collectors
export { collectThreadSignal, collectSenderSignal, collectDocNameSignal, collectEmailMetadataSignals } from './signal-collectors.js';

// Agent Tools
export { MATCHING_TOOLS, executeToolCall } from './agent-tools.js';

// Matching Agent
export { matchDocument } from './agent.js';
export type { MatchInput } from './agent.js';

// Auto-Create (zero-match documents)
export { autoCreateFromDoc } from './auto-create.js';
export type { AutoCreateResult } from './auto-create.js';
