(() => {
  let last = 0;
  const ping = () => {
    const now = Date.now();
    if (now - last < 10000) return;
    last = now;
    try {
      const p = chrome.runtime.sendMessage({ type: 'activity' });
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  };
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart']
    .forEach(ev => window.addEventListener(ev, ping, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  ping();
})();
