# Plan 10-01 Summary: Opportunity Types, Config & API Functions

## Status: COMPLETE

## What was built
- `CrmOpportunity` type with typed custom field variants (`fieldValueString`, `fieldValueNumber`, `fieldValueDate`)
- `EXISTING_OPP_FIELDS` constant with Finmo Application ID, Deal ID, Deal Link, Transaction Type field IDs
- `OPP_FIELD_GROUP_ID` constant for the Finmo Integration group on opportunities
- `OPP_DOC_TRACKING_FIELD_DEFS` array defining 9 doc tracking fields for opportunity scope
- `opportunityFieldIds` config section (warn-not-throw on empty, safe for parallel with 10-02)
- `searchOpportunities(contactId, pipelineId)` — search with underscore params
- `getOpportunity(opportunityId)` — GET with custom fields
- `updateOpportunityFields(opportunityId, customFields)` — PUT with `{ id, field_value }` format
- `updateOpportunityStage(opportunityId, stageId)` — stage change via PUT
- `findOpportunityByFinmoId(contactId, pipelineId, finmoApplicationId)` — search + filter by app ID
- `getOpportunityFieldValue(opportunity, fieldId)` — typed field value extraction helper
- 27 unit tests covering all functions and edge cases

## Commits
- `b8df4cb` feat(10-01): add opportunity types, field IDs, and config
- `558e66b` feat(10-01): add opportunity search, get, update, and field extraction functions

## Self-Check: PASSED
- All 27 tests pass
- TypeScript clean (no new errors)
- Exports confirmed in opportunities.ts and types/index.ts

## Key Decisions
- Search params use underscores (`contact_id`, `pipeline_id`) per live API validation
- Opportunity custom fields use typed value extraction (`fieldValueString`/`fieldValueNumber`/`fieldValueDate`)
- `opportunityFieldIds` validation warns instead of throwing (safe before 10-02 setup runs)
