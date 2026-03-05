/**
 * Admin "Process Deal" Form — Phase 23 Rewrite
 *
 * Serves a polished HTML page where Cat can paste a Finmo application URL,
 * raw UUID, or BRXM deal ID (e.g., "BRXM-F051356") and trigger the full
 * pipeline with real-time progress feedback.
 *
 * Features:
 * - Input type auto-detection (URL / UUID / BRXM ID)
 * - Animated step-by-step progress via polling
 * - Error handling with retry
 * - Summary with links on completion
 */

import type { Request, Response } from 'express';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Process Deal — Venture Mortgages</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 2rem 1rem; }
    .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 2rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    .subtitle { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    label { display: block; font-weight: 600; margin-bottom: 0.5rem; font-size: 0.875rem; }
    input[type="text"] { width: 100%; padding: 0.625rem 0.75rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 1rem; transition: border-color 0.15s, box-shadow 0.15s; }
    input[type="text"]:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
    .input-group { position: relative; }
    .detected-badge { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; font-weight: 600; display: none; }
    .detected-badge.url { background: #dbeafe; color: #1d4ed8; display: inline-block; }
    .detected-badge.uuid { background: #e0e7ff; color: #4338ca; display: inline-block; }
    .detected-badge.brxm { background: #fef3c7; color: #92400e; display: inline-block; }
    button { margin-top: 1rem; width: 100%; padding: 0.75rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.15s; }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #93c5fd; cursor: not-allowed; }
    .hint { color: #9ca3af; font-size: 0.75rem; margin-top: 0.375rem; }

    /* Progress */
    .progress-section { margin-top: 1.5rem; display: none; }
    .progress-section.visible { display: block; }
    .progress-bar-container { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; margin-bottom: 1rem; }
    .progress-bar { height: 100%; background: #2563eb; border-radius: 3px; transition: width 0.5s ease; width: 0%; }
    .progress-bar.error { background: #ef4444; }
    .progress-bar.complete { background: #16a34a; }
    .steps { list-style: none; padding: 0; }
    .steps li { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0; font-size: 0.875rem; color: #9ca3af; transition: color 0.2s; }
    .steps li.done { color: #16a34a; }
    .steps li.active { color: #2563eb; font-weight: 500; }
    .steps li.error { color: #ef4444; }
    .step-icon { width: 18px; text-align: center; flex-shrink: 0; }
    .step-detail { font-size: 0.75rem; color: #9ca3af; margin-left: 1.75rem; }

    /* Spinner */
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #93c5fd; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.6s linear infinite; }

    /* Result */
    .result-box { margin-top: 1rem; padding: 1rem; border-radius: 8px; font-size: 0.875rem; display: none; }
    .result-box.success { display: block; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .result-box.error { display: block; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .result-box a { color: inherit; font-weight: 600; }

    /* Confirmation dialog */
    .confirm-box { margin-top: 1rem; padding: 1rem; border-radius: 8px; background: #fffbeb; border: 1px solid #fde68a; font-size: 0.875rem; color: #92400e; display: none; }
    .confirm-box.visible { display: block; }
    .confirm-box strong { display: block; margin-bottom: 0.375rem; }
    .confirm-actions { margin-top: 0.75rem; display: flex; gap: 0.5rem; }
    .confirm-actions button { flex: 1; padding: 0.5rem; border-radius: 6px; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
    .btn-reprocess { background: #f59e0b; color: #fff; border: none; }
    .btn-reprocess:hover { background: #d97706; }
    .btn-cancel { background: #fff; color: #666; border: 1px solid #d1d5db; }
    .btn-cancel:hover { background: #f3f4f6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Process Deal</h1>
    <p class="subtitle">Trigger the full pipeline for a Finmo deal</p>
    <form id="form">
      <label for="input">Finmo URL, Application ID, or Deal ID</label>
      <div class="input-group">
        <input type="text" id="input" placeholder="https://finmo.ca/app/... or BRXM-F051356 or UUID" required autocomplete="off" />
        <span id="badge" class="detected-badge"></span>
      </div>
      <p class="hint">Paste a Finmo URL, application UUID, or BRXM deal ID</p>
      <button type="submit" id="btn">Process</button>
    </form>

    <div id="progress-section" class="progress-section">
      <div class="progress-bar-container">
        <div id="progress-bar" class="progress-bar"></div>
      </div>
      <ul id="steps" class="steps">
        <li id="step-finmo_fetched"><span class="step-icon">&#9675;</span> Fetching application from Finmo...</li>
        <li id="step-checklist_generated"><span class="step-icon">&#9675;</span> Generating document checklist</li>
        <li id="step-drive_folder_ready"><span class="step-icon">&#9675;</span> Creating Drive folder</li>
        <li id="step-drive_scanned"><span class="step-icon">&#9675;</span> Scanning for existing documents</li>
        <li id="step-crm_synced"><span class="step-icon">&#9675;</span> Syncing to CRM</li>
        <li id="step-email_drafted"><span class="step-icon">&#9675;</span> Creating email draft</li>
        <li id="step-complete"><span class="step-icon">&#9675;</span> Budget sheet &amp; finalize</li>
      </ul>
    </div>

    <div id="confirm" class="confirm-box">
      <strong>This deal was already processed</strong>
      <span id="confirm-detail"></span>
      <p style="margin-top:0.375rem">Reprocessing will create duplicate email drafts and budget sheets.</p>
      <div class="confirm-actions">
        <button class="btn-reprocess" id="btn-reprocess">Reprocess Anyway</button>
        <button class="btn-cancel" id="btn-cancel">Cancel</button>
      </div>
    </div>
    <div id="result" class="result-box"></div>
  </div>

  <script>
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const BRXM_RE = /^BRXM-[A-Z]\\d{5,}$/i;

    const form = document.getElementById('form');
    const inputEl = document.getElementById('input');
    const btn = document.getElementById('btn');
    const badge = document.getElementById('badge');
    const progressSection = document.getElementById('progress-section');
    const progressBar = document.getElementById('progress-bar');
    const resultBox = document.getElementById('result');

    const STEP_ORDER = ['finmo_fetched', 'checklist_generated', 'drive_folder_ready', 'drive_scanned', 'crm_synced', 'email_drafted', 'complete'];

    // Input type detection (live)
    inputEl.addEventListener('input', () => {
      const val = inputEl.value.trim();
      badge.className = 'detected-badge';
      badge.textContent = '';

      if (!val) return;
      if (val.includes('finmo.ca') || val.startsWith('http')) {
        if (UUID_RE.test(val)) { badge.className = 'detected-badge url'; badge.textContent = 'Finmo URL'; }
      } else if (BRXM_RE.test(val)) {
        badge.className = 'detected-badge brxm'; badge.textContent = 'Deal ID';
      } else if (UUID_RE.test(val)) {
        badge.className = 'detected-badge uuid'; badge.textContent = 'UUID';
      }
    });

    let pollTimer = null;

    function resetUI() {
      progressSection.classList.remove('visible');
      progressBar.className = 'progress-bar';
      progressBar.style.width = '0%';
      resultBox.className = 'result-box';
      resultBox.innerHTML = '';
      STEP_ORDER.forEach(s => {
        const li = document.getElementById('step-' + s);
        if (li) { li.className = ''; li.querySelector('.step-icon').innerHTML = '&#9675;'; }
        const detail = li?.nextElementSibling;
        if (detail?.classList.contains('step-detail')) detail.remove();
      });
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function updateSteps(progress) {
      if (!progress || !progress.step) return;
      const currentIdx = STEP_ORDER.indexOf(progress.step);
      if (currentIdx === -1) return;

      STEP_ORDER.forEach((s, i) => {
        const li = document.getElementById('step-' + s);
        if (!li) return;
        const icon = li.querySelector('.step-icon');
        if (i < currentIdx) {
          li.className = 'done';
          icon.innerHTML = '&#10003;';
        } else if (i === currentIdx) {
          li.className = 'done';
          icon.innerHTML = '&#10003;';
          // Add detail if present
          if (progress.detail) {
            let detailEl = li.nextElementSibling;
            if (!detailEl || !detailEl.classList.contains('step-detail')) {
              detailEl = document.createElement('div');
              detailEl.className = 'step-detail';
              li.after(detailEl);
            }
            detailEl.textContent = progress.detail;
          }
        } else if (i === currentIdx + 1 && progress.step !== 'complete') {
          li.className = 'active';
          icon.innerHTML = '<span class="spinner"></span>';
        } else {
          li.className = '';
          icon.innerHTML = '&#9675;';
        }
      });

      progressBar.style.width = (progress.pct || 0) + '%';
    }

    function showError(msg) {
      progressBar.className = 'progress-bar error';
      resultBox.className = 'result-box error';
      resultBox.textContent = msg;
      btn.disabled = false;
      btn.textContent = 'Retry';
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function showSuccess(result) {
      progressBar.className = 'progress-bar complete';
      resultBox.className = 'result-box success';

      let html = '<strong>Pipeline complete!</strong><br>';
      if (result) {
        if (result.applicationId) html += 'Application: ' + result.applicationId + '<br>';
        if (result.contactId) html += 'CRM Contact: ' + result.contactId + '<br>';
        if (result.draftId) html += 'Email draft created<br>';
        if (result.budgetSheetId) html += 'Budget sheet created<br>';
        if (result.warnings?.length) html += '<br>Warnings: ' + result.warnings.join(', ');
      }
      resultBox.innerHTML = html;
      btn.disabled = false;
      btn.textContent = 'Process Another';
    }

    async function pollJobStatus(jobId) {
      try {
        const res = await fetch('/admin/job-status/' + encodeURIComponent(jobId));
        if (!res.ok) { showError('Failed to check job status'); return; }
        const data = await res.json();

        if (data.progress) updateSteps(data.progress);

        if (data.state === 'completed') {
          clearInterval(pollTimer); pollTimer = null;
          // Ensure final progress shows 100%
          updateSteps({ step: 'complete', label: 'Complete!', pct: 100 });
          showSuccess(data.result);
        } else if (data.state === 'failed') {
          clearInterval(pollTimer); pollTimer = null;
          showError('Job failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        // Network error during poll — don't stop, may recover
        console.error('Poll error:', err);
      }
    }

    const confirmBox = document.getElementById('confirm');
    const confirmDetail = document.getElementById('confirm-detail');
    const btnReprocess = document.getElementById('btn-reprocess');
    const btnCancel = document.getElementById('btn-cancel');

    async function submitDeal(force) {
      const raw = inputEl.value.trim();
      if (!raw) return;

      resetUI();
      confirmBox.classList.remove('visible');
      btn.disabled = true;
      btn.textContent = 'Submitting...';
      progressSection.classList.add('visible');

      try {
        const res = await fetch('/admin/process-deal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: raw, force: !!force }),
        });
        const data = await res.json();

        // Already processed — show confirmation
        if (res.status === 409 && data.alreadyProcessed) {
          progressSection.classList.remove('visible');
          btn.disabled = false;
          btn.textContent = 'Process';
          const when = data.completedAt ? ' on ' + new Date(data.completedAt).toLocaleString() : '';
          confirmDetail.textContent = 'Completed' + when + '.';
          confirmBox.classList.add('visible');
          return;
        }

        if (!res.ok) {
          showError(data.error || 'Request failed: ' + res.statusText);
          return;
        }

        btn.textContent = 'Processing...';
        pollTimer = setInterval(() => pollJobStatus(data.jobId), 2000);
        pollJobStatus(data.jobId);
      } catch (err) {
        showError('Network error: ' + err.message);
      }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); submitDeal(false); });
    btnReprocess.addEventListener('click', () => submitDeal(true));
    btnCancel.addEventListener('click', () => { confirmBox.classList.remove('visible'); });
  </script>
</body>
</html>`;

export function processDealFormHandler(_req: Request, res: Response): void {
  res.type('html').send(HTML);
}
