(() => {
  const depthOrder = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];
  const depthNames = { sunlight: 'Sunlight', twilight: 'Twilight', midnight: 'Midnight', abyss: 'Abyss', trench: 'Trench' };
  const depthZones = { sunlight: '0–200 m', twilight: '200–1,000 m', midnight: '1,000–4,000 m', abyss: '4,000–6,000 m', trench: '6,000 m +' };
  const $ = selector => document.querySelector(selector);
  const matrix = $('#profile-matrix');
  const status = $('#catalog-status');
  const dialog = $('#profile-dialog');
  const depthKey = $('#depth-key-list');
  const scenarioList = $('#scenario-list');
  const scenarioStatus = $('#scenario-status');

  function setMorphologyImage(image, source) {
    image.src = source;
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function anchorLabel(profile) {
    return profile.anchor.year ? `${profile.anchor.name} (${profile.anchor.year})` : profile.anchor.name;
  }

  function validScenarioCatalog(scenarios, profiles) {
    if (!Array.isArray(scenarios) || scenarios.length !== 60) return false;
    const ids = new Set(), profileIds = new Set(profiles.map(profile => profile.id));
    const depths = Object.fromEntries(depthOrder.map(depth => [depth, 0]));
    const roles = { anchor: 0, free: 0 };
    for (const item of scenarios) {
      if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id) ||
          typeof item.name !== 'string' || !item.name.trim() ||
          (item.year !== null && !Number.isInteger(item.year)) ||
          !depthOrder.includes(item.depthId) || typeof item.depth !== 'string' ||
          typeof item.victimAction !== 'string' || !item.victimAction.trim() ||
          (item.note !== null && typeof item.note !== 'string') ||
          !['sourced', 'partial', 'unsupported', 'needs-sources', 'provisional'].includes(item.status) ||
          !['anchor', 'free'].includes(item.role) || !Array.isArray(item.sources) ||
          item.sources.some(source => {
            try { const url = new URL(source); return url.protocol !== 'https:' || !url.hostname || !!url.username || !!url.password; }
            catch { return true; }
          })) return false;
      ids.add(item.id);
      depths[item.depthId]++;
      roles[item.role]++;
      if (item.role === 'anchor') {
        if (typeof item.familyId !== 'string' || typeof item.family !== 'string' || typeof item.creature !== 'string' ||
            !profileIds.has(`${item.familyId}-${item.depthId}`)) return false;
      } else if (item.familyId !== null || item.family !== null || item.creature !== null) return false;
    }
    return ids.size === 60 && roles.anchor === 30 && roles.free === 30 && depthOrder.every(depth => depths[depth] === 12);
  }

  function renderScenarios(scenarios, profiles) {
    const profileById = new Map(profiles.map(profile => [profile.id, profile]));
    const statusLabels = { sourced: 'Sourced', partial: 'Partial evidence', unsupported: 'Unsupported', 'needs-sources': 'Needs citation', provisional: 'Provisional' };
    const statusNotes = {
      sourced: 'A source for this victim-action claim is linked below.',
      partial: 'Part of the victim action is sourced; the unresolved gap is stated below.',
      unsupported: 'Research found no support for this depth or placement; it has not been reclassified.',
      'needs-sources': 'No citation is attached to this victim-action claim yet.',
      provisional: 'Phishing is reported, but a password-only route is not established.',
    };
    for (const depthId of depthOrder) {
      const entries = scenarios.filter(entry => entry.depthId === depthId);
      const section = node('section', 'scenario-depth');
      section.dataset.depth = depthId;
      section.setAttribute('aria-labelledby', `scenario-${depthId}-title`);
      const heading = node('h3', 'scenario-depth-heading');
      heading.id = `scenario-${depthId}-title`;
      heading.append(node('span', '', depthNames[depthId]), node('small', '', `${entries.length} selected`));
      const list = node('ol', 'scenario-cards');
      list.setAttribute('aria-label', `${depthNames[depthId]} selected scenarios`);
      for (const entry of entries) {
        const card = node('li', 'scenario-card');
        card.dataset.status = entry.status;
        const labels = node('div', 'scenario-labels');
        labels.append(node('span', `scenario-role ${entry.role}`, entry.role === 'anchor' ? 'Family anchor' : 'Free pick'));
        labels.append(node('span', `scenario-evidence ${entry.status}`, statusLabels[entry.status]));
        card.append(labels, node('h4', 'scenario-name', `${entry.name}${entry.year ? ` (${entry.year})` : ''}`));
        if (entry.family) card.append(node('p', 'scenario-family', `${entry.family} · ${entry.creature}`));
        card.append(node('p', 'scenario-action', entry.victimAction), node('p', 'scenario-evidence-note', entry.note || statusNotes[entry.status]));
        const links = node('div', 'scenario-source-links');
        for (const [index, source] of entry.sources.entries()) {
          const link = node('a', '', `Source ${index + 1}`);
          link.href = source;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.title = source;
          links.append(link);
        }
        if (entry.sources.length) card.append(links);
        if (entry.role === 'anchor') {
          const profile = profileById.get(`${entry.familyId}-${entry.depthId}`);
          const button = node('button', 'scenario-open-profile', 'View creature profile');
          button.type = 'button';
          button.addEventListener('click', () => showProfile(profile));
          card.append(button);
        }
        const play = node('a', 'scenario-open-profile scenario-play', 'Play this scenario');
        play.href = `/ocean-entry.html?profile=${encodeURIComponent(entry.id)}`;
        card.append(play);
        list.append(card);
      }
      section.append(heading, list);
      scenarioList.append(section);
    }
    const totals = scenarios.reduce((counts, entry) => { counts[entry.status]++; return counts; },
      { sourced: 0, partial: 0, unsupported: 0, 'needs-sources': 0, provisional: 0 });
    const statusSummary = Object.entries(totals).filter(([, count]) => count > 0).map(([key, count]) => `${count} ${key}`).join(' · ');
    scenarioStatus.textContent = `60 scenarios · 12 per depth · 30 family anchors · 30 free picks · ${statusSummary}.`;
  }

  function showProfile(profile) {
    const creature = profile.displayCreature || profile.creature;
    $('#profile-family').textContent = `${profile.family} · ${creature} · ${profile.morphologyLabel}`;
    $('#profile-title').textContent = profile.depth;
    $('#profile-action').textContent = `${anchorLabel(profile)} · ${profile.anchor.victimAction}${profile.anchor.status === 'sourced' ? '' : ` (${profile.anchor.status})`}`;
    setMorphologyImage($('#profile-creature'), profile.morphologyUrl);
    $('#profile-note').textContent = profile.id === 'deception-abyss'
      ? 'A short, scripted, fictional scene on a fake desktop. Deception · Abyss also offers the separate OAuth consent exercise from the desktop controls. No account or camera data is real.'
      : 'A short, scripted, fictional scene on a fake desktop. Local only: no isolated cloud worker is connected for this profile, and no account, file or camera data is real.';
    $('#profile-desktop').href = `/ocean-entry.html?profile=${encodeURIComponent(profile.id)}`;
    dialog.dataset.depth = profile.depthId;
    dialog.showModal();
  }

  function seedBubbles() {
    const field = $('#bubbles');
    for (let index = 0; index < 22; index++) {
      const bubble = node('i');
      bubble.style.setProperty('--x', `${(index * 37 + 11) % 100}%`);
      bubble.style.setProperty('--s', `${4 + (index * 7) % 11}px`);
      bubble.style.setProperty('--t', `${16 + (index * 5) % 14}s`);
      bubble.style.setProperty('--d', `${-((index * 3) % 19)}s`);
      field.append(bubble);
    }
  }

  function render(profiles, scenarios) {
    const families = new Map();
    for (const profile of profiles) {
      if (!families.has(profile.familyId)) families.set(profile.familyId, []);
      families.get(profile.familyId).push(profile);
    }
    for (const depthId of depthOrder) {
      const item = node('li');
      item.dataset.depth = depthId;
      item.append(node('strong', '', depthNames[depthId]), node('span', '', depthZones[depthId]));
      depthKey.append(item);
    }

    const headingRow = node('div', 'matrix-heading');
    headingRow.setAttribute('role', 'row');
    const familyHeader = node('div', 'grid-heading family-corner', 'Vulnerability family');
    familyHeader.setAttribute('role', 'columnheader');
    headingRow.append(familyHeader);
    for (const depthId of depthOrder) {
      const profile = profiles.find(item => item.depthId === depthId);
      const heading = node('div', 'grid-heading');
      heading.dataset.depth = depthId;
      heading.setAttribute('role', 'columnheader');
      heading.append(node('strong', '', depthNames[depthId]), node('span', '', profile?.action || ''));
      headingRow.append(heading);
    }
    matrix.append(headingRow);

    for (const familyProfiles of families.values()) {
      const family = familyProfiles[0];
      const row = node('div', 'matrix-row');
      row.setAttribute('role', 'row');
      const heading = node('div', 'family-heading');
      heading.setAttribute('role', 'rowheader');
      heading.append(node('strong', '', family.family), node('span', '', family.displayCreature || family.creature));
      row.append(heading);
      for (const depthId of depthOrder) {
        const profile = familyProfiles.find(item => item.depthId === depthId);
        const cell = node('div', 'profile-cell');
        cell.dataset.depth = depthId;
        cell.setAttribute('role', 'cell');
        if (profile) {
          const button = node('button', 'profile-button');
          button.type = 'button';
          button.dataset.depth = profile.depthId;
          const creature = profile.displayCreature || profile.creature;
          button.setAttribute('aria-label', `${profile.family}, ${profile.depth}. ${creature}. ${profile.morphologyLabel}. ${profile.action}`);
          const image = node('img', 'creature-thumb');
          image.alt = '';
          image.width = 128;
          image.height = 96;
          const refreshLabel = 'Candidate · depth colour';
          button.append(
            node('span', 'depth-tag', profile.depth),
            image,
            node('strong', '', creature),
            node('small', 'morphology-label', profile.morphologyLabel),
            node('small', `morphology-status ${profile.morphologyStatus}`, refreshLabel),
            node('small', '', anchorLabel(profile)),
          );
          setMorphologyImage(image, profile.morphologyUrl);
          button.addEventListener('click', () => showProfile(profile));
          cell.append(button);
        }
        row.append(cell);
      }
      matrix.append(row);
    }
    renderScenarios(scenarios, profiles);
    status.textContent = 'All 30 creature/depth profiles are loaded. Select a cell to inspect it.';
  }

  $('#profile-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  seedBubbles();

  fetch('/api/ocean/profiles', { headers: { Accept: 'application/json' } })
    .then(response => {
      if (!response.ok) throw new Error('catalog_unavailable');
      return response.json();
    })
    .then(payload => {
      if (!Array.isArray(payload.profiles) || payload.profiles.length !== 30 ||
          payload.profiles.some(profile => typeof profile.id !== 'string' || !/^[a-z0-9-]{3,64}$/.test(profile.id) ||
            typeof profile.assetUrl !== 'string' || !profile.assetUrl.startsWith('/ocean-creatures/') ||
            typeof profile.morphologyUrl !== 'string' || !/^\/ocean-morphology\/[a-z-]+\/(sunlight|twilight|midnight|abyss|trench)\.png$/.test(profile.morphologyUrl) ||
            !['base-rich', 'midnight-abyss', 'trench'].includes(profile.morphologyStage) ||
            typeof profile.morphologyLabel !== 'string' || profile.morphologyStatus !== 'candidate' ||
            typeof profile.displayCreature !== 'string' ||
            typeof profile.anchor?.name !== 'string' || typeof profile.anchor.victimAction !== 'string') ||
          !validScenarioCatalog(payload.scenarios, payload.profiles)) {
        throw new Error('catalog_invalid');
      }
      render(payload.profiles, payload.scenarios);
    })
    .catch(() => {
      status.textContent = 'Creature catalog unavailable. No profile data was loaded.';
      scenarioStatus.textContent = 'Selected scenario catalog unavailable. No scenarios were loaded.';
    });
})();
