const LOCK_URL = chrome.runtime.getURL('lock.html');
const OPTIONS_URL = chrome.runtime.getURL('options.html');
const ALARM = 'lock-watchdog';
const DEFAULTS = { timeoutMinutes: 10, hash: null, salt: null, iterations: 150000 };
const MAX_ATTEMPTS = 5;
const PENALTY_MS = 30000;

/* ---------- настройки ---------- */
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}
async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/* ---------- пароль: PBKDF2 ---------- */
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

/* ---------- состояние ---------- */
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
  chrome.tabs.update(tabId, { url }).catch(() => {});
}
function isAllowed(url) {
  return url.startsWith(LOCK_URL) || url.startsWith(OPTIONS_URL);
}

/* ---------- блокировка ---------- */
async function lock() {
  const s = await getSettings();
  if (!s.hash) { chrome.runtime.openOptionsPage(); return; }

  const already = await isLocked();
  await chrome.storage.session.set({ unlocked: false, attempts: 0, blockedUntil: 0 });
  if (already) return enforceAll();

  const tabs = await chrome.tabs.query({});
  const { savedTabs: existingSaved = {} } = await chrome.storage.session.get('savedTabs');
  const saved = { ...existingSaved };

  for (const t of tabs) {
    if (!t.id) continue;
    const url = t.pendingUrl || t.url || '';
    if (url.startsWith(LOCK_URL)) continue;
    if (/^(https?|file|ftp):/i.test(url)) saved[t.id] = url;
    redirect(t.id);
  }
  await chrome.storage.session.set({ savedTabs: saved });
}

async function enforceAll() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const url = t.pendingUrl || t.url || '';
    if (t.id && !url.startsWith(LOCK_URL)) redirect(t.id);
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

  // 1. Устанавливаем статус разблокировки
  await chrome.storage.session.set({ unlocked: true, attempts: 0, blockedUntil: 0 });
  await touch();

  // 2. Восстанавливаем оригинальные URL вкладок
  const { savedTabs } = await chrome.storage.session.get('savedTabs');
  if (savedTabs) {
    for (const [id, url] of Object.entries(savedTabs)) {
      redirect(Number(id), url);
    }
    await chrome.storage.session.remove('savedTabs');
  }

  return { ok: true };
}

/* ---------- таймер простоя ---------- */
function ensureAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARM) return;
  const s = await getSettings();
  if (!s.hash) return;
  if (await isLocked()) return enforceAll();

  const { lastActivity } = await chrome.storage.session.get('lastActivity');
  if (!lastActivity) return touch();
  if (Date.now() - lastActivity >= Math.max(1, s.timeoutMinutes) * 60000) await lock();
});

chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(async (state) => {
  const s = await getSettings();
  if (!s.hash) return;
  if (state === 'locked') await lock();
  else if (state === 'active' && !(await isLocked())) await touch();
});

/* ---------- жизненный цикл ---------- */
async function boot() {
  ensureAlarm();
  const s = await getSettings();
  if (!s.hash) { chrome.runtime.openOptionsPage(); return; }

  const { booted } = await chrome.storage.session.get('booted');
  if (booted) return;
  await chrome.storage.session.set({ booted: true, unlocked: false });
  await lock();
}
boot();

chrome.runtime.onStartup.addListener(boot);
chrome.runtime.onInstalled.addListener(boot);

/* ---------- удержание блокировки ---------- */
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id && await isLocked()) redirect(tab.id);
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url && info.status !== 'loading') return;
  const url = info.url || tab.pendingUrl || tab.url || '';
  if (await isLocked()) {
    if (!isAllowed(url)) redirect(tabId);
  } else await touch();
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

chrome.action.onClicked.addListener(() => lock());
chrome.commands.onCommand.addListener((c) => { if (c === 'lock-now') lock(); });

/* ---------- сообщения ---------- */
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
        if (s.hash) return sendResponse({ ok: false, error: 'Пароль уже задан.' });
        if (!msg.password || msg.password.length < 4)
          return sendResponse({ ok: false, error: 'Минимум 4 символа.' });
        await setPassword(msg.password);
        await chrome.storage.session.set({ booted: true, unlocked: true });
        await touch();
        return sendResponse({ ok: true });
      }

      case 'changePassword': {
        if (await isLocked()) return sendResponse({ ok: false, error: 'Сначала разблокируйте Chrome.' });
        if (!(await verifyPassword(String(msg.current || ''))))
          return sendResponse({ ok: false, error: 'Текущий пароль неверный.' });
        if (!msg.password || msg.password.length < 4)
          return sendResponse({ ok: false, error: 'Минимум 4 символа.' });
        await setPassword(msg.password);
        return sendResponse({ ok: true });
      }

      case 'unlock':
        return sendResponse(await unlock(String(msg.password || '')));

      case 'setTimeout': {
        if (await isLocked()) return sendResponse({ ok: false, error: 'Сначала разблокируйте Chrome.' });
        const m = Number(msg.minutes);
        if (!Number.isFinite(m) || m < 1 || m > 1440)
          return sendResponse({ ok: false, error: 'Допустимо от 1 до 1440 минут.' });
        await saveSettings({ timeoutMinutes: Math.round(m) });
        await touch();
        return sendResponse({ ok: true });
      }

      case 'lockNow':
        await lock();
        return sendResponse({ ok: true });

      case 'openOptions':
        chrome.runtime.openOptionsPage();
        return sendResponse({ ok: true });
    }
    sendResponse({ ok: false });
  })();
  return true;
});