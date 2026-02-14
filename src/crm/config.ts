import 'dotenv/config';

export type AppEnv = 'development' | 'production';

export interface CrmConfig {
  appEnv: AppEnv;
  isDev: boolean;
  apiKey: string;
  baseUrl: string;
  locationId: string;
  docInbox: string;
  userIds: {
    cat: string;
    taylor: string;
  };
  fieldIds: {
    docStatus: string;
    docRequestSent: string;
    missingDocs: string;
    receivedDocs: string;
    preDocsTotal: string;
    preDocsReceived: string;
    fullDocsTotal: string;
    fullDocsReceived: string;
    lastDocReceived: string;
  };
  stageIds: {
    applicationReceived: string;
    collectingDocuments: string;
    allDocsReceived: string;
  };
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Copy .env.example to .env and fill in the required values.`
    );
  }
  return value;
}

function optionalEnv(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

const appEnv = (optionalEnv('APP_ENV', 'development')) as AppEnv;

export const crmConfig: CrmConfig = {
  appEnv,
  isDev: appEnv === 'development',
  apiKey: requiredEnv('GHL_API_KEY'),
  baseUrl: optionalEnv('GHL_BASE_URL', 'https://services.leadconnectorhq.com'),
  locationId: requiredEnv('GHL_LOCATION_ID'),
  docInbox: optionalEnv('DOC_INBOX', 'dev@venturemortgages.com'),
  userIds: {
    cat: optionalEnv('GHL_USER_CAT_ID'),
    taylor: optionalEnv('GHL_USER_TAYLOR_ID'),
  },
  fieldIds: {
    docStatus: optionalEnv('GHL_FIELD_DOC_STATUS_ID'),
    docRequestSent: optionalEnv('GHL_FIELD_DOC_REQUEST_SENT_ID'),
    missingDocs: optionalEnv('GHL_FIELD_MISSING_DOCS_ID'),
    receivedDocs: optionalEnv('GHL_FIELD_RECEIVED_DOCS_ID'),
    preDocsTotal: optionalEnv('GHL_FIELD_PRE_TOTAL_ID'),
    preDocsReceived: optionalEnv('GHL_FIELD_PRE_RECEIVED_ID'),
    fullDocsTotal: optionalEnv('GHL_FIELD_FULL_TOTAL_ID'),
    fullDocsReceived: optionalEnv('GHL_FIELD_FULL_RECEIVED_ID'),
    lastDocReceived: optionalEnv('GHL_FIELD_LAST_DOC_RECEIVED_ID'),
  },
  stageIds: {
    applicationReceived: optionalEnv('GHL_STAGE_APP_RECEIVED_ID'),
    collectingDocuments: optionalEnv('GHL_STAGE_COLLECTING_DOCS_ID'),
    allDocsReceived: optionalEnv('GHL_STAGE_ALL_DOCS_RECEIVED_ID'),
  },
};

/**
 * Validates that all CRM config fields required for runtime operation are populated.
 * Call this at application startup (not during setup script execution).
 * Throws with a list of all missing fields.
 */
export function validateConfig(): void {
  const missing: string[] = [];

  if (!crmConfig.userIds.cat) missing.push('GHL_USER_CAT_ID');
  if (!crmConfig.userIds.taylor) missing.push('GHL_USER_TAYLOR_ID');

  for (const [key, value] of Object.entries(crmConfig.fieldIds)) {
    if (!value) {
      const envKey = fieldIdToEnvKey(key);
      missing.push(envKey);
    }
  }

  for (const [key, value] of Object.entries(crmConfig.stageIds)) {
    if (!value) {
      const envKey = stageIdToEnvKey(key);
      missing.push(envKey);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `CRM config incomplete. Missing environment variables:\n` +
      missing.map(k => `  - ${k}`).join('\n') +
      `\n\nRun setup scripts to populate these values:\n` +
      `  npx tsx src/crm/setup/fetch-ids.ts\n` +
      `  npx tsx src/crm/setup/create-custom-fields.ts`
    );
  }
}

/** In dev mode, prefixes strings with [TEST] so they are visible and filterable in CRM */
export function devPrefix(text: string): string {
  return crmConfig.isDev ? `[TEST] ${text}` : text;
}

// Helper: convert camelCase fieldIds key to GHL_FIELD_*_ID env key
function fieldIdToEnvKey(camelKey: string): string {
  const map: Record<string, string> = {
    docStatus: 'GHL_FIELD_DOC_STATUS_ID',
    docRequestSent: 'GHL_FIELD_DOC_REQUEST_SENT_ID',
    missingDocs: 'GHL_FIELD_MISSING_DOCS_ID',
    receivedDocs: 'GHL_FIELD_RECEIVED_DOCS_ID',
    preDocsTotal: 'GHL_FIELD_PRE_TOTAL_ID',
    preDocsReceived: 'GHL_FIELD_PRE_RECEIVED_ID',
    fullDocsTotal: 'GHL_FIELD_FULL_TOTAL_ID',
    fullDocsReceived: 'GHL_FIELD_FULL_RECEIVED_ID',
    lastDocReceived: 'GHL_FIELD_LAST_DOC_RECEIVED_ID',
  };
  return map[camelKey] ?? camelKey;
}

// Helper: convert camelCase stageIds key to GHL_STAGE_*_ID env key
function stageIdToEnvKey(camelKey: string): string {
  const map: Record<string, string> = {
    applicationReceived: 'GHL_STAGE_APP_RECEIVED_ID',
    collectingDocuments: 'GHL_STAGE_COLLECTING_DOCS_ID',
    allDocsReceived: 'GHL_STAGE_ALL_DOCS_RECEIVED_ID',
  };
  return map[camelKey] ?? camelKey;
}
