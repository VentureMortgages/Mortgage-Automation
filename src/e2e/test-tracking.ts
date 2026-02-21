/**
 * Reset test contact's missingDocs, then test tracking update
 * Usage: npx tsx src/e2e/test-tracking.ts
 */
import 'dotenv/config';
import { upsertContact, getContact } from '../crm/contacts.js';
import { parseContactTrackingFields, updateDocTracking } from '../crm/tracking-sync.js';
import { crmConfig } from '../crm/config.js';

const contactId = '8gPXNa7v9kXVbDHle3xS';
const testEmail = 'dev+test9@venturemortgages.com';

// Original 14 missing docs from the checklist
const originalMissingDocs = [
  { name: "Government-issued photo ID", stage: "PRE" },
  { name: "Second form of ID", stage: "PRE" },
  { name: "Recent paystub (within 30 days)", stage: "PRE" },
  { name: "Letter of Employment", stage: "PRE" },
  { name: "T4 \u2014 Previous year", stage: "PRE" },
  { name: "T4 \u2014 Current year", stage: "PRE" },
  { name: "NOA \u2014 Previous year", stage: "FULL" },
  { name: "NOA \u2014 Current year", stage: "FULL" },
  { name: "T4 history (2 years showing bonus)", stage: "PRE" },
  { name: "Letter confirming bonus structure", stage: "FULL" },
  { name: "Mortgage statements for other properties", stage: "PRE" },
  { name: "Void cheque or direct deposit form", stage: "FULL" },
  { name: "Accepted Offer / APS (signed)", stage: "PRE" },
  { name: "MLS listing", stage: "FULL" },
];

async function main() {
  // Step 1: Reset the contact
  console.log('=== Resetting test contact ===');
  const contact = await getContact(contactId);

  await upsertContact({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    customFields: [
      { id: crmConfig.fieldIds.missingDocs, field_value: JSON.stringify(originalMissingDocs) },
      { id: crmConfig.fieldIds.receivedDocs, field_value: JSON.stringify([]) },
      { id: crmConfig.fieldIds.preDocsReceived, field_value: 0 },
      { id: crmConfig.fieldIds.fullDocsReceived, field_value: 0 },
      { id: crmConfig.fieldIds.docStatus, field_value: 'Not Started' },
      { id: crmConfig.fieldIds.lastDocReceived, field_value: '' },
    ],
  });
  console.log('Contact reset OK');

  // Verify reset
  const resetContact = await getContact(contactId);
  const resetFields = parseContactTrackingFields(resetContact, crmConfig.fieldIds);
  console.log('Missing docs after reset:', resetFields.missingDocs.length);
  console.log('Received docs after reset:', resetFields.receivedDocs.length);

  // Step 2: Run tracking update
  console.log('\n=== Running updateDocTracking with t4 ===');
  const result = await updateDocTracking({
    senderEmail: testEmail,
    documentType: 't4',
    driveFileId: 'test-drive-file-id',
    source: 'gmail',
    receivedAt: new Date().toISOString(),
  });
  console.log('Result:', JSON.stringify(result, null, 2));

  // Step 3: Verify the update
  console.log('\n=== Verifying CRM state after update ===');
  const updatedContact = await getContact(contactId);
  const updatedFields = parseContactTrackingFields(updatedContact, crmConfig.fieldIds);
  console.log('Missing docs:', updatedFields.missingDocs.length, 'items');
  console.log('Received docs:', updatedFields.receivedDocs);
  console.log('PRE received:', updatedFields.preDocsReceived, '/', updatedFields.preDocsTotal);
  console.log('FULL received:', updatedFields.fullDocsReceived, '/', updatedFields.fullDocsTotal);
}

main().catch((err) => {
  console.error('FAILED:', err.message || err);
  process.exit(1);
});
