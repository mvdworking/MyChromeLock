const LOCK_URL = chrome.runtime.getURL('lock.html');
const OPTIONS_URL = chrome.runtime.getURL('options.html');
const ALARM = 'lock-watchdog';
const STARTUP_ALARM = 'startup-lock';
const DEFAULTS = { timeoutMinutes: 10, hash: null, salt: null, iterations: 150000 };
const MAX_ATTEMPTS = 5;
const PENALTY_MS = 30000;

/* ---------- settings ---------- */
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}
async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/* ---------- password: PBKDF2 ---------- */
const toHex = (b) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));

async function derive(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' }, key, 256
  );
  return toHex(bits);
}
async function setPassword(password) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const iterations = DEFAULTS.iterations;
  return saveSettings({ salt, iterations, hash: await derive(password, salt, iterations) });
}
async function verifyPassword(password) {
  const s = await getSettings();
  if (!s.hash) return false;
  const candidate = await derive(password, s.salt, s.iterations);
  if (candidate.length !== s.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ s.hash.charCodeAt(i);
  return diff === 0;
}

/* ---------- state ---------- */
async function isLocked() {
  const s = await getSettings();
  if (!s.hash) return false;
  const { unlocked } = await chrome.storage.session.get('unlocked');
  return unlocked !== true;
}
async function touch() {
  await chrome.storage.session.set({ lastActivity: Date.now() });
}
function redirect(tabId, url = LOCK_URL) {
  return chrome.tabs.update(tabId, { url }).catch(() => {});
}
function isAllowed(url) {
  return !!url && url.startsWith(LOCK_URL);
}
function isRestorable(url) {
  return /^(https?|file|ftp):/i.test(url || '');
}
function isBlank(url) {
  if (!url) return true;
  return (
    url === 'about:blank' ||
    url.startsWith('about:') ||
    url.startsWith('chrome://newtab') ||
    url.startsWith('chrome://new-tab-page')
  );
}
function tabUrl(tab) {
  return (tab && (tab.pendingUrl || tab.url)) || '';
}
async function inGrace() {
  const { startupGrace } = await chrome.storage.session.get('startupGrace');
  return startupGrace === true;
}

function normalizeSaved(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') return { id: null, url: item };
      return {
        id: item && item.id != null && Number.isFinite(Number(item.id)) ? Number(item.id) : null,
        url: item && item.url
      };
    }).filter((item) => isRestorable(item.url));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw)
      .map(([id, url]) => ({ id: Number(id), url }))
      .filter((item) => isRestorable(item.url));
  }
  return [];
}

let saveChain = Promise.resolve();
async function rememberTabNow(tabId, url) {
  if (!isRestorable(url)) return;
  const { savedTabs } = await chrome.storage.session.get('savedTabs');
  const list = normalizeSaved(savedTabs);
  const id = Number(tabId);
  if (Number.isFinite(id)) {
    const idx = list.findIndex((item) => item.id === id);
    if (idx >= 0) list[idx].url = url;
    else list.push({ id, url });
  } else {
    list.push({ id: null, url });
  }
  await chrome.storage.session.set({ savedTabs: list });
}
function rememberTab(tabId, url) {
  const run = saveChain.then(() => rememberTabNow(tabId, url));
  saveChain = run.catch(() => {});
  return run;
}

/* ---------- lock ---------- */
async function lock(opts = {}) {
  const s = await getSettings();
  if (!s.hash) {
    chrome.runtime.openOptionsPage();
    return { ok: false, error: 'Set a password in settings first.' };
  }

  await chrome.storage.session.set({ unlocked: false, attempts: 0, blockedUntil: 0 });
  const grace = opts.forceBlank ? false : await inGrace();

  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    const url = tabUrl(t);
    if (isAllowed(url)) continue;
    if (isRestorable(url)) {
      await rememberTab(t.id, url);
      if (!grace) redirect(t.id);
    } else if (!grace) {
      redirect(t.id);
    }
  }
  return { ok: true };
}

async function lockImmediate() {
  await chrome.storage.session.set({ startupGrace: false });
  chrome.alarms.clear(STARTUP_ALARM);
  return lock({ forceBlank: true });
}

async function enforceAll() {
  const grace = await inGrace();
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    const url = tabUrl(t);
    if (isAllowed(url)) continue;
    if (isRestorable(url)) {
      await rememberTab(t.id, url);
      if (!grace) redirect(t.id);
    } else if (!grace) {
      redirect(t.id);
    }
  }
}

async function unlock(password) {
  const { blockedUntil = 0, attempts = 0 } =
    await chrome.storage.session.get(['blockedUntil', 'attempts']);

  if (Date.now() < blockedUntil) {
    return { ok: false, wait: Math.ceil((blockedUntil - Date.now()) / 1000) };
  }

  if (!(await verifyPassword(password))) {
    const n = attempts + 1;
    const over = n >= MAX_ATTEMPTS;
    await chrome.storage.session.set({
      attempts: over ? 0 : n,
      blockedUntil: over ? Date.now() + PENALTY_MS : 0
    });
    return over ? { ok: false, wait: PENALTY_MS / 1000 } : { ok: false, left: MAX_ATTEMPTS - n };
  }

  await chrome.storage.session.set({
    unlocked: true,
    attempts: 0,
    blockedUntil: 0,
    lastActivity: Date.now(),
    startupGrace: false
  });

  const { savedTabs } = await chrome.storage.session.get('savedTabs');
  const list = normalizeSaved(savedTabs);
  const restoredIds = new Set();
  const missed = [];

  for (const item of list) {
    if (!Number.isFinite(item.id)) {
      missed.push(item.url);
      continue;
    }
    try {
      await chrome.tabs.update(item.id, { url: item.url });
      restoredIds.add(item.id);
    } catch (e) {
      missed.push(item.url);
    }
  }

  const allTabs = await chrome.tabs.query({});
  const lockTabs = allTabs.filter((t) => tabUrl(t).startsWith(LOCK_URL) && !restoredIds.has(t.id));

  let i = 0;
  for (const tab of lockTabs) {
    if (i < missed.length) {
      await chrome.tabs.update(tab.id, { url: missed[i++] }).catch(() => {});
    } else if (!isBlank(tabUrl(tab))) {
      await chrome.tabs.update(tab.id, { url: 'chrome://newtab/' }).catch(() => {});
    }
  }
  while (i < missed.length) {
    await chrome.tabs.create({ url: missed[i++], active: false }).catch(() => {});
  }

  await chrome.storage.session.remove('savedTabs');
  return { ok: true };
}

/* ---------- idle timer ---------- */
function ensureAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === STARTUP_ALARM) {
    await chrome.storage.session.set({ startupGrace: false });
    await lock({ forceBlank: true });
    return;
  }
  if (a.name !== ALARM) return;
  const s = await getSettings();
  if (!s.hash) return;
  if (await isLocked()) return enforceAll();

  const { lastActivity } = await chrome.storage.session.get('lastActivity');
  if (!lastActivity) return touch();
  if (Date.now() - lastActivity >= Math.max(1, s.timeoutMinutes) * 60000) await lockImmediate();
});

chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(async (state) => {
  const s = await getSettings();
  if (!s.hash) return;
  if (state === 'locked') await lockImmediate();
  else if (state === 'active' && !(await isLocked())) await touch();
});

/* ---------- lifecycle ---------- */
let booting = null;
async function boot() {
  if (booting) return booting;
  booting = (async () => {
    ensureAlarm();
    const s = await getSettings();
    if (!s.hash) { chrome.runtime.openOptionsPage(); return; }

    const { booted } = await chrome.storage.session.get('booted');
    if (booted) return;
    await chrome.storage.session.set({ booted: true, unlocked: false, startupGrace: true });
    chrome.alarms.create(STARTUP_ALARM, { when: Date.now() + 4000 });
  })();
  try { await booting; } finally { booting = null; }
}
boot();

chrome.runtime.onStartup.addListener(boot);
chrome.runtime.onInstalled.addListener(boot);

/* ---------- keep locked ---------- */
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id || !(await isLocked())) return;
  const url = tabUrl(tab);
  if (isRestorable(url)) await rememberTab(tab.id, url);
  if (await inGrace()) return;
  redirect(tab.id);
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url && info.status !== 'loading' && info.status !== 'complete') return;
  const url = info.url || tab.pendingUrl || tab.url || '';
  if (!(await isLocked())) {
    await touch();
    return;
  }
  if (isAllowed(url)) return;
  if (isRestorable(url)) await rememberTab(tabId, url);
  if (await inGrace()) {
    const finalUrl = tab.url || url;
    if (info.status === 'complete' && isRestorable(finalUrl)) redirect(tabId);
    return;
  }
  redirect(tabId);
});
chrome.tabs.onActivated.addListener(async () => {
  if (await isLocked()) enforceAll(); else await touch();
});
chrome.windows.onCreated.addListener(async () => {
  if (await isLocked()) enforceAll();
});
chrome.windows.onFocusChanged.addListener(async (id) => {
  if (id === chrome.windows.WINDOW_ID_NONE) return;
  if (await isLocked()) enforceAll(); else await touch();
});

chrome.action.onClicked.addListener(() => { lockImmediate(); });
chrome.commands.onCommand.addListener((c) => { if (c === 'lock-now') lockImmediate(); });

/* ---------- messages ---------- */
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  (async () => {
    const s = await getSettings();
    switch (msg.type) {
      case 'activity':
        if (!(await isLocked())) await touch();
        return sendResponse({ ok: true });

      case 'status':
        return sendResponse({
          locked: await isLocked(),
          hasPassword: !!s.hash,
          timeoutMinutes: s.timeoutMinutes
        });

      case 'createPassword': {
        if (s.hash) return sendResponse({ ok: false, error: 'Password is already set.' });
        if (!msg.password || msg.password.length < 4)
          return sendResponse({ ok: false, error: 'Minimum 4 characters.' });
        await setPassword(msg.password);
        await chrome.storage.session.set({ booted: true, unlocked: true, startupGrace: false });
        await touch();
        return sendResponse({ ok: true });
      }

      case 'changePassword': {
        if (await isLocked()) return sendResponse({ ok: false, error: 'Unlock Chrome first.' });
        if (!(await verifyPassword(String(msg.current || ''))))
          return sendResponse({ ok: false, error: 'Current password is incorrect.' });
        if (!msg.password || msg.password.length < 4)
          return sendResponse({ ok: false, error: 'Minimum 4 characters.' });
        await setPassword(msg.password);
        return sendResponse({ ok: true });
      }

      case 'unlock':
        return sendResponse(await unlock(String(msg.password || '')));

      case 'setTimeout': {
        if (await isLocked()) return sendResponse({ ok: false, error: 'Unlock Chrome first.' });
        const m = Number(msg.minutes);
        if (!Number.isFinite(m) || m < 1 || m > 1440)
          return sendResponse({ ok: false, error: 'Allowed range is 1 to 1440 minutes.' });
        await saveSettings({ timeoutMinutes: Math.round(m) });
        await touch();
        return sendResponse({ ok: true });
      }

      case 'lockNow':
        return sendResponse(await lockImmediate());

      case 'openOptions':
        chrome.runtime.openOptionsPage();
        return sendResponse({ ok: true });
    }
    sendResponse({ ok: false });
  })();
  return true;
});
