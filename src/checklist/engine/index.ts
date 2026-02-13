/**
 * Barrel export for the checklist generation engine.
 *
 * Primary export: generateChecklist — the core pure function.
 * Also exports buildBorrowerContexts for testing and advanced use.
 */

export { generateChecklist } from './generate-checklist.js';
export { buildBorrowerContexts, findSubjectProperty } from './build-context.js';
export { deduplicateItems, mergeNotes } from './deduplicate.js';
