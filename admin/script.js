// 管理面板の逻辑

let currentItems = [];
let editingCell = null;
const DEFAULT_ICON = '/img/dirt.png';

// DOM 引用
const keyInput = document.getElementById('adminKeyInput');
const keySubmitBtn = document.getElementById('keySubmitBtn');
const keyError = document.getElementById('keyError');
const keySection = document.getElementById('keySection');
const adminContent = document.getElementById('adminContent');
const tableBody = document.getElementById('tableBody');
const countEl = document.getElementById('itemCount');
const refreshBtn = document.getElementById('refreshBtn');

// ===== 工具：安全加载图标 =====（这一行还是和之前一个bug）
function safeIcon(url) {
  if (!url) return DEFAULT_ICON;
  // 如果存的是名称，尝试从全局 iconMap 取 URL
  if (window.iconMap && window.iconMap[url]) {
    return window.iconMap[url];
  }
  // 如果链接不是 http 开头，也不是 / 开头，回退默认
  if (!url.startsWith('http') && !url.startsWith('/')) {
    return DEFAULT_ICON;
  }
  return url;
}

// 生成图片标签（带自动重试）
function iconImgTag(url, className = 'cell-icon') {
  const safeUrl = safeIcon(url);
  return `<img src="${safeUrl}" 
                class="${className}" 
                loading="lazy" 
                onerror="this.onerror=null; this.src='${safeUrl.replace(/^https:/, 'http:')}';"
                onload="this.style.display='block'" 
                style="display:inline-block;">`;
}

// 读取密钥
const savedKey = localStorage.getItem('adminKey');
if (savedKey) {
  keyInput.value = savedKey;
  unlockAdmin(savedKey);
}

// 解锁
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
    localStorage.setItem('adminKey', key);
    keyError.textContent = '';
    keySection.style.display = 'none';
    adminContent.style.display = 'block';
    await loadItems(key);
  } catch (err) {
    keyError.textContent = '请求失败: ' + err.message;
  }
}

// 查看商品
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

// 表格
function renderTable(items) {
  if (!items || items.length === 0) {
    tableBody.innerHTML = `<tr class="empty-row"><td colspan="7">货架空空如也</td></tr>`;
    return;
  }

  let html = '';
  items.forEach(item => {
    const iconHtml = iconImgTag(item.icon, 'cell-icon');
    html += `
      <tr data-id="${item.id}">
        <td><span class="editable" data-field="id" style="color:#6a655a;font-size:0.7rem;">${item.id}</span></td>
        <td><span class="editable" data-field="name">${escapeHtml(item.name)}</span></td>
        <td><span class="editable" data-field="price">${item.price}</span></td>
        <td><span class="editable" data-field="qty">${item.qty}</span></td>
        <td><span class="editable" data-field="seller">${escapeHtml(item.seller)}</span></td>
        <td>
          ${iconHtml}
          <span class="editable" data-field="icon" style="display:none;">${item.icon || ''}</span>
        </td>
        <td><button class="del-btn" data-id="${item.id}">删</button></td>
      </tr>
    `;
  });
  tableBody.innerHTML = html;

  // 点击单元格编辑
  tableBody.querySelectorAll('.editable[data-field]').forEach(el => {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      startEditing(this);
    });
  });

  // 删除按钮
  tableBody.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.id;
      if (!confirm('确定删除这件商品？')) return;
      deleteItem(id);
    });
  });
}

// 编辑单格
function startEditing(el) {
  if (editingCell) finishEditing(editingCell);

  const field = el.dataset.field;
  const currentValue = el.textContent.trim();
  const tr = el.closest('tr');
  const id = tr.dataset.id;

  let input;
  if (field === 'icon') {
    input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    input.placeholder = '图标URL或名称';
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

  input.addEventListener('blur', function() {
    if (editingCell) finishEditing(editingCell);
  });
}

async function finishEditing(cell) {
  if (!cell) return;
  const { el, field, id, input } = cell;
  const newValue = input.value.trim();
  editingCell = null;

  el.classList.remove('editing');
  el.textContent = newValue || '(空)';

  const updateData = { id };
  let parsedValue;
  if (field === 'price' || field === 'qty') {
    parsedValue = parseInt(newValue);
    if (isNaN(parsedValue) || parsedValue < 1) {
      await loadItems(localStorage.getItem('adminKey'));
      return;
    }
    updateData[field] = parsedValue;
  } else if (field === 'icon') {
    updateData[field] = newValue || DEFAULT_ICON;
    // 刷新该行的图标预览
    const tr = el.closest('tr');
    const img = tr.querySelector('.cell-icon');
    if (img) {
      const safeUrl = safeIcon(updateData[field]);
      img.src = safeUrl;
      img.onerror = function() {
        this.onerror = null;
        this.src = safeUrl.replace(/^https:/, 'http:');
      };
    }
  } else {
    updateData[field] = newValue || '未命名';
  }

  // 如果值没变，不请求
  const oldItem = currentItems.find(i => i.id === id);
  if (oldItem && oldItem[field] == updateData[field]) {
    return;
  }

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
    await loadItems(key);
  } catch (err) {
    console.error('更新失败', err);
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

// 删除
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

// 刷新
refreshBtn.addEventListener('click', function() {
  const key = localStorage.getItem('adminKey');
  if (key) loadItems(key);
});

//房xxs
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 图标
async function loadIconMap() {
  try {
    const [blockRes, itemRes] = await Promise.all([
      fetch('/icon/block.txt'),
      fetch('/icon/item.txt')
    ]);
    const blockText = await blockRes.text();
    const itemText = await itemRes.text();
    const lines = [...blockText.split('\n'), ...itemText.split('\n')]
      .map(line => line.trim())
      .filter(line => line.length > 0);
    const map = {};
    lines.forEach(url => {
      const parts = url.split('/');
      const filename = parts[parts.length - 1];
      const name = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      map[name] = url;
    });
    window.iconMap = map;
  } catch (err) {
    console.warn('图标映射加载失败，仅使用URL', err);
    window.iconMap = {};
  }
}

// rough.js（不想写了）
function applyRough() {
  if (typeof rough === 'undefined') return;
  const tableWrap = document.querySelector('.admin-table-wrap');
  if (!tableWrap) return;
  // 移除旧canvas
  const oldCanvas = tableWrap.querySelector('canvas');
  if (oldCanvas) oldCanvas.remove();

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

// 初始化
async function init() {
  await loadIconMap();
  // 如果有密钥且已解锁，加载数据
  const key = localStorage.getItem('adminKey');
  if (key && adminContent.style.display !== 'none') {
    await loadItems(key);
  }
  // 手绘描边
  setTimeout(applyRough, 500);
}

// 窗口resize重新描边
let resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyRough, 300);
});

init();
