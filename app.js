// Клиент без сборки, синтаксис с оглядкой на EdgeHTML (Windows 10 Mobile):
// никаких ?. и ?? и прочих новинок.

var db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

var me = null;        // вошедший пользователь
var myProfile = null; // его строка из profiles
var current = null;   // профиль того, с кем открыт чат
var rows = [];        // строки таблицы contacts, где участвую я
var profiles = {};    // id -> профиль, для всех, кто есть в контактах
var shown = {};       // id сообщений, которые уже есть на экране
var registerMode = false;

function $(id) {
  return document.getElementById(id);
}

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function showScreen(id) {
  var all = document.querySelectorAll('.screen');
  for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
  $(id).classList.add('active');
}

var STATUSES = { online: 'в сети', away: 'нет на месте', busy: 'не беспокоить' };

function statusText(s) {
  return STATUSES[s] || '';
}

function nameOf(p) {
  return p.display_name || p.username;
}

// Строка человека: аватарка, имя, логин. Кнопки добавляет вызывающий код.
function personRow(p) {
  var row = el('div', 'person');
  row.appendChild(el('div', 'ava', nameOf(p).charAt(0).toUpperCase()));
  var info = el('div', 'info');
  info.appendChild(el('div', 'name', nameOf(p)));
  var status = statusText(p.status);
  info.appendChild(el('div', 'login', '@' + p.username + (status ? ' - ' + status : '')));
  row.appendChild(info);
  return row;
}

function button(text, cls, onclick) {
  var b = el('button', 'act ' + (cls || ''), text);
  b.onclick = function (e) {
    e.stopPropagation();
    onclick();
  };
  return b;
}

/* ===== вход и регистрация ===== */

function setMode(register) {
  registerMode = register;
  $('username').style.display = register ? 'block' : 'none';
  $('authBtn').textContent = register ? 'Создать аккаунт' : 'Войти';
  $('authSwitch').textContent = register ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
  $('authErr').textContent = '';
}

function authError(err) {
  var text = err.message || '';
  if (text.indexOf('Email not confirmed') !== -1) return 'Почта не подтверждена';
  if (text.indexOf('Invalid login') !== -1) return 'Неверная почта или пароль';
  return text || 'Не получилось войти';
}

async function signUp(email, pass, login) {
  var res = await db.auth.signUp({ email: email, password: pass });
  if (res.error) return authError(res.error);
  if (!res.session) return 'Подтверди почту по ссылке из письма и войди';

  var saved = await db.from('profiles').insert({
    id: res.user.id,
    username: login,
    display_name: login
  });
  if (saved.error) return 'Такой логин уже занят';

  startApp(res.user);
  return '';
}

async function signIn(email, pass) {
  var res = await db.auth.signIn({ email: email, password: pass });
  if (res.error) return authError(res.error);
  startApp(res.user);
  return '';
}

$('authSwitch').onclick = function () {
  setMode(!registerMode);
};

$('authBtn').onclick = async function () {
  var email = $('email').value.trim();
  var pass = $('password').value;
  var login = $('username').value.trim().toLowerCase();
  var problem;

  if (registerMode && !/^[a-z0-9_]{3,20}$/.test(login)) {
    $('authErr').textContent = 'Логин: 3-20 символов, латиница, цифры и _';
    return;
  }

  try {
    problem = registerMode ? await signUp(email, pass, login) : await signIn(email, pass);
  } catch (e) {
    problem = 'Нет связи с сервером';
  }
  $('authErr').textContent = problem;
};

$('logout').onclick = async function () {
  await db.auth.signOut();
  location.reload();
};

/* ===== контакты ===== */

async function startApp(user) {
  me = user;
  var res = await db.from('profiles').select('*').eq('id', me.id);
  if (res.data && res.data[0]) {
    myProfile = res.data[0];
    $('meName').textContent = nameOf(myProfile);
  }

  await loadContacts();
  listenMessages();
  showScreen('main');
}

// Кто мне пишет или кому пишу я, по строке contacts
function otherId(row) {
  return row.from_id === me.id ? row.to_id : row.from_id;
}

async function loadContacts() {
  var res = await db.from('contacts').select('*')
    .or('from_id.eq.' + me.id + ',to_id.eq.' + me.id);
  rows = res.data || [];

  var ids = rows.map(otherId);
  if (ids.length) {
    var people = await db.from('profiles').select('*').in('id', ids);
    (people.data || []).forEach(function (p) { profiles[p.id] = p; });
  }
  drawContacts();
}

async function answerRequest(row, accept) {
  if (accept) {
    await db.from('contacts').update({ accepted: true }).eq('id', row.id);
  } else {
    await db.from('contacts').delete().eq('id', row.id);
  }
  loadContacts();
}

function drawContacts() {
  var requests = $('requests');
  var friends = $('friends');
  requests.innerHTML = '';
  friends.innerHTML = '';

  var incoming = rows.filter(function (r) { return !r.accepted && r.to_id === me.id; });
  var accepted = rows.filter(function (r) { return r.accepted; });

  if (incoming.length) {
    requests.appendChild(el('div', 'section', 'Хотят добавить вас (' + incoming.length + ')'));
    incoming.forEach(function (r) {
      var p = profiles[r.from_id];
      if (!p) return;
      var row = personRow(p);
      row.appendChild(button('Принять', 'main', function () { answerRequest(r, true); }));
      row.appendChild(button('Отклонить', '', function () { answerRequest(r, false); }));
      requests.appendChild(row);
    });
  }

  if (!accepted.length) {
    friends.appendChild(el('div', 'empty', 'Контактов пока нет. Найди людей на вкладке «Поиск».'));
    return;
  }
  friends.appendChild(el('div', 'section', 'Контакты (' + accepted.length + ')'));
  accepted.forEach(function (r) {
    var p = profiles[otherId(r)];
    if (!p) return;
    var row = personRow(p);
    row.onclick = function () { openChat(p); };
    friends.appendChild(row);
  });
}

/* ===== поиск людей ===== */

// Что у меня с этим человеком: friend, sent, incoming или none
function relationTo(id) {
  for (var i = 0; i < rows.length; i++) {
    if (otherId(rows[i]) !== id) continue;
    if (rows[i].accepted) return 'friend';
    return rows[i].from_id === me.id ? 'sent' : 'incoming';
  }
  return 'none';
}

async function addContact(p) {
  await db.from('contacts').insert({ from_id: me.id, to_id: p.id });
  await loadContacts();
  search($('q').value);
}

async function search(text) {
  var q = text.replace(/[,()%*]/g, '').trim().toLowerCase();
  var box = $('found');
  box.innerHTML = '';

  if (q.length < 2) {
    box.appendChild(el('div', 'empty', 'Введи имя или логин, минимум 2 буквы'));
    return;
  }

  var res = await db.from('profiles').select('*')
    .neq('id', me.id)
    .or('username.ilike.*' + q + '*,display_name.ilike.*' + q + '*')
    .limit(20);
  var list = res.data || [];

  if (!list.length) {
    box.appendChild(el('div', 'empty', 'Никого не нашли'));
    return;
  }
  list.forEach(function (p) {
    var row = personRow(p);
    var state = relationTo(p.id);
    if (state === 'none') {
      row.appendChild(button('Добавить', 'main', function () { addContact(p); }));
    } else if (state === 'sent') {
      row.appendChild(el('span', 'note', 'запрос отправлен'));
    } else if (state === 'incoming') {
      row.appendChild(el('span', 'note', 'ждёт ответа'));
    } else {
      row.appendChild(el('span', 'note', 'в контактах'));
      row.onclick = function () { openChat(p); };
    }
    box.appendChild(row);
  });
}

var searchTimer;
$('q').oninput = function () {
  var text = this.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () { search(text); }, 300);
};

/* ===== вкладки ===== */

var tabButtons = document.querySelectorAll('#tabs button');
for (var i = 0; i < tabButtons.length; i++) {
  tabButtons[i].onclick = function () {
    var name = this.getAttribute('data-tab');
    for (var j = 0; j < tabButtons.length; j++) {
      var on = tabButtons[j] === this;
      tabButtons[j].classList.toggle('on', on);
      $('tab-' + tabButtons[j].getAttribute('data-tab')).classList.toggle('on', on);
    }
    if (name === 'search') search($('q').value);
  };
}

/* ===== чат ===== */

async function openChat(p) {
  current = p;
  shown = {};
  $('chatName').textContent = nameOf(p);
  $('msgs').innerHTML = '';
  showScreen('chat');

  var mine = 'and(sender.eq.' + me.id + ',receiver.eq.' + p.id + ')';
  var theirs = 'and(sender.eq.' + p.id + ',receiver.eq.' + me.id + ')';
  var res = await db.from('messages').select('*')
    .or(mine + ',' + theirs)
    .order('created_at');
  (res.data || []).forEach(addMessage);
}

function addMessage(m) {
  if (shown[m.id]) return;
  shown[m.id] = true;

  var box = $('msgs');
  box.appendChild(el('div', 'm ' + (m.sender === me.id ? 'me' : 'him'), m.body));
  box.scrollTop = box.scrollHeight;
}

async function sendMessage() {
  var text = $('text').value.trim();
  if (!text || !current) return;
  $('text').value = '';

  var res = await db.from('messages').insert({
    sender: me.id,
    receiver: current.id,
    body: text
  });
  if (res.data && res.data[0]) addMessage(res.data[0]);
}

function listenMessages() {
  db.from('messages').on('INSERT', function (payload) {
    var m = payload['new'];
    if (m.receiver === me.id && current && m.sender === current.id) addMessage(m);
  }).subscribe();
}

$('sendBtn').onclick = sendMessage;
$('text').onkeydown = function (e) {
  if (e.keyCode === 13) sendMessage();
};
$('back').onclick = function () {
  current = null;
  showScreen('main');
};

/* ===== профиль ===== */

function openProfile() {
  if (!myProfile) return;
  $('pName').value = myProfile.display_name || '';
  $('pLogin').value = myProfile.username;
  $('pStatus').value = myProfile.status || 'online';
  $('profileErr').textContent = '';
  showScreen('profile');
}

async function saveProfile() {
  var name = $('pName').value.trim();
  var login = $('pLogin').value.trim().toLowerCase();

  if (!name) {
    $('profileErr').textContent = 'Введи имя';
    return;
  }
  if (!/^[a-z0-9_]{3,20}$/.test(login)) {
    $('profileErr').textContent = 'Логин: 3-20 символов, латиница, цифры и _';
    return;
  }

  var res = await db.from('profiles')
    .update({ display_name: name, username: login, status: $('pStatus').value })
    .eq('id', me.id);
  if (res.error || !res.data || !res.data[0]) {
    $('profileErr').textContent = 'Такой логин уже занят';
    return;
  }

  myProfile = res.data[0];
  $('meName').textContent = nameOf(myProfile);
  showScreen('main');
}

$('openProfile').onclick = openProfile;
$('profileSave').onclick = saveProfile;
$('profileBack').onclick = function () {
  showScreen('main');
};

/* ===== запуск ===== */

setMode(false);
var saved = db.auth.session();
if (saved && saved.user) startApp(saved.user);
