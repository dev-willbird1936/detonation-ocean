// The "Drop a file" panel on the main menu: drag-and-drop or picker, consent, then POST /api/jobs (SPEC 4.2).
// On 202 the ocean show (ui/job/ocean-show.mjs) plays the job out in the ocean; every other answer is shown as text under the button.
(() => {
  'use strict';
  const form = document.getElementById('upload');
  if (!form) return;
  const input = form.querySelector('.drop-file');
  const consent = form.querySelector('#drop-consent');
  const chosen = form.querySelector('.drop-name');
  const message = form.querySelector('.drop-msg');
  const go = form.querySelector('.drop-go');

  const MAX_BYTES = 100 * 1024 * 1024;
  const REFUSED = {
    400: 'The upload was not accepted. Choose one file and tick the consent box.',
    413: 'That file is over the 100 MB limit.',
    429: 'Too many uploads from your connection. Wait a few minutes and try again.',
    503: 'The sandbox is not accepting files right now. Try again in a few minutes.',
  };

  const say = (text, bad = true) => {
    message.textContent = text;
    message.classList.toggle('bad', bad);
  };
  const size = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
  const show = () => {
    const file = input.files[0];
    chosen.textContent = file ? `${file.name} · ${size(file.size)}` : 'No file chosen';
    say('', false);
  };
  input.addEventListener('change', show);

  // Drag and drop on the panel. A stray drop elsewhere must not navigate the page to the file.
  for (const type of ['dragenter', 'dragover']) form.addEventListener(type, (event) => { event.preventDefault(); form.classList.add('over'); });
  form.addEventListener('dragleave', (event) => { if (!form.contains(event.relatedTarget)) form.classList.remove('over'); });
  form.addEventListener('drop', (event) => {
    event.preventDefault();
    form.classList.remove('over');
    const dropped = event.dataTransfer?.files;
    if (!dropped?.length) return;
    if (dropped.length > 1) { say('Drop one file at a time.'); return; }
    input.files = dropped;
    show();
  });
  for (const type of ['dragover', 'drop']) window.addEventListener(type, (event) => event.preventDefault());

  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const file = input.files[0];
    if (!file) { say('Choose a file first.'); return; }
    if (!consent.checked) { say('Tick the box to confirm you may analyse this file.'); return; }
    if (file.size > MAX_BYTES) { say(REFUSED[413]); return; }
    busy = true;
    go.textContent = 'Uploading…';
    form.setAttribute('aria-busy', 'true');
    say('Uploading. Keep this page open.', false);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('consent', 'true');
      const response = await fetch('/api/jobs', { method: 'POST', body, credentials: 'same-origin' });
      if (response.status === 202) {
        const { jobId, token } = await response.json();
        if (typeof jobId === 'string' && /^[\w-]+$/.test(jobId) && typeof token === 'string' && token) {
          const jobUrl = `/job/${jobId}#${token}`;
          try {
            // The ocean show plays the job out in this ocean; the job page is the fallback and the full report.
            const { openOceanShow } = await import('/ui/job/ocean-show.mjs');
            let storage = null;
            try { storage = window.localStorage; } catch { /* storage blocked: fish names last for this visit */ }
            await openOceanShow({ jobId, token, fileName: file.name, storage, onFail: () => location.assign(jobUrl), onClose: () => { reset(); say('', false); } });
          } catch {
            location.assign(jobUrl);
          }
          return;
        }
        say('The server answered in a form this page does not understand.');
      } else {
        say(REFUSED[response.status] ?? `The upload failed (status ${response.status}). Try again.`);
      }
    } catch {
      say('The upload failed. Check your connection and try again.');
    }
    reset();
  });

  function reset() {
    busy = false;
    go.textContent = 'Upload';
    form.removeAttribute('aria-busy');
  }

  // Nav "Upload": back to the surface, then into the panel.
  for (const link of document.querySelectorAll('a[href="#upload"]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (window.__lenis) window.__lenis.scrollTo(0, { immediate: true });
      else window.scrollTo(0, 0);
      input.focus({ preventScroll: true });
    });
  }
})();
