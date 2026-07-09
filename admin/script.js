// ===== 管理面板逻辑 =====

let currentItems = [];
let editingCell = null;

const keyInput = document.getElementById('adminKeyInput');
const keySubmitBtn = document.getElementById('keySubmitBtn');
const keyError = document.getElementById('keyError');
const keySection = document.getElementById('keySection');
const adminContent = document.getElementById('adminContent');
const tableBody = document.getElementById('tableBody');
const countEl = document.getElementById('itemCount');
const refreshBtn = document.getElementById('refreshBtn');

// 从 localStorage 读取已保存的密钥
const savedKey = localStorage.getItem('adminKey');

if (savedKey) {
  keyInput.value = savedKey;
  // 自动尝试解锁
  unlockAdmin(savedKey);
}

// ===== 解锁 =====
keySubmitBtn.addEventListener('click', function() {
  const key = keyInput.value.trim();
  if (!key) {
    keyError.textContent = '密钥不能为空';
    return;
  }
  unlockAdmin(key);
});

keyInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') keySubmitBtn.click();
});

async function unlockAdmin(key) {
  keyError.textContent = '验证中...';
  try {
    const res = await fetch('/api/admin', {
      headers: { 'x-admin-key': key }
    });
    if (!res.ok) {
      const data = await res.json();
      keyError.textContent = data.error || '密钥错误';
      return;
    }
    // 成功
    localStorage.setItem('adminKey', key);
    keyError.textContent = '';
    keySection.style.display = 'none';
    adminContent.style.display = 'block';
    await loadItems(key);
  } catch (err) {
    keyError.textContent = '请求失败: ' + err.message;
  }
}

// ===== 加载商品 =====
async function loadItems(key) {
  try {
    const res = await fetch('/api/admin', {
      headers: { 'x-admin-key': key }
    });
    if (!res.ok) throw new Error('加载失败');
    const data = await res.json();
    currentItems = data.items || [];
    renderTable(currentItems);
    countEl.textContent = `共 ${currentItems.length} 件商品`;
  } catch (err) {
    console.error('加载失败', err);
    tableBody.innerHTML = `<tr class="empty-row"><td colspan="7">加载失败，试试刷新</td></tr>`;
  }
}

// ===== 渲染表格 =====
function renderTable(items) {
  if (!items || items.length === 0) {
    tableBody.innerHTML = `<tr class="empty-row"><td colspan="7">货架空空如也</td></tr>`;
    return;
  }

  let html = '';
  items.forEach(item => {
    const icon = item.icon || '/img/dirt.png';
    html += `
      <tr data-id="${item.id}">
        <td><span class="editable" data-field="id" style="color:#6a655a;font-size:0.7rem;">${item.id}</span></td>
        <td><span class="editable" data-field="name">${escapeHtml(item.name)}</span></td>
        <td><span class="editable" data-field="price">${item.price}</span></td>
        <td><span class="editable" data-field="qty">${item.qty}</span></td>
        <td><span class="editable" data-field="seller">${escapeHtml(item.seller)}</span></td>
        <td>
          <img src="${icon}" class="cell-icon" loading="lazy" onerror="this.style.display='none'">
          <span class="editable" data-field="icon" style="display:none;">${icon}</span>
        </td>
        <td><button class="del-btn" data-id="${item.id}">删</button></td>
      </tr>
    `;
  });
  tableBody.innerHTML = html;

  // ===== 事件：点击单元格编辑 =====
  tableBody.querySelectorAll('.editable[data-field]').forEach(el => {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      startEditing(this);
    });
  });

  // ===== 事件：删除按钮 =====
  tableBody.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.id;
      if (!confirm('确定删除这件商品？')) return;
      deleteItem(id);
    });
  });
}

// ===== 编辑单元格 =====
function startEditing(el) {
  // 如果已有编辑中的单元格，先保存
  if (editingCell) finishEditing(editingCell);

  const field = el.dataset.field;
  const currentValue = el.textContent.trim();
  const tr = el.closest('tr');
  const id = tr.dataset.id;

  // 图标字段特殊处理：显示输入框让用户输入URL
  let input;
  if (field === 'icon') {
    input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    input.placeholder = '图标URL';
  } else {
    input = document.createElement('input');
    input.type = field === 'price' || field === 'qty' ? 'number' : 'text';
    input.value = currentValue;
    input.step = '1';
    input.min = '1';
  }

  el.textContent = '';
  el.appendChild(input);
  el.classList.add('editing');
  input.focus();
  input.select();

  editingCell = { el, field, id, input };

  // 按回车保存，按Esc取消
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing(editingCell);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing(editingCell);
    }
  });

  // 失焦自动保存
  input.addEventListener('blur', function() {
    if (editingCell) finishEditing(editingCell);
  });
}

async function finishEditing(cell) {
  if (!cell) return;
  const { el, field, id, input } = cell;
  const newValue = input.value.trim();
  editingCell = null;

  // 恢复显示
  el.classList.remove('editing');
  el.textContent = newValue || '(空)';

  // 构建更新数据
  const updateData = { id };
  let parsedValue;
  if (field === 'price' || field === 'qty') {
    parsedValue = parseInt(newValue);
    if (isNaN(parsedValue) || parsedValue < 1) {
      // 无效值，回滚
      await loadItems(localStorage.getItem('adminKey'));
      return;
    }
    updateData[field] = parsedValue;
  } else if (field === 'icon') {
    updateData[field] = newValue || '/img/dirt.png';
    // 刷新该行的图标预览
    const tr = el.closest('tr');
    const img = tr.querySelector('.cell-icon');
    if (img) img.src = updateData[field];
  } else {
    updateData[field] = newValue || '未命名';
  }

  // 如果值没变，不做请求
  const oldItem = currentItems.find(i => i.id === id);
  if (oldItem && oldItem[field] == updateData[field]) {
    return;
  }

  // 发送更新
  try {
    const key = localStorage.getItem('adminKey');
    const res = await fetch('/api/admin', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': key
      },
      body: JSON.stringify(updateData)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '更新失败');
    }
    // 刷新列表
    await loadItems(key);
  } catch (err) {
    console.error('更新失败', err);
    // 回滚
    await loadItems(localStorage.getItem('adminKey'));
  }
}

function cancelEditing(cell) {
  if (!cell) return;
  const { el, input } = cell;
  el.classList.remove('editing');
  el.textContent = input.defaultValue || input.value || '(空)';
  editingCell = null;
}

// ===== 删除商品 =====
async function deleteItem(id) {
  try {
    const key = localStorage.getItem('adminKey');
    const res = await fetch('/api/admin', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': key
      },
      body: JSON.stringify({ id })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '删除失败');
    }
    await loadItems(key);
  } catch (err) {
    console.error('删除失败', err);
    alert('删除失败: ' + err.message);
  }
}

// ===== 刷新按钮 =====
refreshBtn.addEventListener('click', function() {
  const key = localStorage.getItem('adminKey');
  if (key) loadItems(key);
});

// ===== 工具函数 =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Rough.js 描边 =====
window.addEventListener('load', function() {
  setTimeout(function() {
    if (typeof rough !== 'undefined') {
      const tableWrap = document.querySelector('.admin-table-wrap');
      if (tableWrap) {
        const rect = tableWrap.getBoundingClientRect();
        const canvas = document.createElement('canvas');
        canvas.width = rect.width + 20;
        canvas.height = rect.height + 20;
        canvas.style.cssText = 'position:absolute;top:-10px;left:-10px;pointer-events:none;z-index:0;';
        tableWrap.style.position = 'relative';
        tableWrap.appendChild(canvas);
        const rc = rough.canvas(canvas);
        rc.rectangle(0, 0, canvas.width, canvas.height, {
          stroke: '#E85D04',
          strokeWidth: 2,
          roughness: 2.8,
          fill: 'transparent'
        });
      }
    }
  }, 300);
});
