// Playwright harness report (deploy/detonation/runner/browser.mjs) to EVIDENCE.md `browser` items (docs/SPEC.md 6.4 "Browser").
// Pure. The page and its scripts are untrusted, so every string is cut and every shape checked here.

const URL_CHARS = 500;
const BODY_CHARS = 1_024;
const TEXT = 300;
const MAX_ITEMS = 60;
const text = (value, size = TEXT) => String(value ?? '').slice(0, size);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => (Array.isArray(value) ? value.filter(isObject).slice(0, MAX_ITEMS) : []);
const item = (kind, at, detail, fields) => ({ source: 'browser', kind, detail, at, ...fields });

/**
 * Items for one harness run, in this order: blocked requests, downloads, dialogs, form submissions, indicators, stop reason.
 * A `form-submit` is kept only when the typed credential left the page in a recorded request (`captured`), so a password form that
 * posts nowhere is not a `fake-login`; such a page gets a `phishing-indicator` instead (harm unproven).
 * `sampleUrl` is the file:// URL of the sample: the download of the sample itself (a PDF the shell cannot show) is not a download.
 */
export function mapBrowser(report, { at, sampleUrl }) {
  const browser = isObject(report) ? report : {};
  const forms = list(browser.forms);
  const captured = forms.filter(form => form.captured === true);
  const items = [
    ...list(browser.requests).map(request => item('request-blocked', at, `A ${text(request.method, 10)} request to ${text(request.url, 120)} was blocked.`, { url: text(request.url, URL_CHARS), body: text(request.body, BODY_CHARS) })),
    ...list(browser.downloads).filter(download => download.url !== sampleUrl).map(download => item('download', at, 'The page started a download.', { url: text(download.url, URL_CHARS), filename: text(download.filename, 120) })),
    ...list(browser.dialogs).map(dialog => item('dialog', at, `The page opened a ${text(dialog.type, 20)} dialog.`, { dialogType: text(dialog.type, 20), message: text(dialog.message) })),
    ...captured.map(form => item('form-submit', at, 'A form carrying the typed credential was submitted (blocked).', {
      url: text(form.url, URL_CHARS), fields: isObject(form.fields) ? Object.fromEntries(Object.entries(form.fields).slice(0, 20).map(([name, value]) => [text(name, 60), text(value, 120)])) : {}, typedCredential: form.typedCredential === true,
    })),
  ];
  if (browser.hasPasswordField === true && captured.length === 0) {
    items.push(item('phishing-indicator', at, 'The page has a password field; the typed credential was not sent anywhere.', { indicator: 'password field' }));
  }
  if (Number(browser.popups) > 0) items.push(item('suspicious', at, 'The page opened extra windows.', { indicator: 'popup windows' }));
  if (browser.error) {
    const timeout = /timeout/i.test(String(browser.error));
    items.push(item('emulation-stopped', at, timeout ? 'The browser run hit its time limit.' : 'The browser could not load the page.', { reason: timeout ? 'browser-timeout' : 'browser-failed' }));
  }
  return items;
}
