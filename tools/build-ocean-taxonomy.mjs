// Curated classification projection; never changes the source catalogue or sandbox.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

export const FAMILIES = [
  { id: 'deception', name: 'Deception & Impersonation', creature: 'Anglerfish' },
  { id: 'intrusion', name: 'Intrusion & Weaknesses', creature: 'Viperfish' },
  { id: 'network-abuse', name: 'Coordinated & Automated Abuse', creature: 'Siphonophore' },
  { id: 'trusted-source', name: 'Trusted-Source Compromise', creature: 'Isopod host fish' },
  { id: 'theft-surveillance', name: 'Theft & Surveillance', creature: 'Cookiecutter shark' },
  { id: 'extortion-destruction', name: 'Extortion & Destruction', creature: 'Octopus / kraken' },
];
export const DEPTHS = [
  { id: 'sunlight', name: 'Sunlight', action: 'Clean', legacySev: 5 },
  { id: 'twilight', name: 'Twilight', action: 'Risky or inconclusive', legacySev: 4 },
  { id: 'midnight', name: 'Midnight', action: 'Steals', legacySev: 3 },
  { id: 'abyss', name: 'Abyss', action: 'Takes control', legacySev: 2 },
  { id: 'trench', name: 'Trench', action: 'Destroys', legacySev: 1 },
];

// Every decision is deliberate, rather than an automatic vector/SEV conversion.
// Unknown means entry interaction is not established; not-applicable means the
// record is not a victim compromise. Neither is a sixth ocean depth.
const D = (family, depth, victim, rationale, tags = [], scope = 'Catalogue entry', confidence = 'high') =>
  ({ family, depth, victim, rationale, tags, scope, confidence });
export const DECISIONS = {
  'pccyborg-1989': D('extortion-destruction', 'sunlight', 'Recipient running the AIDS-information disk program', 'Running the delivered program is required; later reboot counting and ransom demands are consequences.', ['ransomware', 'mailed media']),
  'melissa-1999': D('network-abuse', 'sunlight', 'Employee opening the infected Word document', 'Attachment-driven macro execution enables automated mass mailing; propagation is the dominant lesson.', ['phishing delivery', 'macro worm', 'email disruption']),
  'iloveyou-2000': D('network-abuse', 'sunlight', 'Recipient opening the script attachment', 'User execution starts the mass-mailing worm; overwriting and credential theft remain secondary consequences.', ['phishing delivery', 'script execution', 'destructive malware']),
  'blaster-2003': D('network-abuse', 'trench', 'Owner of an exposed Windows host', 'Remote service exploitation propagates without a victim click or file execution.', ['network worm', 'remote service exploitation']),
  'slammer-2003': D('network-abuse', 'trench', 'Operator of a vulnerable SQL Server', 'The network-service worm needs no victim response; scanning congestion is the outcome.', ['network worm', 'service disruption']),
  'mydoom-2004': D('network-abuse', 'sunlight', 'Recipient executing the email-delivered worm', 'Classified on the documented email-attachment execution route, not every peer-to-peer variant.', ['phishing delivery', 'mass mailing', 'denial of service'], 'Email-attachment variant'),
  'sasser-2004': D('network-abuse', 'trench', 'Owner of an exposed Windows host', 'LSASS exploitation and network scanning do not require a victim response.', ['network worm', 'remote service exploitation']),
  'zeus-2007': D('theft-surveillance', null, 'Banking user whose endpoint or browser becomes infected', 'Typing a banking password after infection is not initial access. The broad malware entry does not establish one required installation route.', ['banking Trojan', 'form grabbing', 'keylogging'], 'Whole malware-family entry', 'unknown'),
  'tjx-2007': D('theft-surveillance', 'trench', 'TJX store and corporate-network operators', 'Classified on the reported external wireless-entry route; no employee response is required by that route. Reporting describes the route cautiously.', ['payment-card theft', 'wireless access'], 'Reported wireless-entry route', 'medium'),
  'conficker-2008': D('network-abuse', 'trench', 'Owner of a vulnerable Windows network host', 'The selected MS08-067 network-service propagation route requires no victim response; removable-media and share variants are not silently assigned this depth.', ['network worm', 'unpatched service', 'removable-media alternatives'], 'MS08-067 network-service variant'),
  'stuxnet-2010': D('extortion-destruction', null, 'Operator of the targeted industrial-control environment', 'Industrial process manipulation is the dominant lesson. USB/network propagation does not establish the initial compromise path into the selected industrial victim.', ['industrial sabotage', 'USB propagation', 'network propagation', 'signed malware'], 'Initial industrial-victim compromise', 'unknown'),
  'rsa-2011': D('trusted-source', 'sunlight', 'RSA employee targeted at the authentication supplier', 'Reporting describes an Excel attachment with an embedded exploit. The supplier-trust lesson is primary; do not claim a precise token-seed scope or every downstream customer compromised.', ['spearphishing', 'document exploitation', 'authentication-supplier compromise'], 'Reported RSA employee attachment route', 'medium'),
  'shamoon-2012': D('extortion-destruction', null, 'Saudi Aramco corporate-network victim', 'The cited description establishes wiping and disruption, not the decisive initial-access interaction. Destruction is not proof of no-action entry.', ['wiper', 'service disruption'], '2012 incident entry', 'unknown'),
  'target-2013': D('trusted-source', null, 'Target as downstream customer of Fazio Mechanical', 'Vendor credential theft and downstream POS theft are established; the curated record leaves the access path partly unresolved. Do not assign the vendor employee\'s email action to Target.', ['supplier credentials', 'POS malware', 'payment-card theft'], 'Target downstream compromise, not supplier phishing', 'unknown'),
  'emotet-2014': D('network-abuse', 'sunlight', 'Recipient opening a malicious attachment', 'Classified on the sourced malicious-file execution variant. Its coordinated delivery platform is primary; do not imply every Emotet link causes one-click execution.', ['phishing delivery', 'botnet', 'malware delivery'], 'Malicious-attachment variant'),
  'heartbleed-2014': D('intrusion', 'trench', 'Operator of the vulnerable TLS service', 'Remote heartbeat handling can expose process memory without a victim response.', ['software vulnerability', 'memory disclosure']),
  'sony-2014': D('extortion-destruction', null, 'Sony Pictures organisation', 'Observed destruction, theft and threats make destructive/extortion impact primary. The FBI statement does not establish initial access.', ['data theft', 'destructive malware', 'threats'], 'Organisation incident entry', 'unknown'),
  'anthem-2015': D('theft-surveillance', null, 'Employee of the affected Anthem subsidiary', 'The indictment distinguishes clicking a hyperlink, downloading a file and executing it. It does not establish whether the victim separately ran the file; one-click-only and manual-file execution are both unproven.', ['spearphishing', 'backdoor', 'data exfiltration'], 'Indictment paragraph 14(a) initial delivery', 'unknown'),
  'carbanak-2015': D('theft-surveillance', 'sunlight', 'Bank employee targeted by a malicious attachment', 'The described attachment route enables later banking and ATM theft; the theft operation is the dominant story.', ['spearphishing', 'malware', 'financial theft']),
  'lookalike-2005': D('deception', 'not-applicable', 'Browser user inspecting an apparent origin', 'This standalone record describes an address-bar spoofing risk, not a completed credential leak or a single compromise gate. Keep it in reference material rather than inventing a breach depth.', ['IDN homograph', 'origin-display spoofing'], 'Standalone display-risk technique'),
  'opm-2015': D('theft-surveillance', null, 'OPM organisation and the compromised delegated identity', 'The KeyPoint credential was compromised, but how it was obtained was not determined. A compromised credential is neither proof of victim password submission nor proof of no victim action.', ['contractor identity', 'sensitive-record theft'], 'Initial compromised-identity provenance', 'unknown'),
  'ukraine-2015': D('extortion-destruction', null, 'Affected Ukrainian power-grid operator', 'CISA confirms remote breaker operation and disruption but says BlackEnergy\'s initial-access role was still under evaluation. Do not convert a reported attachment infection into a proven outage-entry gate.', ['industrial disruption', 'remote administration', 'reported spearphishing', 'KillDisk'], 'Initial entry leading to the grid incident', 'unknown'),
  'mirai-2016': D('network-abuse', 'trench', 'Owner of an internet-connected device', 'The selected self-propagating IoT botnet route does not require its owner to submit a password or respond to a lure.', ['IoT botnet', 'denial of service']),
  'smishing-2016': D('deception', 'midnight', 'SMS recipient entering credentials at the spoofed site', 'For the credential-page variant described in the entry, following the link alone does not disclose credentials; submission is the decisive action.', ['SMS phishing', 'credential capture'], 'Credential-entry variant, not malware-download variants', 'medium'),
  'yahoo-cookies-2016': D('intrusion', 'trench', 'Yahoo account holder targeted by a forged session', 'Forged cookies allow attacker access without the account holder supplying a password or responding.', ['session forgery', 'authentication bypass']),
  'equifax-2017': D('intrusion', 'trench', 'Operator of the exposed Equifax web application', 'Server-side exploitation of the unpatched application needs no victim response; data theft is a secondary outcome.', ['unpatched application', 'data theft']),
  'notpetya-2017': D('trusted-source', 'trench', 'Organisation receiving the compromised M.E.Doc updater payload', 'Classified on the updater-delivery mechanism, not a fictitious tax-document lure. It does not generalise no-action entry to every manually installed package.', ['compromised update', 'wiper', 'network propagation'], 'Compromised updater mechanism', 'medium'),
  'vault7-2017': D('theft-surveillance', 'not-applicable', 'No conventional victim compromise represented by this entry', 'A published inventory/disclosure is not a documented initial-access event. Its historical placement must not become a no-action attack.', ['disclosure', 'capability inventory']),
  'wannacry-2017': D('extortion-destruction', 'trench', 'Operator of a vulnerable SMB service', 'Wormable service exploitation enables encryption without a victim click, password submission or file launch.', ['ransomware', 'network worm', 'unpatched service']),
  'marriott-2018': D('theft-surveillance', null, 'Marriott/Starwood organisation', 'The source explicitly leaves installation of the initial web shell undetermined; later tools and stolen data do not establish the entry interaction.', ['web shell', 'credential harvesting', 'long dwell'], 'Initial web-shell placement', 'unknown'),
  'vpnfilter-2018': D('network-abuse', null, 'Owner of the compromised router or NAS', 'Talos states it was unsure of the particular exploit used in any given case. Known exploits and default credentials are possibilities, not a proven interaction classification.', ['router implant', 'coordinated infrastructure', 'traffic surveillance'], 'Whole implant campaign', 'unknown'),
  'capitalone-2019': D('intrusion', 'trench', 'Capital One cloud-environment operator', 'The documented server-side request/misconfiguration route needs no victim response; exposed credentials are obtained by the attacker, not typed by the victim.', ['misconfiguration', 'SSRF', 'cloud-data theft']),
  'collection1-2019': D('theft-surveillance', 'not-applicable', 'No single newly compromised victim represented by the compilation', 'A compilation of previously exposed credentials is a disclosure, not a fresh intrusion with an established interaction gate.', ['credential compilation', 'disclosure', 'credential-reuse risk']),
  'simswap-2020': D('deception', 'trench', 'Subscriber whose number is reassigned', 'In the selected carrier-impersonation variant, the attacker persuades carrier staff and receives redirected codes. The subscriber does not provide the code or approve MFA. Carrier employees are a different perspective.', ['carrier impersonation', 'account recovery abuse', 'OTP interception'], 'Subscriber perspective; carrier-social-engineering variant'),
  'solarwinds-2020': D('trusted-source', 'trench', 'Downstream Orion customer organisation', 'The signed build/update channel carries the payload. Classify the downstream updater/runtime compromise, not an invented human deception step at the supplier.', ['build-process compromise', 'signed update', 'espionage'], 'Downstream signed-update mechanism', 'medium'),
  'colonial-2021': D('extortion-destruction', null, 'Colonial organisation and the compromised VPN identity', 'Use of the legacy single-factor VPN account is known; credential acquisition was still under investigation. No-MFA does not prove how the victim identity was first compromised.', ['ransomware', 'valid-account abuse', 'no MFA'], 'Compromised-identity provenance', 'unknown'),
  'log4shell-2021': D('intrusion', 'trench', 'Operator of an application evaluating attacker-controlled logged input', 'The server-side lookup flaw can be triggered by attacker input without a victim response.', ['software vulnerability', 'unsafe lookup', 'remote code execution']),
  'drainer-2022': D('deception', 'abyss', 'Wallet holder signing the malicious approval', 'The described gate is a wallet authorisation/signature, not supplying an OTP or recovery secret. Keep the high financial impact separate from depth.', ['wallet-approval phishing', 'financial theft'], 'Approval-only wallet-drainer variant'),
  'lapsus-2022': D('deception', null, 'Victims across the named LAPSUS$ campaign', 'The entry combines MFA fatigue, help-desk deception, SIM swapping and purchased credentials. No single required action is established for the whole combined campaign.', ['MFA fatigue', 'help-desk impersonation', 'SIM swapping', 'purchased credentials'], 'Whole multi-route campaign; no single variant selected', 'mixed'),
  'lastpass-2022': D('theft-surveillance', null, 'LastPass staff and backup environments across two incidents', 'The entry combines two compromises. Third-party exploitation and later secret access are documented, but this combined record does not establish one decisive victim-action gate. Do not place later authentication at initial access.', ['third-party vulnerability', 'privileged endpoint', 'backup-data theft'], 'Combined two-incident entry', 'mixed'),
  'ukraine-2022': D('extortion-destruction', 'trench', 'Viasat KA-SAT network operator', 'The documented VPN-appliance misconfiguration enables entry into the trusted management segment without victim response; subsequent modem disruption is the outcome.', ['network misconfiguration', 'management-plane abuse', 'service disruption']),
  'moveit-2023': D('theft-surveillance', 'trench', 'Operator of the exposed MOVEit Transfer application', 'Unauthenticated application exploitation enables bulk data theft. Retain SQL injection as a technique badge rather than losing the exfiltration lesson.', ['SQL injection', 'web shell', 'bulk-data theft']),
  'oauth-2023': D('deception', 'abyss', 'User granting the malicious connected app access', 'The consent-only variant grants access without a fake login, password capture, extra authentication-factor disclosure or downloaded-file execution.', ['OAuth consent', 'permission abuse'], 'Consent-only variant'),
  'att-2024': D('theft-surveillance', null, 'AT&T cloud-workspace victim', 'Exfiltration from the workspace is documented, but the cited record does not establish how initial access was obtained.', ['third-party cloud workspace', 'metadata theft'], 'Initial workspace entry', 'unknown'),
  'bec-2024': D('deception', 'abyss', 'Finance recipient persuaded to authorise a fraudulent payment', 'Classify the entry\'s invoice/payment authorisation boundary, not an invented initial compromise of the existing email thread. No attacker-directed credential disclosure or file execution is specified.', ['invoice-thread impersonation', 'payment-authorisation fraud'], 'Finance-victim transaction boundary, not mailbox initial access', 'medium'),
  'changehealth-2024': D('extortion-destruction', null, 'Change Healthcare organisation and the compromised Citrix identity', 'Ransomware, extortion and service disruption are primary. Use of compromised credentials without MFA does not establish how those credentials were acquired.', ['ransomware', 'data theft', 'valid-account abuse', 'no MFA'], 'Compromised-identity provenance', 'unknown'),
  'npd-2024': D('theft-surveillance', null, 'National Public Data organisation', 'The public record cited in the catalogue does not establish a specific entry mechanism; do not equate an alleged data release with no-action access.', ['data broker', 'alleged data release'], 'Initial organisation compromise', 'unknown'),
  'quishing-2024': D('deception', 'midnight', 'QR-code recipient submitting credentials to the spoofed site', 'For the described credential-stealing-site variant, scanning/navigation alone is not credential theft. Classify credential submission, not the preliminary QR scan.', ['QR phishing', 'credential capture'], 'Credential-entry variant, not malware-download variants', 'medium'),
  'salesforce-2025': D('deception', 'abyss', 'Employee approving the malicious connected app', 'Voice persuasion leads to application authorisation without password theft; data export follows the consent boundary.', ['vishing', 'connected-app consent', 'data theft']),
  'sharepoint-2025': D('intrusion', 'trench', 'Operator of the exposed on-premises SharePoint server', 'Unauthenticated requests trigger server-side exploitation without a victim response; key theft is a consequence, not a user credential submission.', ['deserialisation', 'unauthenticated exploitation', 'signing-key theft']),
};

export function deriveTaxonomy(data, sourceSha256) {
  const ids = new Set(data.attacks.map(a => a.id));
  if (data.attacks.length !== 50 || ids.size !== 50 || Object.keys(DECISIONS).length !== 50 || Object.keys(DECISIONS).some(id => !ids.has(id))) {
    throw new Error('Classification must account for exactly the existing 50 unique IDs');
  }
  const familyIds = new Set(FAMILIES.map(f => f.id));
  const depthIds = new Set(DEPTHS.map(d => d.id));
  const entries = data.attacks.map(a => {
    const decision = DECISIONS[a.id];
    if (!familyIds.has(decision.family) || (decision.depth !== null && decision.depth !== 'not-applicable' && !depthIds.has(decision.depth))) {
      throw new Error(`Invalid classification: ${a.id}`);
    }
    const placement = decision.depth === null ? 'unknown' : decision.depth === 'not-applicable' ? 'not-applicable' : 'placed';
    return { id: a.id, name: a.name, year: a.year, entryType: a.type,
      family: decision.family, depth: placement === 'placed' ? decision.depth : null,
      placement, placementConfidence: decision.confidence,
      victimPerspective: decision.victim, classificationScope: decision.scope,
      rationale: decision.rationale, secondaryTags: [...new Set([a.vector, ...decision.tags])],
      historicalConfidence: a.confidence, legacyVector: a.vector, legacySev: a.sev,
      sourceUrls: a.source_urls };
  });
  const order = entry => entry.placement === 'placed' ? DEPTHS.findIndex(d => d.id === entry.depth) : entry.placement === 'unknown' ? 5 : 6;
  entries.sort((a, b) => order(a) - order(b) || FAMILIES.findIndex(f => f.id === a.family) - FAMILIES.findIndex(f => f.id === b.family) || a.year - b.year || a.id.localeCompare(b.id));
  const matrix = FAMILIES.map(f => ({ family: f.id, counts: Object.fromEntries(DEPTHS.map(d => [d.id, entries.filter(e => e.family === f.id && e.depth === d.id).length])),
    unknown: entries.filter(e => e.family === f.id && e.placement === 'unknown').length,
    notApplicable: entries.filter(e => e.family === f.id && e.placement === 'not-applicable').length,
    total: entries.filter(e => e.family === f.id).length }));
  return { version: 1, source: 'data/attacks.json', sourceSha256,
    policy: { depthIsSeverity: false, categoriesAre: 'Visual browsing families, not mutually exclusive CWE classes',
      boundary: 'Required victim interaction at the documented scenario boundary: initial access for intrusion cases; authorisation/transaction for fraud-only techniques',
      actorRule: 'Never transfer an upstream supplier or carrier employee action to the displayed downstream victim',
      unknownRule: 'Missing or mixed entry evidence is unplaced, not Trench',
      subtypeRule: 'Keep original subtype, technique and outcome facts as secondary tags',
      scopeRule: 'Selected malware/technique variants are explicit; a whole multi-route campaign may remain unplaced',
      applicability: 'Disclosures and standalone display-risk references stay outside the five-depth placement',
      evidenceScope: 'Curated catalogue descriptions and inherited citations, with focused source checks for SIM swapping, Anthem, Ukraine 2015, VPNFilter and LastPass; not a new independent historical audit of every source',
      integration: 'Projection only: original root/local-ocean catalogues, embedded renderers and sandbox scenarios are unchanged' },
    families: FAMILIES, depths: DEPTHS, matrix,
    counts: { total: entries.length, placed: entries.filter(e => e.placement === 'placed').length,
      unknown: entries.filter(e => e.placement === 'unknown').length,
      notApplicable: entries.filter(e => e.placement === 'not-applicable').length,
      occupiedFamilyDepthSlots: matrix.reduce((n, row) => n + Object.values(row.counts).filter(Boolean).length, 0), possibleFamilyDepthSlots: 30 },
    entries };
}

export function renderReport(taxonomy) {
  const lines = ['# Revised ocean catalogue — all 50 entries', '',
    '**Six visual families; five victim-interaction depths. This is a classification projection, not a renderer or sandbox migration.**', '',
    `Accounted for: **${taxonomy.counts.total}**. Placed: **${taxonomy.counts.placed}**. Unknown/mixed entry interaction: **${taxonomy.counts.unknown}**. Not applicable: **${taxonomy.counts.notApplicable}**.`, '',
    `Occupied artwork slots: **${taxonomy.counts.occupiedFamilyDepthSlots}/30**, excluding unplaced/reference records. This replaces the earlier arithmetic grouping of legacy labels; it is not a claim that only these combinations exist in the real world.`, '',
    '## Family/depth matrix', '', '| Family | Sunlight | Twilight | Midnight | Abyss | Trench | Unknown | N/A | Total |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const row of taxonomy.matrix) lines.push(`| ${FAMILIES.find(f => f.id === row.family).name} | ${DEPTHS.map(d => row.counts[d.id]).join(' | ')} | ${row.unknown} | ${row.notApplicable} | ${row.total} |`);
  lines.push('', '## Important corrections', '',
    '- SIM swapping is Trench for the subscriber in the carrier-impersonation variant: the carrier is deceived, and the subscriber does not supply the OTP. The earlier assertion that no-action deception cannot exist was too broad.',
    '- Wallet-approval drainers are Abyss in the approval-only variant. A wallet signature is not automatically an MFA code or recovery-secret disclosure.',
    '- Smishing and quishing are Midnight for the described credential-entry variants; opening a spoofed login page alone does not disclose credentials.',
    '- Zeus banking-form entry occurs after endpoint infection; it does not establish the initial malware installation gate.',
    '- Anthem\'s indictment distinguishes clicking, download and execution without establishing separate victim execution. Ukraine 2015\'s CISA report leaves BlackEnergy\'s role in initial access under evaluation.',
    '- Unknown credential provenance, unspecified entry routes and combined multi-route campaigns are not treated as no-action attacks.',
    '- Vault 7 and Collection #1 are disclosures. The IDN/homograph record describes a standalone display risk rather than a completed compromise. These three remain reference entries, not depth-placed attacks.',
    '- Worms such as Melissa, ILOVEYOU, Mydoom and Emotet move to coordinated/automated abuse, while their phishing delivery remains a badge.',
    '- RSA is classified on its authentication-supplier trust lesson; no particular token-seed scope or universal downstream compromise is asserted.', '',
    '## Placement rules', '', ...Object.entries(taxonomy.policy).map(([k, v]) => `- **${k}:** ${v}`), '',
    'Depth is not impact or attacker sophistication. The original 50 records and historical confidence values are preserved; placement confidence is separate.', '',
    '## Complete sorted catalogue', '');
  const sections = [...DEPTHS.map(d => ({ key: d.id, title: `${d.name} — ${d.action}`, match: e => e.depth === d.id })),
    { key: 'unknown', title: 'Unplaced — unknown or mixed entry interaction', match: e => e.placement === 'unknown' },
    { key: 'not-applicable', title: 'Reference entries — no applicable compromise depth', match: e => e.placement === 'not-applicable' }];
  for (const section of sections) {
    const entries = taxonomy.entries.filter(section.match);
    lines.push(`### ${section.title} (${entries.length})`, '');
    if (!entries.length) { lines.push('No current entry has a verified placement in this tier under these rules.', ''); continue; }
    for (const entry of entries) {
      lines.push(`#### ${entry.name} (${entry.year})`, '',
        `- **ID:** \`${entry.id}\` · **Family:** ${FAMILIES.find(f => f.id === entry.family).name} · **Placement confidence:** ${entry.placementConfidence}`,
        `- **Victim perspective:** ${entry.victimPerspective}`,
        `- **Scope:** ${entry.classificationScope}`,
        `- **Reason:** ${entry.rationale}`,
        `- **Badges:** ${entry.secondaryTags.join('; ')}`,
        `- **Legacy:** ${entry.legacyVector}, SEV${entry.legacySev}; retained, not used as proof of this placement.`,
        `- **Sources:** ${entry.sourceUrls.map((url, i) => `[${i + 1}](${url})`).join(' · ')}`, '');
    }
  }
  lines.push('## Integration boundary', '',
    'The machine-readable classification is `data/ocean-taxonomy.json`, joined to original records by ID. The original `data/attacks.json` and `local-ocean/data/attacks.json` are unchanged. The current renderer and training scenarios still use their legacy embedded categories/SEV; they do not yet consume this projection. In particular, an unplaced row must not be silently rendered using its old SEV during a future migration.', '');
  return lines.join('\n');
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const raw = readFileSync(join(root, 'data/attacks.json'));
  const taxonomy = deriveTaxonomy(JSON.parse(raw.toString('utf8')), createHash('sha256').update(raw).digest('hex'));
  writeFileSync(join(root, 'data/ocean-taxonomy.json'), JSON.stringify(taxonomy, null, 2) + '\n');
  writeFileSync(join(root, 'docs/ocean-taxonomy.md'), renderReport(taxonomy));
  console.log(JSON.stringify({ counts: taxonomy.counts, matrix: taxonomy.matrix }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
