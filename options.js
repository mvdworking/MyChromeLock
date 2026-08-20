const $ = (id) => document.getElementById(id);
const say = (el, text, ok) => { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'bad'); };
let state = {};

async function init() {
  state = await chrome.runtime.sendMessage({ type: 'status' });
  $('mins').value = state.timeoutMinutes;
  $('currentWrap').style.display = state.hasPassword ? 'block' : 'none';
  if (!state.hasPassword) say($('pwMsg'), 'Задайте пароль, чтобы включить блокировку.', false);
  else if (state.locked) say($('pwMsg'), 'Chrome заблокирован. Сначала разблокируйте его.', false);
}

$('savePw').addEventListener('click', async () => {
  if ($('pw').value !== $('pw2').value) return say($('pwMsg'), 'Пароли не совпадают.', false);
  const type = state.hasPassword ? 'changePassword' : 'createPassword';
  const r = await chrome.runtime.sendMessage({ type, current: $('current').value, password: $('pw').value });
  if (!r.ok) return say($('pwMsg'), r.error || 'Не удалось сохранить.', false);
  $('current').value = $('pw').value = $('pw2').value = '';
  state.hasPassword = true;
  $('currentWrap').style.display = 'block';
  say($('pwMsg'), 'Пароль сохранён. Блокировка включена.', true);
});

$('saveMins').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'setTimeout', minutes: $('mins').value });
  say($('minsMsg'), r.ok ? 'Сохранено.' : (r.error || 'Не удалось сохранить.'), r.ok);
});

$('lockNow').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'lockNow' }));

init();
