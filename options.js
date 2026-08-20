const $ = (id) => document.getElementById(id);
const say = (el, text, ok) => { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'bad'); };
let state = {};

async function init() {
  try {
    state = await chrome.runtime.sendMessage({ type: 'status' }) || {};
  } catch (e) {
    state = {};
  }
  if ($('mins') && state.timeoutMinutes != null) $('mins').value = state.timeoutMinutes;
  if ($('currentWrap')) $('currentWrap').style.display = state.hasPassword ? 'block' : 'none';
  if (!state.hasPassword) say($('pwMsg'), 'Set a password to enable locking.', false);
  else if (state.locked) say($('pwMsg'), 'Chrome is locked. Unlock it first.', false);
}

$('savePw').addEventListener('click', async () => {
  if ($('pw').value !== $('pw2').value) return say($('pwMsg'), 'Passwords do not match.', false);
  const type = state.hasPassword ? 'changePassword' : 'createPassword';
  const r = await chrome.runtime.sendMessage({ type, current: $('current').value, password: $('pw').value });
  if (!r || !r.ok) return say($('pwMsg'), (r && r.error) || 'Could not save.', false);
  $('current').value = $('pw').value = $('pw2').value = '';
  state.hasPassword = true;
  $('currentWrap').style.display = 'block';
  say($('pwMsg'), 'Password saved. Locking is enabled.', true);
});

$('saveMins').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'setTimeout', minutes: $('mins').value });
  say($('minsMsg'), r && r.ok ? 'Saved.' : ((r && r.error) || 'Could not save.'), !!(r && r.ok));
});

$('lockNow').addEventListener('click', async () => {
  const btn = $('lockNow');
  btn.disabled = true;
  btn.textContent = 'Locking…';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'lockNow' });
    if (r && r.ok) {
      btn.textContent = 'Locked';
    } else {
      btn.disabled = false;
      btn.textContent = 'Lock now';
      alert((r && r.error) || 'Could not lock. Set a password first if you have not yet.');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Lock now';
    alert('Error: ' + (e.message || e));
  }
});

$('assignShortcut').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

init();
