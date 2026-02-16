/**
 * Test Script: Gemini Classification with Real Finmo Document
 *
 * Pulls a real document from the Finmo API and classifies it using Gemini.
 * This verifies the full Gemini integration end-to-end (no mocks).
 *
 * Usage: npx tsx src/classification/setup/test-gemini.ts
 *
 * Safety: Read-only — only fetches and classifies, does not file or modify anything.
 */

import 'dotenv/config';

// Direct API calls to Finmo (avoid importing modules that need Redis)
const FINMO_API_KEY = process.env.FINMO_API_KEY!;
const FINMO_BASE_URL = process.env.FINMO_BASE_URL || process.env.FINMO_API_BASE || 'https://app.finmo.ca/api/v1';
const FINMO_TEAM_ID = process.env.FINMO_TEAM_ID!;

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${FINMO_API_KEY}`,
    Accept: 'application/json',
  };
}

async function listApplications(): Promise<Array<{ id: string; applicationStatus?: string }>> {
  // Try listing applications for the team
  const url = `${FINMO_BASE_URL}/applications?teamId=${FINMO_TEAM_ID}&limit=10`;
  console.log(`[test-gemini] Fetching applications from: ${url}`);

  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list applications: ${response.status} ${response.statusText}\n${text}`);
  }

  const data = await response.json();

  // Handle both array and paginated response formats
  const apps = Array.isArray(data) ? data : (data.data ?? data.applications ?? data.items ?? []);
  console.log(`[test-gemini] Found ${apps.length} applications`);
  return apps;
}

interface DocRequest {
  id: string;
  name: string;
  numberOfFiles: number;
  files?: Array<{ src: string; fileName: string; mimeType?: string }>;
}

async function listDocRequests(applicationId: string): Promise<DocRequest[]> {
  const url = `${FINMO_BASE_URL}/document-requests?applicationId=${applicationId}`;
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to list doc requests: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function getDocRequestDetail(docRequestId: string): Promise<DocRequest> {
  const url = `${FINMO_BASE_URL}/document-requests/${docRequestId}`;
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to get doc request detail: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as DocRequest;
}

async function getSignedUrl(fileSrc: string): Promise<string> {
  const url = `${FINMO_BASE_URL}/documents/application-document?src=${encodeURIComponent(fileSrc)}`;
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to get signed URL: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as Record<string, unknown>;
  const signedUrl = data.url ?? data.signedUrl ?? data.downloadUrl;
  if (typeof signedUrl !== 'string') {
    throw new Error(`No URL in response. Fields: ${Object.keys(data).join(', ')}`);
  }
  return signedUrl;
}

async function downloadFile(signedUrl: string): Promise<Buffer> {
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Gemini Classification Integration Test ===\n');
  console.log(`Finmo API: ${FINMO_BASE_URL}`);
  console.log(`Team ID: ${FINMO_TEAM_ID}`);
  console.log(`Gemini API Key: ${process.env.GEMINI_API_KEY ? '***' + process.env.GEMINI_API_KEY.slice(-4) : 'MISSING'}`);
  console.log();

  // Step 1: Find an application with documents
  console.log('--- Step 1: Finding applications with documents ---');
  const apps = await listApplications();

  if (apps.length === 0) {
    console.error('No applications found. Check API key and team ID.');
    process.exit(1);
  }

  let pdfBuffer: Buffer | null = null;
  let pdfFilename = 'unknown.pdf';

  for (const app of apps) {
    console.log(`\nChecking app ${app.id} (status: ${app.applicationStatus ?? 'unknown'})...`);

    const docRequests = await listDocRequests(app.id);
    console.log(`  Doc requests: ${docRequests.length}`);

    const withFiles = docRequests.filter(dr => dr.numberOfFiles > 0);
    if (withFiles.length === 0) continue;

    console.log(`  Found ${withFiles.length} doc request(s) with files`);

    // Get the first doc request with files
    const detail = await getDocRequestDetail(withFiles[0].id);
    if (!detail.files || detail.files.length === 0) continue;

    // Debug: show actual file object shape
    console.log(`  File object keys: ${Object.keys(detail.files[0]).join(', ')}`);
    console.log(`  First file:`, JSON.stringify(detail.files[0], null, 2));

    // Find a PDF file (handle both fileName and name fields)
    const getName = (f: Record<string, unknown>) =>
      (f.fileName ?? f.name ?? f.filename ?? 'unknown') as string;
    const getMime = (f: Record<string, unknown>) =>
      (f.mimeType ?? f.mimetype ?? f.contentType ?? '') as string;

    const pdfFile = detail.files.find(f => {
      const name = getName(f as Record<string, unknown>);
      const mime = getMime(f as Record<string, unknown>);
      return name.toLowerCase().endsWith('.pdf') || mime === 'application/pdf';
    }) ?? detail.files[0]; // fallback to first file

    const fileName = getName(pdfFile as unknown as Record<string, unknown>);
    const mimeType = getMime(pdfFile as unknown as Record<string, unknown>);
    console.log(`  Downloading: ${fileName} (${mimeType || 'unknown type'})`);

    const signedUrl = await getSignedUrl(pdfFile.src);
    pdfBuffer = await downloadFile(signedUrl);
    pdfFilename = fileName;

    console.log(`  Downloaded: ${pdfBuffer.length} bytes`);
    break;
  }

  if (!pdfBuffer) {
    console.error('\nNo PDF documents found in any application. Cannot test classification.');
    process.exit(1);
  }

  // Step 2: Classify with Gemini
  console.log('\n--- Step 2: Classifying with Gemini ---');
  console.log(`File: ${pdfFilename}`);
  console.log(`Size: ${pdfBuffer.length} bytes`);

  // Import the classifier (this initializes the Gemini client)
  const { classifyDocument } = await import('../classifier.js');

  const startTime = Date.now();
  const result = await classifyDocument(pdfBuffer, pdfFilename);
  const elapsed = Date.now() - startTime;

  // Step 3: Print results
  console.log('\n--- Classification Result ---');
  console.log(`Document Type:  ${result.documentType}`);
  console.log(`Confidence:     ${result.confidence}`);
  console.log(`Borrower:       ${result.borrowerFirstName ?? '?'} ${result.borrowerLastName ?? '?'}`);
  console.log(`Tax Year:       ${result.taxYear ?? 'N/A'}`);
  console.log(`Amount:         ${result.amount ?? 'N/A'}`);
  console.log(`Institution:    ${result.institution ?? 'N/A'}`);
  console.log(`Page Count:     ${result.pageCount}`);
  console.log(`Notes:          ${result.additionalNotes ?? 'none'}`);
  console.log(`Time:           ${elapsed}ms`);
  console.log('\nGemini integration test PASSED');
}

main().catch(err => {
  console.error('\nTest FAILED:', err.message);
  process.exit(1);
});
