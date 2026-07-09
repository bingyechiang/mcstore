// /debug/script.js
const API_BASE = '/api/debug';
let token = null;

// DOM 引用
const loginPanel = document.getElementById('loginPanel');
const managePanel = document.getElementById('managePanel');
const loginBtn = document.getElementById('loginBtn');
const adminPassword = document.getElementById('adminPassword');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const totalCount = document.getElementById('totalCount');
const latestTime = document.getElementById('latestTime');
const tableBody = document.getElementById('tableBody');

const editModal = document.getElementById('editModal');
const editId = document.getElementById('editId');
const editName = document.getElementById('editName');
const editPrice = document.getElementById('editPrice');
const editQty = document.getElementById('editQty');
const editSeller = document.getElementById('editSeller');
const editIcon = document.getElementById('editIcon');
const saveEditBtn = document.getElementById('saveEditBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const editError = document.getElementById('editError');

const toastContainer = document.getElementById('toastContainer');

// ===== 工具函数 =====
function showToast(msg, isError = false) {
  const div = document.createElement('div');
  div.className = 'toast' + (isError ? ' error' : '');
  div.textContent = msg;
  toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ===== 登录 =====
loginBtn.addEventListener('click', async function() {
  const password = adminPassword.value.trim();
  if (!password) {
    loginError.textContent = '密码不能空';
    return;
  }
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = '开门中...';
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || '密码错误';
      return;
    }
    token = data.token;
    loginPanel.style.display = 'none';
    managePanel.style.display = 'block';
    loadItems();
    showToast('门开了，别乱翻');
  } catch (err) {
    loginError.textContent = '请求失败: ' + err.message;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '开门';
  }
});

adminPassword.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') loginBtn.click();
});

// ===== 登出 =====
logoutBtn.addEventListener('click', function() {
  token = null;
  managePanel.style.display = 'none';
  loginPanel.style.display = 'block';
  adminPassword.value = '';
  loginError.textContent = '';
  showToast('滚出去了');
});

// ===== 加载商品列表 =====
async function loadItems() {
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/items`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        showToast('登录已过期，重新登录', true);
        logoutBtn.click();
        return;
      }
      showToast(data.error || '加载失败', true);
      return;
    }
    renderTable(data.items);
    totalCount.textContent = data.items.length;
    if (data.items.length > 0) {
      const latest = data.items.reduce((a,b) => a.createdAt > b.createdAt ? a : b);
      const d = new Date(latest.createdAt);
      latestTime.textContent = d.toLocaleString();
    } else {
      latestTime.textContent = '-';
    }
  } catch (err) {
    showToast('加载失败: ' + err.message, true);
  }
}

refreshBtn.addEventListener('click', loadItems);

// ===== 渲染表格 =====
function renderTable(items) {
  if (!items || items.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6a655a;padding:2rem;">集市下面什么都没有，空的</td></tr>`;
    return;
  }
  let html = '';
  items.forEach(item => {
    html += `
      <tr>
        <td style="font-size:0.7rem;color:#6a655a;">${escapeHtml(item.id)}</td>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${item.price}</td>
        <td>${item.qty}</td>
        <td>${escapeHtml(item.seller)}</td>
        <td><img src="${escapeHtml(item.icon || '/img/dirt.png')}" class="item-icon" onerror="this.style.display='none'"></td>
        <td>
          <div class="action-btns">
            <button class="edit-btn" data-id="${item.id}">改</button>
            <button class="del-btn" data-id="${item.id}">删</button>
          </div>
        </td>
      </tr>
    `;
  });
  tableBody.innerHTML = html;

  // 绑定编辑按钮
  tableBody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.id;
      const item = items.find(i => i.id === id);
      if (item) openEditModal(item);
    });
  });

  // 绑定删除按钮
  tableBody.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.id;
      if (confirm('确定要删掉这件商品吗？')) {
        deleteItem(id, this);
      }
    });
  });
}

// ===== 打开编辑弹窗 =====
function openEditModal(item) {
  editId.value = item.id;
  editName.value = item.name;
  editPrice.value = item.price;
  editQty.value = item.qty;
  editSeller.value = item.seller;
  editIcon.value = item.icon || '';
  editError.textContent = '';
  editModal.style.display = 'flex';
  // 应用Rough.js描边（如果有）
  setTimeout(() => {
    if (typeof rough !== 'undefined') {
      const modalContent = document.getElementById('roughModal');
      if (modalContent) {
        const rect = modalContent.getBoundingClientRect();
        const canvas = document.createElement('canvas');
        canvas.width = rect.width + 20;
        canvas.height = rect.height + 20;
        canvas.style.cssText = 'position:absolute;top:-10px;left:-10px;pointer-events:none;z-index:0;';
        modalContent.style.position = 'relative';
        modalContent.appendChild(canvas);
        const rc = rough.canvas(canvas);
        rc.rectangle(0, 0, canvas.width, canvas.height, {
          stroke: '#E85D04',
          strokeWidth: 2,
          roughness: 2.8,
          fill: 'transparent'
        });
      }
    }
  }, 100);
}

// ===== 保存编辑 =====
saveEditBtn.addEventListener('click', async function() {
  const id = editId.value;
  const name = editName.value.trim();
  const price = parseInt(editPrice.value);
  const qty = parseInt(editQty.value);
  const seller = editSeller.value.trim();
  const icon = editIcon.value.trim();

  if (!name || name.length < 2) {
    editError.textContent = '商品名至少俩字';
    return;
  }
  if (!price || price < 1) {
    editError.textContent = '单价至少1';
    return;
  }
  if (!qty || qty < 1) {
    editError.textContent = '数量至少1';
    return;
  }
  if (!seller) {
    editError.textContent = '卖家不能空';
    return;
  }

  editError.textContent = '';
  saveEditBtn.disabled = true;
  saveEditBtn.textContent = '埋...';

  try {
    const res = await fetch(`${API_BASE}/items/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, price, qty, seller, icon })
    });
    const data = await res.json();
    if (!res.ok) {
      editError.textContent = data.error || '更新失败';
      return;
    }
    showToast('改好了');
    closeModal();
    loadItems();
  } catch (err) {
    editError.textContent = '请求失败: ' + err.message;
  } finally {
    saveEditBtn.disabled = false;
    saveEditBtn.textContent = '埋回去';
  }
});

// ===== 取消编辑 =====
cancelEditBtn.addEventListener('click', closeModal);

function closeModal() {
  editModal.style.display = 'none';
}

// 点击模态背景关闭
editModal.addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ===== 删除商品 =====
async function deleteItem(id, btnElement) {
  if (!token) return;
  btnElement.disabled = true;
  btnElement.textContent = '删...';
  try {
    const res = await fetch(`${API_BASE}/items/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || '删除失败', true);
      return;
    }
    showToast('已刨掉');
    loadItems();
  } catch (err) {
    showToast('删除失败: ' + err.message, true);
  } finally {
    btnElement.disabled = false;
    btnElement.textContent = '删';
  }
}

// ===== 初始化 =====
// 如果已存储token，自动登录？我们简单点，每次刷新都需要重新登录。
// 但可以尝试从localStorage恢复token，不过为了安全，我们每次手动登录。
