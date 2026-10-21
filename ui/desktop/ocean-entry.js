(() => {
  const OPT_IN_STORAGE_KEY = 'ocean-opt-in';
  const profileId = new URLSearchParams(window.location.search).get('profile');
  const title = document.querySelector('#entry-title');
  const detail = document.querySelector('#entry-detail');
  const creature = document.querySelector('#entry-creature');
  const card = document.querySelector('#safety-card');
  const tick = document.querySelector('#entry-opt-in');
  const enter = document.querySelector('#enter-desktop');
  const skip = document.querySelector('#skip-bite');
  const camera = document.querySelector('#camera-prop');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function fail(message) {
    document.body.dataset.stage = 'error';
    title.textContent = 'Creature preview unavailable';
    detail.textContent = message;
    card.hidden = false;
    for (const element of [creature, camera, tick.closest('label'), enter]) element.hidden = true;
    for (const element of card.querySelectorAll('.entry-points, .boundary, .privacy-note')) element.hidden = true;
  }

  function goToDesktop(profile) {
    window.location.assign(`/desktop.html?profile=${encodeURIComponent(profile.id)}`);
  }

  function beginBite(profile) {
    try { window.sessionStorage.setItem(OPT_IN_STORAGE_KEY, profile.id); }
    catch { /* The desktop shows its own opt-in card when storage is unavailable. */ }
    card.hidden = true;
    if (reducedMotion.matches) {
      goToDesktop(profile);
      return;
    }
    skip.href = `/desktop.html?profile=${encodeURIComponent(profile.id)}`;
    skip.hidden = false;
    creature.addEventListener('animationend', () => goToDesktop(profile), { once: true });
    document.body.dataset.stage = 'bite';
  }

  if (typeof profileId !== 'string' || !/^[a-z0-9-]{3,64}$/.test(profileId)) {
    fail('Choose a valid creature/depth profile from the matrix.');
    return;
  }

  fetch('/api/ocean/profiles', { headers: { Accept: 'application/json' } })
    .then(response => {
      if (!response.ok) throw new Error('The local profile catalog is unavailable.');
      return response.json();
    })
    .then(payload => {
      // One of the 30 creature profiles, or one of the 60 scenarios (which plays on its family and depth profile).
      const profile = (Array.isArray(payload.profiles) ? payload.profiles.find(item => item.id === profileId) : null) ??
        window.OceanScenarioProfile?.resolve(payload, profileId) ?? null;
      if (!profile || typeof profile.family !== 'string' || typeof profile.creature !== 'string' ||
          typeof profile.depth !== 'string' || typeof profile.assetUrl !== 'string' ||
          !/^\/ocean-creatures\/[a-z-]+\/(sunlight|twilight|midnight|abyss|trench)\.gif$/.test(profile.assetUrl)) {
        throw new Error('That creature/depth combination is not in the verified catalog.');
      }
      const anchor = profile.anchor;
      const inspiredBy = typeof anchor?.name === 'string'
        ? ` Inspired by ${anchor.year ? `${anchor.name} (${anchor.year})` : anchor.name}.`
        : '';
      document.body.dataset.depth = profile.depthId;
      title.textContent = `${profile.creature} · ${profile.depth}`;
      detail.textContent = `${profile.family}: ${profile.action}.${inspiredBy}`;
      creature.onerror = () => fail('The verified local creature animation could not be loaded.');
      creature.onload = () => {
        document.body.dataset.stage = 'card';
        card.hidden = false;
        tick.focus({ preventScroll: true });
      };
      tick.addEventListener('change', () => { enter.disabled = !tick.checked; });
      enter.addEventListener('click', () => { if (tick.checked) beginBite(profile); });
      creature.src = profile.assetUrl;
    })
    .catch(error => fail(error.message));
})();
