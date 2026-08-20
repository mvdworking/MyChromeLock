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
  if (!state.hasPassword) say($('pwMsg'), 'Задайте пароль, чтобы включить блокировку.', false);
  else if (state.locked) say($('pwMsg'), 'Chrome заблокирован. Сначала разблокируйте его.', false);
}

$('savePw').addEventListener('click', async () => {
  if ($('pw').value !== $('pw2').value) return say($('pwMsg'), 'Пароли не совпадают.', false);
  const type = state.hasPassword ? 'changePassword' : 'createPassword';
  const r = await chrome.runtime.sendMessage({ type, current: $('current').value, password: $('pw').value });
  if (!r || !r.ok) return say($('pwMsg'), (r && r.error) || 'Не удалось сохранить.', false);
  $('current').value = $('pw').value = $('pw2').value = '';
  state.hasPassword = true;
  $('currentWrap').style.display = 'block';
  say($('pwMsg'), 'Пароль сохранён. Блокировка включена.', true);
});

$('saveMins').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'setTimeout', minutes: $('mins').value });
  say($('minsMsg'), r && r.ok ? 'Сохранено.' : ((r && r.error) || 'Не удалось сохранить.'), !!(r && r.ok));
});

$('lockNow').addEventListener('click', async () => {
  const btn = $('lockNow');
  btn.disabled = true;
  btn.textContent = 'Блокировка…';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'lockNow' });
    if (r && r.ok) {
      // После блокировки страница настроек будет перенаправлена на экран блокировки
      btn.textContent = 'Заблокировано';
    } else {
      btn.disabled = false;
      btn.textContent = 'Заблокировать сейчас';
      alert((r && r.error) || 'Не удалось заблокировать. Задайте пароль, если ещё не задан.');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Заблокировать сейчас';
    alert('Ошибка: ' + (e.message || e));
  }
});

init();
