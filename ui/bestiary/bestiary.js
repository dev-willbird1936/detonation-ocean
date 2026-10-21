// Bestiary page: fetches the rosters and the shared ocean, fills the four sections, and opens the card named in
// the URL fragment (the main menu links to /bestiary#<finding id>). A failed /api/ocean leaves every creature unfound.
(() => {
  'use strict';
  const getJson = (url) => fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fill = (id, html) => { document.getElementById(id).innerHTML = html; };

  // Reveal-all is for local development only; the production flag is the server's <meta name="do-env">.
  const flag = document.querySelector('meta[name="do-env"]')?.content;
  const production = flag === 'production' || (flag !== 'development' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname));
  const reveal = !production && /[?&]reveal\b/.test(location.search);

  function markFocus() {
    const target = decodeURIComponent(location.hash.slice(1));
    const card = target && document.getElementById(target);
    if (!card?.classList?.contains('card')) return;
    card.classList.add('picked');
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'center' });
  }

  // A species without sheet art (see FISH_ART in render.js) gets the stand-in pixel fish.
  function standIns() {
    for (const holder of document.querySelectorAll('.sprite.fish[data-stand-in]')) {
      const flat = window.PixelFish.canvas(holder.dataset.species);
      const canvas = window.PixelLit.bake(flat, window.PixelLit.normalFromAlpha(flat));
      canvas.className = 'sprite stand-in';
      canvas.setAttribute('aria-hidden', 'true');
      holder.replaceWith(canvas);
    }
  }

  async function start() {
    const [roster, fish, ocean] = await Promise.all([getJson('/data/creatures.json'), getJson('/data/fish.json'), getJson('/api/ocean')]);
    if (!roster || !fish) {
      document.getElementById('status').textContent = 'The creature lists could not be loaded. Try again in a moment.';
      return;
    }
    const parts = window.BestiaryRender.render(roster, fish, ocean, { reveal });
    fill('depths', parts.depths);
    fill('fish', parts.fish);
    fill('creatures', parts.creatures);
    fill('system', parts.system);
    const found = (ocean?.creatures ?? []).filter((item) => item.eaten > 0).length;
    document.getElementById('status').textContent = ocean
      ? `${found} of ${roster.creatures.length} finding creatures found so far.`
      : 'The shared ocean is not available, so every creature shows as not yet found.';
    standIns();
    markFocus();
  }

  window.addEventListener('hashchange', markFocus);
  start();
})();
