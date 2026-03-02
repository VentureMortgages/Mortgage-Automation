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
