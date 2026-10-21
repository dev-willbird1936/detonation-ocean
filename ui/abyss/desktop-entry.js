(() => {
  'use strict';

  // Entering a creature leads into the profile flow; the renderer's own placeholder is suppressed.
  function enterAttack(event) {
    const detail = event.detail;
    if (event.target !== window || detail === null || typeof detail !== 'object' || typeof detail.attackId !== 'string') return;
    event.preventDefault();
    window.location.assign('/ocean-profiles.html');
  }

  window.addEventListener('abyss:enter-attack', enterAttack);
})();
