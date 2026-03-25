const OWNER = 'kyudaimedjudo';
const REPO  = 'kyudai-judo';

// ===== 写真アップロード =====
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadPhoto(file, folder, slug) {
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `images/${folder}/${slug}.${ext}`;
  const base64 = await fileToBase64(file);

  // 既存ファイルのSHAを取得（上書き用）
  let sha = undefined;
  try {
    const existing = await ghGet(path);
    sha = existing.sha;
  } catch(e) {} // 新規の場合はそのまま

  const token = getToken();
  const body = { message: `写真追加: ${path}`, content: base64 };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `写真アップロード失敗: ${res.status}`);
  }
  return path;
}

// ===== GitHub API =====
async function ghGet(path) {
  const token = getToken();
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function ghPut(path, data, sha, message) {
  const token = getToken();
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, content, sha })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `PUT ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function loadJson(path) {
  const file = await ghGet(path);
  const json = JSON.parse(decodeURIComponent(escape(atob(file.content))));
  return { data: json, sha: file.sha };
}

// ===== トークン =====
function getToken() { return localStorage.getItem('gh_token') || ''; }
function saveToken(t) { localStorage.setItem('gh_token', t); }

// ===== フィードバック =====
function showMsg(msg, isError = false) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className = 'feedback ' + (isError ? 'error' : 'success');
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ===== 練習日誌 =====
async function addDiary(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { data, sha } = await loadJson('data/diary.json');
    data.unshift({
      date: document.getElementById('d-date').value,
      title: document.getElementById('d-title').value,
      content: document.getElementById('d-content').value
    });
    await ghPut('data/diary.json', data, sha, `練習日誌追加: ${document.getElementById('d-title').value}`);
    showMsg('練習日誌を追加しました');
    e.target.reset();
    refreshEditList();
  } catch(err) { showMsg(err.message, true); }
  finally { btn.disabled = false; }
}

// ===== 大会結果 =====
async function addResult(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { data, sha } = await loadJson('data/results.json');
    data.unshift({
      date: document.getElementById('r-date').value,
      tournament: document.getElementById('r-tournament').value,
      category: document.getElementById('r-category').value,
      result: document.getElementById('r-result').value,
      badge: document.getElementById('r-badge').value
    });
    await ghPut('data/results.json', data, sha, `大会結果追加: ${document.getElementById('r-tournament').value}`);
    showMsg('大会結果を追加しました');
    e.target.reset();
    refreshEditList();
  } catch(err) { showMsg(err.message, true); }
  finally { btn.disabled = false; }
}

// ===== 合宿・イベント =====
async function addEvent(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const title = document.getElementById('e-title').value;
    const slug = title.replace(/\s+/g, '-').replace(/[^\w\-]/g, '') || Date.now().toString();

    let photoPath = null;
    const photoFile = document.getElementById('e-photo').files[0];
    if (photoFile) {
      showMsg('写真をアップロード中...');
      photoPath = await uploadPhoto(photoFile, 'events', slug);
    }

    const { data, sha } = await loadJson('data/events.json');
    const entry = {
      date: document.getElementById('e-date').value,
      title,
      content: document.getElementById('e-content').value,
      emoji: document.getElementById('e-emoji').value || '📸'
    };
    if (photoPath) entry.photo = photoPath;
    data.unshift(entry);
    await ghPut('data/events.json', data, sha, `イベント追加: ${title}`);
    showMsg('イベントを追加しました');
    e.target.reset();
    refreshEditList();
  } catch(err) { showMsg(err.message, true); }
  finally { btn.disabled = false; }
}

// ===== 編集リスト（タブ4）=====
let cache = { diary: null, results: null, events: null, members: null };

async function refreshEditList() {
  cache = { diary: null, results: null, events: null, members: null };
  const activeFilter = document.querySelector('.edit-filter-tab.active')?.dataset.type || 'diary';
  loadEditSection(activeFilter);
}

async function loadEditSection(type) {
  const container = document.getElementById('edit-list');
  container.innerHTML = '<p class="loading">読み込み中...</p>';
  try {
    if (!cache[type]) cache[type] = await loadJson(`data/${type === 'members' ? 'members' : type === 'diary' ? 'diary' : type === 'results' ? 'results' : 'events'}.json`);
    const { data } = cache[type];
    renderEditList(type, data, container);
  } catch(err) {
    container.innerHTML = `<p class="edit-empty">読み込みエラー: ${err.message}</p>`;
  }
}

function renderEditList(type, data, container) {
  if (!data.length) { container.innerHTML = '<p class="edit-empty">データがありません</p>'; return; }

  const items = data.map((item, idx) => {
    let label = '';
    if (type === 'diary')   label = `<strong>${item.title}</strong> <span>${item.date}</span>`;
    if (type === 'results') label = `<strong>${item.tournament}</strong> ${item.category} <span>${item.date} / ${item.result}</span>`;
    if (type === 'events')  label = `<strong>${item.emoji} ${item.title}</strong> <span>${item.date}</span>`;
    if (type === 'members') label = `<strong>${item.name}</strong> <span>${item.year}${item.year === '院生' ? '' : '年'} ${item.belt || ''}</span>`;

    const editBtn = type === 'members'
      ? `<button class="edit-btn" onclick="openMemberEdit(${idx})">編集</button>`
      : '';

    return `
      <div class="edit-item">
        <div class="edit-item-label">${label}</div>
        <div class="edit-item-actions">
          ${editBtn}
          <button class="delete-btn" onclick="deleteItem('${type}', ${idx})">削除</button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = items;
}

// ===== 削除 =====
async function deleteItem(type, idx) {
  if (!confirm('本当に削除しますか？')) return;
  const path = `data/${type}.json`;
  try {
    const { data, sha } = await loadJson(path);
    const label = type === 'diary' ? data[idx].title : type === 'results' ? data[idx].tournament : type === 'events' ? data[idx].title : data[idx].name;
    data.splice(idx, 1);
    await ghPut(path, data, sha, `${label}を削除`);
    cache[type] = null;
    showMsg('削除しました');
    loadEditSection(type);
  } catch(err) { showMsg(err.message, true); }
}

// ===== 部員編集 =====
let editingMemberIdx = null;

async function openMemberEdit(idx) {
  if (!cache.members) cache.members = await loadJson('data/members.json');
  const m = cache.members.data[idx];
  editingMemberIdx = idx;
  document.getElementById('m-name').value    = m.name;
  document.getElementById('m-year').value    = m.year;
  document.getElementById('m-belt').value    = m.belt || '';
  document.getElementById('m-hometown').value = m.hometown || '';
  document.getElementById('m-school').value  = m.school || '';
  document.getElementById('m-comment').value = m.comment || '';
  document.getElementById('member-form-title').textContent = '部員を編集';
  document.getElementById('m-submit-btn').textContent = '更新する';
  document.getElementById('m-cancel-btn').style.display = 'inline-block';
  document.getElementById('member-form').scrollIntoView({ behavior: 'smooth' });
}

function cancelMemberEdit() {
  editingMemberIdx = null;
  document.getElementById('member-form').reset();
  document.getElementById('member-form-title').textContent = '部員を追加';
  document.getElementById('m-submit-btn').textContent = '追加する';
  document.getElementById('m-cancel-btn').style.display = 'none';
}

async function saveMember(e) {
  e.preventDefault();
  const btn = document.getElementById('m-submit-btn');
  btn.disabled = true;
  const id = document.getElementById('m-name').value.replace(/\s/g, '-');
  const entry = {
    id,
    name: document.getElementById('m-name').value,
    year: document.getElementById('m-year').value,
    belt: document.getElementById('m-belt').value,
    hometown: document.getElementById('m-hometown').value,
    school: document.getElementById('m-school').value,
    comment: document.getElementById('m-comment').value
  };

  // 既存の写真を引き継ぐ
  if (editingMemberIdx !== null && cache.members) {
    const existing = cache.members.data[editingMemberIdx];
    if (existing.photo) entry.photo = existing.photo;
  }

  try {
    const photoFile = document.getElementById('m-photo').files[0];
    if (photoFile) {
      showMsg('写真をアップロード中...');
      entry.photo = await uploadPhoto(photoFile, 'members', id);
    }

    const { data, sha } = await loadJson('data/members.json');
    const action = editingMemberIdx !== null ? '更新' : '追加';
    if (editingMemberIdx !== null) {
      data[editingMemberIdx] = entry;
    } else {
      data.push(entry);
    }
    await ghPut('data/members.json', data, sha, `部員${action}: ${entry.name}`);
    showMsg(`部員を${action}しました`);
    cancelMemberEdit();
    cache.members = null;
    loadEditSection('members');
  } catch(err) { showMsg(err.message, true); }
  finally { btn.disabled = false; }
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  // トークン復元
  const saved = getToken();
  if (saved) document.getElementById('token-input').value = saved;

  // トークン保存
  document.getElementById('token-save').addEventListener('click', () => {
    const t = document.getElementById('token-input').value.trim();
    if (!t) { showMsg('トークンを入力してください', true); return; }
    saveToken(t);
    showMsg('トークンを保存しました');
  });

  // メインタブ切替
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
      if (tab.dataset.target === 'panel-edit') loadEditSection('diary');
    });
  });

  // 編集タブ切替
  document.querySelectorAll('.edit-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.edit-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadEditSection(tab.dataset.type);
    });
  });

  // フォーム送信
  document.getElementById('diary-form').addEventListener('submit', addDiary);
  document.getElementById('result-form').addEventListener('submit', addResult);
  document.getElementById('event-form').addEventListener('submit', addEvent);
  document.getElementById('member-form').addEventListener('submit', saveMember);
  document.getElementById('m-cancel-btn').addEventListener('click', cancelMemberEdit);
});
