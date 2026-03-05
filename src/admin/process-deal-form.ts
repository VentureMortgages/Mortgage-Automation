/**
 * Admin "Process Deal" Form
 *
 * Serves a simple HTML page where Cat can paste a Finmo application URL
 * (or raw application ID) and trigger the full pipeline for cloned deals
 * that don't fire a webhook.
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
    .container { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 2rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    .subtitle { color: #666; font-size: 0.875rem; margin-bottom: 1.5rem; }
    label { display: block; font-weight: 600; margin-bottom: 0.5rem; font-size: 0.875rem; }
    input[type="text"] { width: 100%; padding: 0.625rem 0.75rem; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }
    input[type="text"]:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
    button { margin-top: 1rem; width: 100%; padding: 0.75rem; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #93c5fd; cursor: not-allowed; }
    .result { margin-top: 1rem; padding: 0.75rem; border-radius: 6px; font-size: 0.875rem; display: none; }
    .result.success { display: block; background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
    .result.error { display: block; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    .hint { color: #999; font-size: 0.75rem; margin-top: 0.375rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Process Deal</h1>
    <p class="subtitle">Trigger the full pipeline for a cloned Finmo deal</p>
    <form id="form">
      <label for="input">Finmo Application URL or ID</label>
      <input type="text" id="input" placeholder="https://finmo.ca/app/... or paste the UUID" required autocomplete="off" />
      <p class="hint">Paste the full Finmo URL or just the application UUID</p>
      <button type="submit" id="btn">Process</button>
    </form>
    <div id="result" class="result"></div>
  </div>
  <script>
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const form = document.getElementById('form');
    const input = document.getElementById('input');
    const btn = document.getElementById('btn');
    const result = document.getElementById('result');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = input.value.trim();
      if (!raw) return;

      const match = raw.match(UUID_RE);
      if (!match) {
        result.className = 'result error';
        result.textContent = 'Could not find a valid application ID (UUID). Check your input.';
        return;
      }

      const applicationId = match[0];
      btn.disabled = true;
      btn.textContent = 'Processing...';
      result.className = 'result';
      result.style.display = 'none';

      try {
        const res = await fetch('/admin/reprocess-application', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicationId }),
        });
        const data = await res.json();
        if (res.ok) {
          result.className = 'result success';
          result.textContent = 'Queued! Job ID: ' + (data.jobId || applicationId);
        } else {
          result.className = 'result error';
          result.textContent = 'Error: ' + (data.error || res.statusText);
        }
      } catch (err) {
        result.className = 'result error';
        result.textContent = 'Network error: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Process';
      }
    });
  </script>
</body>
</html>`;

export function processDealFormHandler(_req: Request, res: Response): void {
  res.type('html').send(HTML);
}
