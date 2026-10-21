// Static tool reports to EVIDENCE.md `static` items (docs/SPEC.md 6.4 "Static", 6.6 "Static"). Pure: the runner (deploy/detonation/runner:
// pdf_static.py, ps1_static.py, office.py) prints raw tool facts, this maps them. Static items only add Twilight signals (EVIDENCE.md).
// Everything read here came out of the sandbox, so shapes are checked and strings are cut before they reach an item.

const TEXT = 200;
const MAX_PER_KIND = 10;
const text = (value, size = TEXT) => String(value ?? '').slice(0, size);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const item = (kind, at, detail, fields) => ({ source: 'static', kind, detail, at, ...fields });
const capped = list => list.slice(0, MAX_PER_KIND);

// pdfid names that make a PDF an exploit candidate when the count is above zero.
const PDF_EXPLOIT_NAMES = ['/JS', '/JavaScript', '/OpenAction', '/AA', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA'];

/** `pdf_static.py` output: one `exploit-indicator` per pdfid name found. A pdfid failure is an `emulation-stopped` item (the check did not run). */
export function mapPdf(report, { at }) {
  const counts = isObject(report?.pdfid) ? report.pdfid : {};
  const found = PDF_EXPLOIT_NAMES.filter(name => Number(counts[name]) > 0);
  const items = found.map(name => item('exploit-indicator', at, `pdfid found ${name} ${Number(counts[name])} time(s)`, { indicator: `pdf ${name}`, tool: 'pdfid' }));
  if (Object.keys(counts).length === 0) items.push(item('emulation-stopped', at, 'pdfid produced no counts.', { reason: 'pdfid-failed' }));
  else if (Array.isArray(report?.errors) && report.errors.length > 0) items.push(item('emulation-stopped', at, 'A PDF static tool returned an error.', { reason: 'pdf-static-failed' }));
  return items;
}

// Hits of ps1_static.py by pattern id. `encoded-command` and `base64-decode` hide a payload; the two flags hide the process.
const PS1_OBFUSCATION = { 'base64-decode': 'base64 decoding', 'encoded-command': 'encoded command', 'char-join': 'character-code string building' };
const PS1_HIDDEN = { 'hidden-window': 'hidden window', 'execution-policy-bypass': 'execution policy bypass' };

/** `ps1_static.py` output (`{hits: [{id, count, preview}], truncated?}`). A truncated prefix is incomplete coverage. */
export function mapPs1(report, { at }) {
  if (!isObject(report) || !Array.isArray(report.hits)) {
    return [item('emulation-stopped', at, 'PowerShell static scanner did not return a valid report.', { reason: 'ps1-static-failed' })];
  }
  const hits = report.hits.filter(hit => isObject(hit) && typeof hit.id === 'string');
  const items = hits.flatMap(({ id, preview }) => {
    if (Object.hasOwn(PS1_OBFUSCATION, id)) return [item('obfuscation', at, `PowerShell uses ${PS1_OBFUSCATION[id]}.`, { technique: PS1_OBFUSCATION[id] })];
    if (Object.hasOwn(PS1_HIDDEN, id)) return [item('hidden-command', at, `PowerShell uses a ${PS1_HIDDEN[id]} flag.`, { tool: 'powershell', commandPreview: text(preview) })];
    if (id === 'download-cradle') return [item('suspicious', at, 'The script downloads from the network.', { indicator: 'powershell download cradle' })];
    return [];
  });
  if (report.truncated === true) items.push(item('emulation-stopped', at, 'The PowerShell static scan reached its byte limit; prefix indicators are incomplete.', { reason: 'ps1-static-truncated' }));
  return items;
}

const OLEVBA_OBFUSCATION = new Set(['Hex Strings', 'Base64 Strings', 'Dridex Strings', 'VBA obfuscated Strings', 'VBA Stomping']);

/**
 * `office.py` output: olevba's analysis table (`type`, `keyword`) and the LibreOffice result. An auto-exec macro is an
 * `exploit-indicator`; suspicious keywords and IOCs are `suspicious`; encoded strings are `obfuscation`. A document that
 * LibreOffice did not open, or that olevba could not read, is `emulation-stopped` (the run did not complete).
 */
export function mapOffice(report, { at }) {
  const olevba = isObject(report?.olevba) ? report.olevba : {};
  const rows = Array.isArray(olevba.analysis) ? olevba.analysis.filter(isObject) : [];
  const byType = type => rows.filter(row => row.type === type);
  const items = [
    ...capped(byType('AutoExec')).map(row => item('exploit-indicator', at, `olevba found an auto-exec macro trigger: ${text(row.keyword)}.`, { indicator: `vba auto-exec ${text(row.keyword, 60)}`, tool: 'olevba' })),
    ...capped([...byType('Suspicious'), ...byType('IOC')]).map(row => item('suspicious', at, `olevba flagged ${text(row.type)}: ${text(row.keyword)}.`, { indicator: `vba ${text(row.keyword, 60)}`, tool: 'olevba' })),
    ...capped(rows.filter(row => OLEVBA_OBFUSCATION.has(row.type))).map(row => item('obfuscation', at, `olevba found ${text(row.type)}.`, { technique: text(row.type, 60) })),
  ];
  if (olevba.ok !== true) items.push(item('emulation-stopped', at, 'olevba could not read the document.', { reason: 'olevba-failed' }));
  const office = isObject(report?.libreoffice) ? report.libreoffice : {};
  if (office.opened !== true) {
    items.push(item('emulation-stopped', at, office.timedOut ? 'LibreOffice did not finish opening the document in time.' : 'LibreOffice could not open the document.', { reason: office.timedOut ? 'libreoffice-timeout' : 'libreoffice-failed' }));
  }
  return items;
}

// --- M4b: capa, YARA and the generic last resort (docs/SPEC.md 6.6 "Static", "Generic") ----------------------------------------------

const CAPA_NAME = 80;
const MAX_CAPA_ITEMS = 12;
const MAX_YARA_ITEMS = 10;
// capa rule namespaces that say something on their own. A rule elsewhere counts only when it maps to an ATT&CK technique; "parse PE header"
// and "contain loop" are what almost every program does.
const CAPA_ANTI_ANALYSIS = /^anti-analysis\/(?!packer)/;
const CAPA_PACKER = /^anti-analysis\/packer/;
const CAPA_SURVEY = /^host-interaction\/(?:os\/info|hardware|network\/adapter)/;
const CAPA_ADMIN = /^host-interaction\/uac/;
const CAPA_ALWAYS = /^(?:persistence|impact|c2|collection|communication\/http\/server)(?:\/|$)/;
const CAPA_QUIET = /^(?:load-code\/pe|executable|linking|runtime|compiler)(?:\/|$)/;

/**
 * `static.py` capa report (`{ok, rules: [{name, namespace, attack: [id], count}]}`). Twilight signals only (EVIDENCE.md): packer rules give
 * `obfuscation`, anti-analysis rules `anti-analysis`, survey rules `system-survey`, UAC rules `admin-request`; persistence, impact, c2 and
 * collection rules, and any other rule with an ATT&CK technique, are `suspicious`. capa failing or timing out is `emulation-stopped`.
 */
export function mapCapa(capa, { at }) {
  if (!isObject(capa)) return [];
  if (capa.ok !== true) return [item('emulation-stopped', at, 'capa could not analyse the file.', { reason: 'capa-failed' })];
  const items = [];
  for (const rule of (Array.isArray(capa.rules) ? capa.rules.filter(isObject) : [])) {
    const name = text(rule.name, CAPA_NAME);
    const namespace = text(rule.namespace, 120);
    const attack = (Array.isArray(rule.attack) ? rule.attack : []).map(id => text(id, 16));
    const tool = 'capa';
    if (CAPA_PACKER.test(namespace)) items.push(item('obfuscation', at, `capa matched "${name}".`, { technique: `capa: ${name}`, tool }));
    else if (CAPA_ANTI_ANALYSIS.test(namespace)) items.push(item('anti-analysis', at, `capa matched "${name}".`, { technique: `capa: ${name}`, tool }));
    else if (CAPA_ADMIN.test(namespace)) items.push(item('admin-request', at, `capa matched "${name}".`, { indicator: `capa: ${name}`, tool }));
    else if (CAPA_SURVEY.test(namespace)) items.push(item('system-survey', at, `capa matched "${name}".`, { indicator: `capa: ${name}`, tool }));
    else if (!CAPA_QUIET.test(namespace) && (CAPA_ALWAYS.test(namespace) || attack.length > 0)) {
      items.push(item('suspicious', at, `capa matched "${name}"${attack.length ? ` (${attack.slice(0, 3).join(', ')})` : ''}.`, { indicator: `capa: ${name}`, tool }));
    }
  }
  return items.slice(0, MAX_CAPA_ITEMS);
}

const YARA_EXPLOIT = /exploit|cve[-_]\d{4}/i;
const YARA_PACKER = /pack|upx|obfus|crypt(?:er|or)/i;

/**
 * `static.py` YARA report (`{ok, matches: [{rule, tags, author, description, reference}]}`) from signature-base. A rule that names an exploit is
 * `exploit-indicator`, one that names a packer or obfuscator `obfuscation`; every other match is `suspicious`. A match is never a finding on its own.
 */
export function mapYara(yara, { at }) {
  if (!isObject(yara)) return [];
  if (yara.ok !== true) return [item('emulation-stopped', at, 'The YARA rules could not be loaded.', { reason: 'yara-failed' })];
  return (Array.isArray(yara.matches) ? yara.matches.filter(isObject) : []).slice(0, MAX_YARA_ITEMS).map(match => {
    const rule = text(match.rule, 80);
    const named = `${rule} ${(Array.isArray(match.tags) ? match.tags : []).join(' ')}`;
    const detail = `YARA rule ${rule}${match.author ? ` by ${text(match.author, 60)}` : ''} matched.`;
    if (YARA_EXPLOIT.test(named)) return item('exploit-indicator', at, detail, { indicator: `yara ${rule}`, tool: 'yara' });
    if (YARA_PACKER.test(named)) return item('obfuscation', at, detail, { technique: `yara ${rule}`, tool: 'yara' });
    return item('suspicious', at, detail, { indicator: `yara ${rule}`, tool: 'yara' });
  });
}

/** The `static` runner kind's `{format, capa, yara}`: evidence and a one-line coverage detail. */
export function mapStatic(report, { at }) {
  const data = isObject(report) ? report : {};
  const capa = mapCapa(data.capa, { at });
  const yaraValid = isObject(data.yara);
  const yara = mapYara(yaraValid ? data.yara : { ok: false }, { at });
  const rules = Number(data.capa?.ruleCount) || 0;
  const matches = Number(data.yara?.matchCount) || 0;
  const failed = [data.capa && data.capa.ok !== true ? 'capa' : '', !yaraValid || data.yara.ok !== true ? 'YARA' : ''].filter(Boolean);
  const detail = `${data.capa ? `capa matched ${rules} rule(s); ` : ''}YARA matched ${matches} rule(s)${failed.length ? `; ${failed.join(' and ')} could not finish` : ''}.`;
  return { evidence: [...capa, ...yara], status: failed.length === (data.capa ? 2 : 1) ? 'failed' : failed.length ? 'stopped' : 'done', detail };
}

const RUN_KEY_TEXT = /CurrentVersion\\Run/i;
const SHELL_TOOL_TEXT = /\b(?:powershell|cmd\.exe|wscript|cscript|mshta|rundll32|regsvr32|schtasks|certutil|bitsadmin)\b/i;
const HIGH_ENTROPY = 7.6;

/**
 * `generic.py` report: strings, entropy, binwalk and YARA. Twilight signals only: a file that is near-random throughout is `obfuscation`;
 * an embedded executable or archive, a Run key and shell-tool names in the text are `suspicious`.
 */
export function mapGeneric(report, { at }) {
  const data = isObject(report) ? report : {};
  const binwalkFailed = !isObject(data.binwalk) || data.binwalk.ok !== true;
  const items = [];
  if (Number(data.entropy?.overall) >= HIGH_ENTROPY && Number(data.entropy?.mean) >= HIGH_ENTROPY - 0.4) {
    items.push(item('obfuscation', at, `The content is near-random (entropy ${Number(data.entropy.overall)}).`, { technique: 'high-entropy content' }));
  }
  if (Number(data.binwalk?.executables) > 0) items.push(item('suspicious', at, 'binwalk found an executable inside the file.', { indicator: 'embedded executable', tool: 'binwalk' }));
  if (Number(data.binwalk?.archives) > 0) items.push(item('suspicious', at, 'binwalk found an archive inside the file.', { indicator: 'embedded archive', tool: 'binwalk' }));
  if (binwalkFailed) items.push(item('emulation-stopped', at, 'binwalk could not finish.', { reason: 'binwalk-failed' }));
  const strings = (Array.isArray(data.strings?.interesting) ? data.strings.interesting : []).map(line => text(line, 200));
  if (strings.some(line => RUN_KEY_TEXT.test(line))) items.push(item('suspicious', at, 'The file mentions a Run registry key.', { indicator: 'Run key text', tool: 'strings' }));
  if (strings.some(line => SHELL_TOOL_TEXT.test(line))) items.push(item('suspicious', at, 'The file names a Windows shell tool.', { indicator: 'shell tool text', tool: 'strings' }));
  const yaraFailed = !isObject(data.yara) || data.yara.ok !== true;
  items.push(...mapYara(yaraFailed ? { ok: false } : data.yara, { at }));
  const detail = `Strings (${Number(data.strings?.ascii) || 0} ASCII, ${Number(data.strings?.utf16) || 0} UTF-16), entropy ${Number(data.entropy?.overall) || 0}, ${Array.isArray(data.binwalk?.found) ? data.binwalk.found.length : 0} binwalk hit(s), YARA ${Number(data.yara?.matchCount) || 0} match(es)${binwalkFailed ? '; binwalk could not finish' : ''}${yaraFailed ? '; YARA could not finish' : ''}.`;
  return { evidence: items.slice(0, MAX_CAPA_ITEMS + MAX_YARA_ITEMS), status: binwalkFailed || yaraFailed ? 'stopped' : 'done', detail };
}

// A signal id a model-written parser reported (analysis-loop.mjs TWILIGHT_SIGNALS) to the static item that gives that signal. Static evidence
// adds Twilight signals only, so a parser can never raise a finding. Signals that need runtime evidence (`unknown-hosts`) become `suspicious`.
const parserItem = (source, kind, at, detail, fields) => ({ source, kind, detail, at, ...fields });
const PARSER_ITEMS = {
  'exploit-unproven': at => parserItem('static', 'exploit-indicator', at, 'The parser reported exploit content.', { indicator: 'model-written parser: exploit content' }),
  'phishing-unproven': at => parserItem('static', 'phishing-indicator', at, 'The parser reported phishing content.', { indicator: 'model-written parser: phishing content' }),
  'anti-analysis': at => parserItem('static', 'anti-analysis', at, 'The parser reported anti-analysis content.', { technique: 'model-written parser: anti-analysis' }),
  'type-mismatch': at => parserItem('identify', 'type-mismatch', at, 'The parser reported a content type that differs from the extension.', { detectedType: 'unknown', claimedExtension: '' }),
  adware: at => parserItem('static', 'adware-indicator', at, 'The parser reported adware content.', { indicator: 'model-written parser: adware' }),
  'admin-request': at => parserItem('static', 'admin-request', at, 'The parser reported a request for administrator rights.', { indicator: 'model-written parser: admin request' }),
  'system-survey': at => parserItem('static', 'system-survey', at, 'The parser reported system survey content.', { indicator: 'model-written parser: system survey' }),
  'hidden-commands': at => parserItem('static', 'hidden-command', at, 'The parser reported hidden commands.', { tool: 'model-written parser', commandPreview: '' }),
  obfuscated: at => parserItem('static', 'obfuscation', at, 'The parser reported obfuscated content.', { technique: 'model-written parser: obfuscated' }),
  unsigned: at => parserItem('identify', 'unsigned', at, 'The parser reported that the file is unsigned.', { reason: 'model-written parser: unsigned' }),
  incomplete: at => parserItem('static', 'emulation-stopped', at, 'The parser could not read all of the file.', { reason: 'parser-incomplete' }),
};

/** Static evidence for the signal ids a parser reported; ids outside the Twilight list never reach this function (runParserLoop filters them). */
export function mapParserSignals(signals, { at }) {
  return (Array.isArray(signals) ? signals : []).map(id => (PARSER_ITEMS[id] ?? (() => item('suspicious', at, `The parser reported ${text(id, 40)}.`, { indicator: `model-written parser: ${text(id, 40)}` })))(at));
}
