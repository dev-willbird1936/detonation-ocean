// Assign every original entry to one of the five menu depths without inventing history.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveTaxonomy, FAMILIES, DEPTHS } from './build-ocean-taxonomy.mjs';

const choice = (depth, basis, scope, reason, victim = null, sources = []) => ({ depth, basis, scope, reason, victim, sources });
export const MENU_CHOICES = {
  'zeus-2007': choice('midnight', 'scenario', 'Banking-form credential-capture scenario, not initial malware installation', 'The displayed boundary is entering banking credentials into a browser modified by Zeus. Initial installation remains a separate, unresolved question.', 'Banking user whose browser is already compromised'),
  'stuxnet-2010': choice('trench', 'scenario', 'Remote-service network-propagation variant, not first entry into the industrial target', 'The selected network-service propagation route does not require a fresh response from the receiving host owner. Do not present this as the known first entry into Natanz.', 'Owner of a host reached through network-service propagation', ['https://learn.microsoft.com/en-us/security-updates/securitybulletins/2010/ms10-061']),
  'shamoon-2012': choice('trench', 'editorial', 'Editorial deep placement for an established destructive incident', 'Initial access is unresolved. Trench is a menu-layout fallback for the system-level destructive story, not evidence that the victim did nothing.'),
  'target-2013': choice('trench', 'editorial', 'Downstream Target/vendor-credential entry story', 'The attacker uses the compromised supplier relationship. Deep is the best-fit downstream menu placement, but the partially unresolved access path does not establish a complete no-action history.', 'Target organisation, not the supplier employee opening an email'),
  'sony-2014': choice('trench', 'editorial', 'Editorial deep placement for the destructive/data-theft incident', 'The public source does not establish initial access. This position must carry an entry-route-unconfirmed badge and must not be described as proven zero-action entry.'),
  'anthem-2015': choice('sunlight', 'editorial', 'Malware-file delivery/execution story from the indictment', 'The indictment describes a link, file download and execution, without establishing whether an employee separately executed the file. Sunlight is the editorial best fit for the file-execution story, not a verified manual launch.'),
  'lookalike-2005': choice('abyss', 'reference', 'Navigation/origin-display risk reference', 'The browser-display risk is encountered while navigating to an apparent origin. This is a reference placement, not a claim that navigation itself steals credentials.'),
  'opm-2015': choice('trench', 'editorial', 'Organisation-side compromised-contractor-identity entry story', 'The compromised contractor identity supports a deep organisational-access layout. Credential acquisition and any earlier human action remain unresolved; the placement is editorial, not proof of zero interaction.', 'OPM organisation, not an assumed contractor phishing victim'),
  'ukraine-2015': choice('sunlight', 'editorial', 'Reported malicious-Office-attachment delivery story', 'The attachment infection is reported, but CISA did not establish its role in the grid intrusion. Sunlight illustrates that delivery story; it is not proof that opening the document caused the outage.'),
  'vault7-2017': choice('trench', 'reference', 'Deep technical-capability disclosure reference', 'This is an editorial reference-library position for the disclosed cyber-tool inventory. There is no conventional victim-compromise depth to assert.'),
  'marriott-2018': choice('trench', 'editorial', 'Editorial deep placement for the persistent organisation breach', 'Installation of the initial web shell was not determined. Deep groups the organisation-level intrusion story but does not resolve its entry method.'),
  'vpnfilter-2018': choice('trench', 'editorial', 'Network-device compromise story; individual infection route unconfirmed', 'The implant affects routers/NAS devices, making deep the menu best fit. Talos was unsure of the exploit used in a given case; no specific default-password or zero-action route is asserted.'),
  'collection1-2019': choice('midnight', 'reference', 'Password/credential-reuse reference', 'The compiled credential collection belongs beside password-related lessons. It is not a fresh attack or proof that a victim submitted a password in 2019.'),
  'colonial-2021': choice('trench', 'scenario', 'Documented attacker access through the legacy single-factor VPN account', 'This organisation-side access boundary uses already-compromised credentials and does not require fresh victim approval. How the credentials were originally acquired remains unknown.', 'Colonial organisation at the VPN-access boundary'),
  'lapsus-2022': choice('twilight', 'scenario', 'Documented MFA-fatigue/approval variant, not every LAPSUS$ incident', 'Use the employee MFA-approval scenario documented within the campaign. Purchased credentials, help-desk and SIM-swap variants retain their own different interaction requirements.', 'Employee responding to attacker-induced MFA prompts'),
  'lastpass-2022': choice('trench', 'scenario', 'Second-incident third-party remote-exploitation stage only', 'The selected stage is remote exploitation of third-party media software on the engineer endpoint, before the keylogger captures later authentication. Do not classify that later password entry as the initial RCE gate.', 'Engineer endpoint at the selected remote-exploitation stage', ['https://www.infosecurity-magazine.com/news/lastpass-data-breach-update/']),
  'att-2024': choice('trench', 'editorial', 'Editorial deep placement for the cloud-workspace exfiltration story', 'The curated sources do not establish initial access. Deep is a workspace-compromise layout choice, not a proven no-action attack or a claim that a particular password attack occurred.'),
  'changehealth-2024': choice('trench', 'scenario', 'Documented attacker access through the Citrix portal without MFA', 'At this organisation-side portal boundary the attacker uses already-compromised credentials without fresh victim MFA approval. Credential acquisition is still not reconstructed.', 'Change Healthcare organisation at the Citrix-access boundary'),
  'npd-2024': choice('trench', 'editorial', 'Editorial deep placement for the alleged data-broker breach', 'The initial entry mechanism remains unconfirmed. The menu position reflects the organisation-level data-theft story and must carry that uncertainty badge.'),
};

export function deriveMenuTaxonomy(data, sourceSha256) {
  const evidence = deriveTaxonomy(data, sourceSha256);
  const entries = evidence.entries.map(entry => {
    const override = MENU_CHOICES[entry.id];
    if (!override && entry.depth === null) throw new Error(`Missing explicit menu decision: ${entry.id}`);
    const depth = override?.depth ?? entry.depth;
    if (!DEPTHS.some(d => d.id === depth)) throw new Error(`Invalid menu depth: ${entry.id}`);
    const basis = override?.basis ?? 'documented';
    const uncertainty = basis === 'editorial' ? 'Entry route unconfirmed — editorial placement'
      : basis === 'reference' ? 'Reference entry — not a victim-compromise classification'
      : basis === 'scenario' ? 'Selected scenario — other routes may differ' : null;
    return { ...entry, depth, placement: 'assigned', depthBasis: basis,
      evidenceDepth: entry.depth, evidencePlacement: entry.placement,
      evidenceRationale: entry.rationale,
      classificationScope: override?.scope ?? entry.classificationScope,
      victimPerspective: override?.victim ?? entry.victimPerspective,
      rationale: override?.reason ?? entry.rationale,
      uncertaintyBadge: uncertainty,
      sourceUrls: [...new Set([...entry.sourceUrls, ...(override?.sources ?? [])])] };
  });
  entries.sort((a, b) => DEPTHS.findIndex(d => d.id === a.depth) - DEPTHS.findIndex(d => d.id === b.depth)
    || FAMILIES.findIndex(f => f.id === a.family) - FAMILIES.findIndex(f => f.id === b.family)
    || a.year - b.year || a.id.localeCompare(b.id));
  const matrix = FAMILIES.map(f => ({ family: f.id,
    counts: Object.fromEntries(DEPTHS.map(d => [d.id, entries.filter(e => e.family === f.id && e.depth === d.id).length])),
    total: entries.filter(e => e.family === f.id).length }));
  return { version: 1, source: 'data/attacks.json', sourceSha256,
    evidenceProjection: 'data/ocean-taxonomy.json',
    policy: { purpose: 'Complete five-depth menu assignment requested by the user; not a claim that all initial-access histories are established',
      depthIsSeverity: false, victimBoundary: 'Always state whose action and which scenario boundary the displayed depth describes',
      selectedScenario: 'A named supported variant can place a multi-route campaign; retain the narrower scope prominently',
      editorialPlacement: 'When required by the complete menu, uncertain records get an explicit editorial placement and badge; never infer zero action from missing evidence',
      referencePlacement: 'Disclosures/display-risk references have a depth-related library position, not an invented attack mechanism',
      sourcePreservation: 'Keep historical facts/confidence, original subtype/SEV, and the stricter evidence-only placement separately',
      integration: 'Classification only; original source catalogues, renderer bundles and sandbox behaviours remain unchanged' },
    families: FAMILIES, depths: DEPTHS, matrix,
    counts: { total: entries.length, assigned: entries.length,
      documented: entries.filter(e => ['documented', 'scenario'].includes(e.depthBasis)).length,
      editorial: entries.filter(e => e.depthBasis === 'editorial').length,
      reference: entries.filter(e => e.depthBasis === 'reference').length,
      depthCounts: Object.fromEntries(DEPTHS.map(d => [d.id, entries.filter(e => e.depth === d.id).length])),
      occupiedFamilyDepthSlots: matrix.reduce((n, row) => n + Object.values(row.counts).filter(Boolean).length, 0),
      possibleFamilyDepthSlots: 30 }, entries };
}

export function renderMenuReport(taxonomy) {
  const lines = ['# Complete five-depth ocean menu — all 50 entries', '',
    '**Every entry is assigned once to Sunlight, Twilight, Midnight, Abyss or Trench.** The 37 supported/named-scenario positions are distinguished from 10 editorial positions and 3 reference-library positions. A menu position is not automatically a verified initial-access fact.', '',
    'The earlier evidence-only catalogue remains unchanged in `data/ocean-taxonomy.json` and `docs/ocean-taxonomy.md`.', '',
    '## Counts', '', '| Depth | Entries |', '| --- | ---: |',
    ...DEPTHS.map(d => `| ${d.name} | ${taxonomy.counts.depthCounts[d.id]} |`), '| **Total** | **50** |', '',
    '## Family/depth matrix', '', '| Family | Sunlight | Twilight | Midnight | Abyss | Trench | Total |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const row of taxonomy.matrix) lines.push(`| ${FAMILIES.find(f => f.id === row.family).name} | ${DEPTHS.map(d => row.counts[d.id]).join(' | ')} | ${row.total} |`);
  lines.push('', '## Reading the assignments', '',
    '- **documented:** placement already supported in the evidence-only catalogue.',
    '- **scenario:** a named supported stage/variant is selected; this is not a blanket placement for the entire campaign.',
    '- **editorial:** the menu must contain the entry, but the historical route remains unconfirmed. The uncertainty badge is required.',
    '- **reference:** a disclosure/display-risk library position, not a newly invented victim compromise.', '',
    'Depth is interaction, not damage. Credential acquisition can remain unresolved while a later organisation-side single-factor access scenario is documented. Later keylogger capture is not the earlier RCE gate.', '',
    '## All 50, sorted by depth and family', '');
  for (const depth of DEPTHS) {
    const entries = taxonomy.entries.filter(e => e.depth === depth.id);
    lines.push(`### ${depth.name} — ${depth.action} (${entries.length})`, '');
    for (const entry of entries) lines.push(`#### ${entry.name} (${entry.year})`, '',
      `- **ID:** \`${entry.id}\` · **Family:** ${FAMILIES.find(f => f.id === entry.family).name} · **Basis:** ${entry.depthBasis}`,
      `- **Victim:** ${entry.victimPerspective}`,
      `- **Selected scope:** ${entry.classificationScope}`,
      `- **Placement reason:** ${entry.rationale}`,
      ...(entry.uncertaintyBadge ? [`- **Required badge:** ${entry.uncertaintyBadge}`] : []),
      `- **Evidence-only status:** ${entry.evidencePlacement}${entry.evidenceDepth ? ` (${entry.evidenceDepth})` : ''}. ${entry.evidenceRationale}`,
      `- **Subtypes/tags:** ${entry.secondaryTags.join('; ')}`,
      `- **Historical confidence:** ${entry.historicalConfidence} · **Original label:** ${entry.legacyVector}, SEV${entry.legacySev}`,
      `- **Sources:** ${entry.sourceUrls.map((url, i) => `[${i + 1}](${url})`).join(' · ')}`, '');
  }
  lines.push('## Integration boundary', '',
    'Use `data/ocean-menu-taxonomy.json` for the complete menu projection, joined by original ID. All 50 have a depth. Keep `uncertaintyBadge`, `depthBasis` and `classificationScope` visible when integrating it. Original root/local-ocean data, the live renderer and sandbox scenarios have not been migrated or rebuilt.', '');
  return lines.join('\n');
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const raw = readFileSync(join(root, 'data/attacks.json'));
  const taxonomy = deriveMenuTaxonomy(JSON.parse(raw.toString('utf8')), createHash('sha256').update(raw).digest('hex'));
  writeFileSync(join(root, 'data/ocean-menu-taxonomy.json'), JSON.stringify(taxonomy, null, 2) + '\n');
  writeFileSync(join(root, 'docs/ocean-menu-taxonomy.md'), renderMenuReport(taxonomy));
  console.log(JSON.stringify({ counts: taxonomy.counts, matrix: taxonomy.matrix }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
