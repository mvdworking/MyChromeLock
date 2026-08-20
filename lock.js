const $ = (id) => document.getElementById(id);
const input = $('pw');
let unlockedView = false;

/* Block hotkeys and context menu on the lock screen */
window.addEventListener('keydown', (e) => {
  if (unlockedView) return;
  const typing = e.target === input && !e.ctrlKey && !e.altKey && !e.metaKey;
  if (e.key === 'Enter' && typing) return;
  if (e.key === 'Tab' || e.ctrlKey || e.altKey || e.metaKey || !typing) e.preventDefault();
}, true);
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
input.addEventListener('blur', () => { if (!unlockedView) setTimeout(() => input.focus(), 0); });

function showNoPassword() {
  unlockedView = true;
  $('title').textContent = 'No password set';
  $('sub').textContent = 'Set a password in the extension settings';
  input.style.display = 'none';
  $('go').style.display = 'none';
  $('setupLink').style.display = 'block';
}

function showUnlocked() {
  unlockedView = true;
  $('title').textContent = 'Unlocked';
  $('sub').textContent = 'You can open a new tab or close this one.';
  input.style.display = 'none';
  $('go').style.display = 'none';
  $('err').textContent = '';
}

async function init() {
  const s = await chrome.runtime.sendMessage({ type: 'status' });
  if (!s.hasPassword) return showNoPassword();
  if (!s.locked) return showUnlocked();
  input.focus();
}

$('openOpts').addEventListener('click', () =>
  chrome.runtime.sendMessage({ type: 'openOptions' }));

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (unlockedView) return;
  $('err').textContent = '';
  const r = await chrome.runtime.sendMessage({ type: 'unlock', password: input.value });
  input.value = '';

  if (r.ok) {
    // background.js will redirect this tab to the original URL
    return;
  }

  if (r.wait) {
    let left = r.wait;
    $('go').disabled = true;
    const tick = () => {
      $('err').textContent = 'Too many attempts. Wait ' + left + ' s.';
      if (left-- <= 0) { clearInterval(t); $('err').textContent = ''; $('go').disabled = false; }
    };
    tick();
    const t = setInterval(tick, 1000);
  } else {
    $('err').textContent = 'Wrong password. Attempts left: ' + r.left;
  }
  input.focus();
});

init();
