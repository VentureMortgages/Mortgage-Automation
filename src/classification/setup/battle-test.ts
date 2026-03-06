/**
 * Classifier Battle Test — Validate accuracy against Cat's filed documents
 *
 * Downloads real PDFs from Drive (already filed by Cat with consistent naming),
 * uses the filename as ground truth, and runs three classification passes:
 *   1. Production — real filename hint
 *   2. Content-only — generic "document_NNN.pdf" hint
 *   3. Adversarial — wrong doc type in filename
 *
 * If any doc type has <80% accuracy in content-only pass, runs auto prompt tuning.
 *
 * Usage: npx tsx src/classification/setup/battle-test.ts
 *
 * Safety: Read-only against Drive (downloads only). No production code modified.
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { getDriveClient, type DriveClient } from '../drive-client.js';
import { listClientFolderFiles, parseDocFromFilename, resolveDocumentType, type DriveFileEntry } from '../../drive/folder-scanner.js';
import { classifyDocument, truncatePdf } from '../classifier.js';
import { classificationConfig } from '../config.js';
import { DOCUMENT_TYPES, DOC_TYPE_LABELS, type DocumentType, type ClassificationResult } from '../types.js';
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { ClassificationResultSchema } from '../types.js';
import { escapeDriveQuery } from '../filer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestFile {
  fileId: string;
  name: string;
  groundTruth: DocumentType;
  clientFolder: string;
  pdfBuffer: Buffer;
}

interface PassResult {
  fileId: string;
  filename: string;
  groundTruth: DocumentType;
  predicted: DocumentType;
  confidence: number;
  correct: boolean;
  filenameHint: string;
  error?: string;
}

type PassType = 'production' | 'content-only' | 'adversarial';

// ---------------------------------------------------------------------------
// Adversarial filename mapping
// ---------------------------------------------------------------------------

/** For adversarial pass: swap doc types within similar categories */
const ADVERSARIAL_SWAPS: Partial<Record<DocumentType, DocumentType>> = {
  t4: 'pay_stub',
  pay_stub: 't4',
  t1: 'noa',
  noa: 't1',
  t4a: 'pension_letter',
  pension_letter: 't4a',
  bank_statement: 'rrsp_statement',
  rrsp_statement: 'bank_statement',
  tfsa_statement: 'fhsa_statement',
  fhsa_statement: 'tfsa_statement',
  photo_id: 'passport',
  passport: 'photo_id',
  second_id: 'pr_card',
  pr_card: 'second_id',
  loe: 'employment_contract',
  employment_contract: 'loe',
  purchase_agreement: 'mls_listing',
  mls_listing: 'purchase_agreement',
  mortgage_statement: 'property_tax_bill',
  property_tax_bill: 'mortgage_statement',
  t5: 'cra_statement_of_account',
  cra_statement_of_account: 't5',
  void_cheque: 'bank_statement',
  gift_letter: 'bank_statement',
  t2: 'financial_statement',
  financial_statement: 't2',
  separation_agreement: 'divorce_decree',
  divorce_decree: 'separation_agreement',
  work_permit: 'passport',
  lease_agreement: 'mortgage_statement',
  home_insurance: 'property_tax_bill',
  articles_of_incorporation: 'financial_statement',
  commission_statement: 'pay_stub',
  discharge_certificate: 'separation_agreement',
  t4rif: 't4a',
};

function getAdversarialFilename(groundTruth: DocumentType): string {
  const swapped = ADVERSARIAL_SWAPS[groundTruth] ?? 'other';
  const label = DOC_TYPE_LABELS[swapped] ?? 'Document';
  return `${label}.pdf`;
}

// ---------------------------------------------------------------------------
// Phase 1: Discover test files
// ---------------------------------------------------------------------------

async function discoverTestFiles(drive: DriveClient): Promise<{ testFiles: TestFile[]; skipped: { name: string; reason: string }[] }> {
  const rootFolderId = classificationConfig.driveRootFolderId;
  if (!rootFolderId) {
    throw new Error('DRIVE_ROOT_FOLDER_ID not set. Cannot scan Drive.');
  }

  console.log(`\nScanning Drive root folder: ${rootFolderId}`);

  // List client folders
  const rootContents = await drive.files.list({
    q: `'${escapeDriveQuery(rootFolderId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 100,
  });

  const clientFolders = rootContents.data.files ?? [];
  console.log(`Found ${clientFolders.length} client folders`);

  const testFiles: TestFile[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const folder of clientFolders) {
    const folderId = folder.id!;
    const folderName = folder.name!;
    console.log(`\n  [${folderName}] Scanning...`);

    const files = await listClientFolderFiles(drive, folderId);
    console.log(`    ${files.length} files found`);

    // Filter to PDFs only
    const pdfs = files.filter(f =>
      f.name.toLowerCase().endsWith('.pdf')
    );
    console.log(`    ${pdfs.length} PDFs`);

    for (const file of pdfs) {
      // Parse filename for ground truth
      const parsed = parseDocFromFilename(file.name);
      if (!parsed) {
        skipped.push({ name: file.name, reason: 'Cannot parse filename (no " - " separator)' });
        continue;
      }

      const docType = resolveDocumentType(parsed.docTypeLabel);
      if (!docType) {
        skipped.push({ name: file.name, reason: `Unknown doc type label: "${parsed.docTypeLabel}"` });
        continue;
      }
      if (docType === 'other') {
        skipped.push({ name: file.name, reason: 'Resolved to "other" — not a useful ground truth' });
        continue;
      }

      // Download PDF
      try {
        const res = await drive.files.get(
          { fileId: file.fileId, alt: 'media' },
          { responseType: 'arraybuffer' },
        );
        const pdfBuffer = Buffer.from(res.data as ArrayBuffer);

        if (pdfBuffer.length < 100) {
          skipped.push({ name: file.name, reason: `Too small (${pdfBuffer.length} bytes)` });
          continue;
        }

        testFiles.push({
          fileId: file.fileId,
          name: file.name,
          groundTruth: docType,
          clientFolder: folderName,
          pdfBuffer,
        });
        console.log(`    + ${file.name} → ${docType}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push({ name: file.name, reason: `Download failed: ${msg}` });
      }
    }
  }

  return { testFiles, skipped };
}

// ---------------------------------------------------------------------------
// Phase 2: Classification passes
// ---------------------------------------------------------------------------

function getFilenameHint(file: TestFile, passType: PassType, index: number): string {
  switch (passType) {
    case 'production':
      return file.name;
    case 'content-only':
      return `document_${String(index + 1).padStart(3, '0')}.pdf`;
    case 'adversarial':
      return getAdversarialFilename(file.groundTruth);
  }
}

async function runPass(files: TestFile[], passType: PassType): Promise<PassResult[]> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Pass: ${passType.toUpperCase()}`);
  console.log(`${'='.repeat(60)}`);

  const results: PassResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const hint = getFilenameHint(file, passType, i);

    process.stdout.write(`  [${i + 1}/${files.length}] ${file.name.slice(0, 50).padEnd(50)} → `);

    try {
      const classification = await classifyDocument(file.pdfBuffer, hint);
      const correct = classification.documentType === file.groundTruth;

      results.push({
        fileId: file.fileId,
        filename: file.name,
        groundTruth: file.groundTruth,
        predicted: classification.documentType,
        confidence: classification.confidence,
        correct,
        filenameHint: hint,
      });

      const status = correct ? 'OK' : 'MISS';
      const detail = correct
        ? `${classification.documentType} (${classification.confidence.toFixed(2)})`
        : `expected ${file.groundTruth}, got ${classification.documentType} (${classification.confidence.toFixed(2)})`;
      console.log(`${status}  ${detail}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        fileId: file.fileId,
        filename: file.name,
        groundTruth: file.groundTruth,
        predicted: 'other',
        confidence: 0,
        correct: false,
        filenameHint: hint,
        error: msg,
      });
      console.log(`ERR  ${msg.slice(0, 80)}`);
    }

    // Rate limit: 1-second delay between Gemini calls
    if (i < files.length - 1) {
      await sleep(1000);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Phase 3: Report
// ---------------------------------------------------------------------------

interface Report {
  summary: {
    totalFiles: number;
    skippedFiles: number;
    passes: Record<PassType, { total: number; correct: number; accuracy: number; errors: number }>;
  };
  perDocType: Record<string, Record<PassType, { total: number; correct: number; accuracy: number }>>;
  confidenceDistribution: {
    correctMean: number;
    incorrectMean: number;
  };
  misclassifications: Array<{
    pass: PassType;
    filename: string;
    expected: string;
    actual: string;
    confidence: number;
    filenameHint: string;
  }>;
  skippedFiles: Array<{ name: string; reason: string }>;
}

function generateReport(
  pass1: PassResult[],
  pass2: PassResult[],
  pass3: PassResult[],
  skipped: { name: string; reason: string }[],
): Report {
  const passes: [PassType, PassResult[]][] = [
    ['production', pass1],
    ['content-only', pass2],
    ['adversarial', pass3],
  ];

  // Summary
  const summary: Report['summary'] = {
    totalFiles: pass1.length,
    skippedFiles: skipped.length,
    passes: {} as Report['summary']['passes'],
  };

  for (const [passType, results] of passes) {
    const correct = results.filter(r => r.correct).length;
    const errors = results.filter(r => r.error).length;
    summary.passes[passType] = {
      total: results.length,
      correct,
      accuracy: results.length > 0 ? correct / results.length : 0,
      errors,
    };
  }

  // Per doc type
  const perDocType: Report['perDocType'] = {};
  for (const [passType, results] of passes) {
    for (const r of results) {
      if (!perDocType[r.groundTruth]) {
        perDocType[r.groundTruth] = {
          'production': { total: 0, correct: 0, accuracy: 0 },
          'content-only': { total: 0, correct: 0, accuracy: 0 },
          'adversarial': { total: 0, correct: 0, accuracy: 0 },
        };
      }
      const entry = perDocType[r.groundTruth][passType];
      entry.total++;
      if (r.correct) entry.correct++;
      entry.accuracy = entry.total > 0 ? entry.correct / entry.total : 0;
    }
  }

  // Confidence distribution
  const allResults = [...pass1, ...pass2, ...pass3];
  const correctConfs = allResults.filter(r => r.correct).map(r => r.confidence);
  const incorrectConfs = allResults.filter(r => !r.correct && !r.error).map(r => r.confidence);
  const mean = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // Misclassifications
  const misclassifications: Report['misclassifications'] = [];
  for (const [passType, results] of passes) {
    for (const r of results) {
      if (!r.correct) {
        misclassifications.push({
          pass: passType,
          filename: r.filename,
          expected: r.groundTruth,
          actual: r.predicted,
          confidence: r.confidence,
          filenameHint: r.filenameHint,
        });
      }
    }
  }

  const report: Report = {
    summary,
    perDocType,
    confidenceDistribution: {
      correctMean: mean(correctConfs),
      incorrectMean: mean(incorrectConfs),
    },
    misclassifications,
    skippedFiles: skipped,
  };

  // Console output
  console.log('\n\n' + '='.repeat(70));
  console.log('  BATTLE TEST RESULTS');
  console.log('='.repeat(70));

  console.log(`\nTotal files tested: ${summary.totalFiles}`);
  console.log(`Skipped files: ${summary.skippedFiles}`);

  console.log('\n--- Overall Accuracy ---');
  console.log('Pass             | Total | Correct | Accuracy | Errors');
  console.log('-'.repeat(60));
  for (const passType of ['production', 'content-only', 'adversarial'] as PassType[]) {
    const p = summary.passes[passType];
    console.log(
      `${passType.padEnd(17)}| ${String(p.total).padEnd(6)}| ${String(p.correct).padEnd(8)}| ${(p.accuracy * 100).toFixed(1).padStart(6)}%  | ${p.errors}`,
    );
  }

  console.log('\n--- Per Doc Type Accuracy ---');
  console.log('Doc Type                  | Prod   | Content | Advers.');
  console.log('-'.repeat(60));
  const sortedTypes = Object.keys(perDocType).sort();
  for (const docType of sortedTypes) {
    const row = perDocType[docType];
    const prod = `${row['production'].correct}/${row['production'].total}`;
    const cont = `${row['content-only'].correct}/${row['content-only'].total}`;
    const adv = `${row['adversarial'].correct}/${row['adversarial'].total}`;
    console.log(
      `${docType.padEnd(26)}| ${prod.padEnd(7)}| ${cont.padEnd(8)}| ${adv}`,
    );
  }

  console.log(`\n--- Confidence Distribution ---`);
  console.log(`Correct predictions mean confidence:   ${report.confidenceDistribution.correctMean.toFixed(3)}`);
  console.log(`Incorrect predictions mean confidence:  ${report.confidenceDistribution.incorrectMean.toFixed(3)}`);

  if (misclassifications.length > 0) {
    console.log(`\n--- Misclassifications (${misclassifications.length}) ---`);
    for (const m of misclassifications) {
      console.log(`  [${m.pass}] ${m.filename}`);
      console.log(`    Expected: ${m.expected} → Got: ${m.actual} (conf: ${m.confidence.toFixed(2)})`);
      if (m.pass === 'adversarial') {
        console.log(`    Adversarial hint: "${m.filenameHint}"`);
      }
    }
  }

  if (skipped.length > 0) {
    console.log(`\n--- Skipped Files (${skipped.length}) ---`);
    for (const s of skipped) {
      console.log(`  ${s.name} — ${s.reason}`);
    }
  }

  // Write JSON report
  const reportPath = 'battle-test-results.json';
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to: ${reportPath}`);

  return report;
}

// ---------------------------------------------------------------------------
// Phase 4: Auto prompt tuning
// ---------------------------------------------------------------------------

async function autoTunePrompt(
  pass2Results: PassResult[],
  testFiles: TestFile[],
  pass1Results: PassResult[],
): Promise<void> {
  // Find doc types with <80% accuracy in content-only pass
  const byType = new Map<DocumentType, { total: number; correct: number }>();
  for (const r of pass2Results) {
    const entry = byType.get(r.groundTruth) ?? { total: 0, correct: 0 };
    entry.total++;
    if (r.correct) entry.correct++;
    byType.set(r.groundTruth, entry);
  }

  const weakTypes: DocumentType[] = [];
  for (const [docType, stats] of byType) {
    const accuracy = stats.total > 0 ? stats.correct / stats.total : 1;
    if (accuracy < 0.8 && stats.total >= 1) {
      weakTypes.push(docType);
    }
  }

  if (weakTypes.length === 0) {
    console.log('\n--- Auto Prompt Tuning ---');
    console.log('All doc types have >=80% content-only accuracy. No tuning needed.');
    return;
  }

  console.log('\n' + '='.repeat(70));
  console.log('  AUTO PROMPT TUNING');
  console.log('='.repeat(70));
  console.log(`\nWeak doc types (content-only <80%): ${weakTypes.join(', ')}`);

  // For each weak type, build a few-shot enhanced prompt and re-test
  const genAI = new GoogleGenerativeAI(classificationConfig.geminiApiKey);
  const responseSchema: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      documentType: { type: SchemaType.STRING },
      confidence: { type: SchemaType.NUMBER },
      borrowerFirstName: { type: SchemaType.STRING, nullable: true },
      borrowerLastName: { type: SchemaType.STRING, nullable: true },
      taxYear: { type: SchemaType.NUMBER, nullable: true },
      amount: { type: SchemaType.STRING, nullable: true },
      institution: { type: SchemaType.STRING, nullable: true },
      pageCount: { type: SchemaType.NUMBER },
      additionalNotes: { type: SchemaType.STRING, nullable: true },
    },
    required: ['documentType', 'confidence', 'pageCount'],
  };

  for (const weakType of weakTypes) {
    console.log(`\n--- Tuning: ${weakType} (${DOC_TYPE_LABELS[weakType]}) ---`);

    // Gather correctly-classified examples from pass 1 (production) for this type
    const correctExamples = pass1Results
      .filter(r => r.groundTruth === weakType && r.correct)
      .slice(0, 3);

    // Build few-shot prompt additions
    const exampleLines = correctExamples.map(ex => {
      const file = testFiles.find(f => f.fileId === ex.fileId);
      return `- A "${DOC_TYPE_LABELS[weakType]}" (${weakType}) document. Filename was: "${ex.filename}".`;
    });

    const fewShotAddition = exampleLines.length > 0
      ? `\n\nFew-shot examples for "${DOC_TYPE_LABELS[weakType]}" (${weakType}):\n${exampleLines.join('\n')}\nWhen you see documents similar to these examples, classify them as "${weakType}".`
      : '';

    const enhancedPrompt = buildBasePrompt() + fewShotAddition;

    // Find failing files for this type in pass 2
    const failingResults = pass2Results.filter(r => r.groundTruth === weakType && !r.correct);
    const failingFiles = failingResults
      .map(r => testFiles.find(f => f.fileId === r.fileId))
      .filter((f): f is TestFile => f !== undefined);

    if (failingFiles.length === 0) {
      console.log('  No failing files to re-test (errors only).');
      continue;
    }

    console.log(`  Re-testing ${failingFiles.length} failing file(s) with enhanced prompt...`);

    let improved = 0;
    for (const file of failingFiles) {
      try {
        const truncatedBuffer = await truncatePdf(file.pdfBuffer, classificationConfig.maxClassificationPages);

        const model = genAI.getGenerativeModel({
          model: classificationConfig.model,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema,
          },
        });

        const result = await model.generateContent([
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: truncatedBuffer.toString('base64'),
            },
          },
          { text: enhancedPrompt },
        ]);

        const raw = JSON.parse(result.response.text());
        const validated = ClassificationResultSchema.parse(raw);

        const correct = validated.documentType === file.groundTruth;
        const status = correct ? 'FIXED' : 'STILL WRONG';
        console.log(`    ${file.name.slice(0, 45)} → ${status} (${validated.documentType}, conf: ${validated.confidence.toFixed(2)})`);
        if (correct) improved++;

        await sleep(1000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    ${file.name.slice(0, 45)} → ERROR: ${msg.slice(0, 60)}`);
      }
    }

    const beforeAcc = failingFiles.length > 0
      ? `0/${failingFiles.length}`
      : 'N/A';
    const afterAcc = `${improved}/${failingFiles.length}`;
    console.log(`\n  Before: ${beforeAcc} correct → After: ${afterAcc} correct`);

    if (improved > 0) {
      console.log(`\n  SUGGESTED PROMPT ADDITION for classifier.ts:`);
      console.log('  ' + '-'.repeat(50));
      console.log(fewShotAddition.split('\n').map(l => '  ' + l).join('\n'));
      console.log('  ' + '-'.repeat(50));
    }
  }
}

function buildBasePrompt(): string {
  const docTypes = DOCUMENT_TYPES.join(', ');
  return `Classify this Canadian mortgage document. Identify the document type, who it belongs to, and extract key metadata.

Known document types: ${docTypes}

Instructions:
- Set documentType to the most specific match from the list above.
- Set confidence between 0.0 and 1.0. If you are uncertain, set it below 0.7.
- Extract the borrower's first and last name if visible on the document.
- Extract the tax year if this is a tax document (T4, T1, NOA, T5, etc.).
- Extract the dollar amount if clearly visible (use Cat's format: "$16k", "$5.2k", "$585").
- Extract the institution/employer name if visible.
- Set pageCount to the number of pages in the document.
- Use additionalNotes for any other relevant context.
- If the document does not match any specific type, use "other".

Classification guidance for commonly confused types:
- photo_id vs passport: If the document is any form of government-issued photo ID used for identity verification in a mortgage application (driver's license, passport, health card, PR card), classify it as "photo_id". Only use "passport" for full passport booklet pages showing travel stamps or visa information, not a passport used as ID.
- loe vs employment_contract: A Letter of Employment (LOE) is a brief letter from an employer confirming current employment status, position, salary, and start date. Classify these as "loe". Only use "employment_contract" for formal multi-page contracts with terms, clauses, termination conditions, and signatures.
- rrsp_statement vs bank_statement: If the account is labelled RRSP, RSP, or Registered Retirement Savings Plan, classify as "rrsp_statement" even if it looks like a bank statement. Similarly, TFSA accounts are "tfsa_statement" and FHSA accounts are "fhsa_statement".`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(70));
  console.log('  CLASSIFIER BATTLE TEST');
  console.log('='.repeat(70));
  console.log(`\nModel: ${classificationConfig.model}`);
  console.log(`Max pages: ${classificationConfig.maxClassificationPages}`);
  console.log(`Confidence threshold: ${classificationConfig.confidenceThreshold}`);

  // Phase 1: Discover
  const drive = getDriveClient();
  const { testFiles, skipped } = await discoverTestFiles(drive);

  if (testFiles.length === 0) {
    console.error('\nNo testable PDF files found. Nothing to test.');
    process.exit(1);
  }

  console.log(`\n--- Discovery complete ---`);
  console.log(`Testable: ${testFiles.length} PDFs`);
  console.log(`Skipped: ${skipped.length} files`);

  // Ground truth distribution
  const gtCounts = new Map<DocumentType, number>();
  for (const f of testFiles) {
    gtCounts.set(f.groundTruth, (gtCounts.get(f.groundTruth) ?? 0) + 1);
  }
  console.log('\nGround truth distribution:');
  for (const [dt, count] of [...gtCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${dt.padEnd(28)} ${count}`);
  }

  // Phase 2: Three passes
  const pass1 = await runPass(testFiles, 'production');
  const pass2 = await runPass(testFiles, 'content-only');
  const pass3 = await runPass(testFiles, 'adversarial');

  // Phase 3: Report
  const report = generateReport(pass1, pass2, pass3, skipped);

  // Phase 4: Auto prompt tuning (if needed)
  await autoTunePrompt(pass2, testFiles, pass1);

  // Final summary
  const p1Acc = report.summary.passes['production'].accuracy;
  const p2Acc = report.summary.passes['content-only'].accuracy;
  const p3Acc = report.summary.passes['adversarial'].accuracy;

  console.log('\n' + '='.repeat(70));
  console.log('  FINAL SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Production:   ${(p1Acc * 100).toFixed(1)}%`);
  console.log(`  Content-only: ${(p2Acc * 100).toFixed(1)}%`);
  console.log(`  Adversarial:  ${(p3Acc * 100).toFixed(1)}%`);

  if (p1Acc >= 0.9) {
    console.log('\n  Production accuracy >= 90%. Classifier is ready.');
  } else {
    console.log('\n  Production accuracy < 90%. Review misclassifications before go-live.');
  }

  console.log();
}

main().catch(err => {
  console.error('\nBattle test FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
