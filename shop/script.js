// /shop/script.js
let allShopItems = [];
let iconMap = {};
let iconList = [];
let fuseInstance = null;
let selectedIconUrl = '/img/dirt.png';
let selectedIconName = '泥土（默认）';
let currentSort = 'latest';
let currentUser = '';          // 当前登录玩家ID
let currentToken = '';         // 当前登录token

// DOM 引用
const grid = document.getElementById('cardGrid');
const countEl = document.getElementById('itemCount');
const form = document.getElementById('publishForm');
const nameInput = document.getElementById('itemName');
const priceInput = document.getElementById('itemPrice');
const qtyInput = document.getElementById('itemQty');
const sellerInput = document.getElementById('itemSeller');
const iconSearch = document.getElementById('iconSearch');
const iconDropdown = document.getElementById('iconDropdown');
const iconPreviewImg = document.getElementById('selectedIconImg');
const iconPreviewName = document.getElementById('selectedIconName');
const hiddenIconUrl = document.getElementById('selectedIconUrl');
const submitBtn = document.getElementById('submitBtn');

// ========== 读取登录信息 ==========
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

function loadLoginInfo() {
  currentUser = getCookie('player_username');
  currentToken = getCookie('player_token');
}

// ========== 加载图标库 ==========
async function loadIcons() {
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
    const names = [];
    lines.forEach(url => {
      const parts = url.split('/');
      const filename = parts[parts.length - 1];
      const name = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      map[name] = url;
      names.push(name);
    });
    iconMap = map;
    iconList = names;
    fuseInstance = new Fuse(names, {
      includeScore: false,
      threshold: 0.3,
      minMatchCharLength: 1,
    });
    console.log(`已加载 ${names.length} 个图标`);
  } catch (err) {
    console.warn('图标加载失败，使用默认', err);
  }
}

// ========== 搜索图标（下拉） ==========
function searchIcons(query) {
  if (!query.trim()) {
    iconDropdown.classList.remove('show');
    return;
  }
  const results = fuseInstance.search(query.trim());
  const matches = results.slice(0, 10).map(r => r.item);
  if (matches.length === 0) {
    iconDropdown.innerHTML = `<div class="icon-option" style="color:#6a655a;justify-content:center;">没找到</div>`;
    iconDropdown.classList.add('show');
    return;
  }
  let html = '';
  matches.forEach(name => {
    const url = iconMap[name];
    html += `
      <div class="icon-option" data-name="${name}" data-url="${url}">
        <img src="${url}" alt="${name}" loading="lazy" onerror="this.style.display='none'">
        <span>${name}</span>
      </div>
    `;
  });
  iconDropdown.innerHTML = html;
  iconDropdown.classList.add('show');
}

iconDropdown.addEventListener('click', function(e) {
  const option = e.target.closest('.icon-option');
  if (!option) return;
  const name = option.dataset.name;
  const url = option.dataset.url;
  if (name && url) {
    selectedIconName = name;
    selectedIconUrl = url;
    iconSearch.value = name;
    iconPreviewImg.src = url;
    iconPreviewImg.onerror = function() { this.src = '/img/dirt.png'; };
    iconPreviewName.textContent = name;
    hiddenIconUrl.value = url;
    iconDropdown.classList.remove('show');
  }
});

iconSearch.addEventListener('input', function() {
  searchIcons(this.value);
});
iconSearch.addEventListener('blur', function() {
  setTimeout(() => iconDropdown.classList.remove('show'), 200);
});

// ========== 渲染商品卡片（含删除按钮） ==========
function renderItems(items) {
  if (!items || items.length === 0) {
    grid.innerHTML = `<div class="empty-state">集市还空着，你是第一个敢吃螃蟹的</div>`;
    countEl.textContent = '摆摊：0 件';
    return;
  }

  let sorted = [...items];
  switch (currentSort) {
    case 'latest':
      sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      break;
    case 'price-asc':
      sorted.sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      sorted.sort((a, b) => b.price - a.price);
      break;
  }

  let html = '';
  sorted.forEach((item) => {
    const rot = (Math.random() * 3 - 1.5).toFixed(1);
    const icon = item.icon || '/img/dirt.png';
    // 判断是否显示删除按钮：当前登录用户且为该商品卖家
    const showDelete = currentUser && currentUser === item.seller && currentToken;
    const deleteBtn = showDelete
      ? `<button class="delete-btn" data-id="${item.id}" style="background:#ff4d4d;border:none;color:#fff;padding:0.2rem 0.8rem;border-radius:10px;cursor:pointer;font-size:0.7rem;font-weight:bold;">✕ 删除</button>`
      : '';

    html += `
      <div class="card-item" style="--rot:${rot}deg">
        <div class="top-row">
          <img src="${icon}" alt="" loading="lazy" onerror="this.style.display='none'">
          <span class="item-name">${escapeHtml(item.name)}</span>
        </div>
        <div class="seller">
          <span>👤 ${escapeHtml(item.seller || '匿名')}</span>
          <span class="qty">剩余 <span>${item.qty}</span> 个</span>
        </div>
        <div class="price">${item.price} 泥土</div>
        <div style="margin-top:0.5rem; text-align:right;">${deleteBtn}</div>
      </div>
    `;
  });
  grid.innerHTML = html;
  countEl.textContent = `摆摊：${items.length} 件`;

  // 给删除按钮绑定事件
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      const id = this.dataset.id;
      if (!confirm('确认删除这件商品吗？')) return;
      await deleteItem(id);
    });
  });
}

// ========== 删除商品 ==========
async function deleteItem(id) {
  try {
    const res = await fetch('/api/shop', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast('删除失败：' + (data.error || '未知错误'));
      return;
    }
    showToast('已下架');
    // 重新加载列表
    await fetchItems();
  } catch (err) {
    showToast('删除出错：' + err.message);
  }
}

// ========== 防 XSS ==========
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== 加载商品列表 ==========
async function fetchItems() {
  try {
    const url = currentUser ? `/api/shop?seller=${encodeURIComponent(currentUser)}` : '/api/shop';
    const res = await fetch(url);
    if (!res.ok) throw new Error('API 错误');
    const data = await res.json();
    allShopItems = data.items || [];
    renderItems(allShopItems);
  } catch (err) {
    console.error('加载商品失败', err);
    grid.innerHTML = `<div class="empty-state">加载失败，试试刷新</div>`;
  }
}

// ========== 提交表单 ==========
form.addEventListener('submit', async function(e) {
  e.preventDefault();
  const name = nameInput.value.trim();
  const price = parseInt(priceInput.value);
  const qty = parseInt(qtyInput.value);
  const seller = sellerInput.value.trim();
  const icon = hiddenIconUrl.value || '/img/dirt.png';

  if (!name || !price || !qty || !seller) {
    showToast('填全了再扔，别糊弄');
    return;
  }
  if (price < 1 || qty < 1) {
    showToast('数字至少 1 吧？');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '扔…';

  try {
    const res = await fetch('/api/shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price, qty, seller, icon })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '发布失败');
    showToast('扔进集市了，等着挨刀吧');
    form.reset();
    selectedIconUrl = '/img/dirt.png';
    selectedIconName = '泥土（默认）';
    iconPreviewImg.src = '/img/dirt.png';
    iconPreviewName.textContent = '泥土（默认）';
    hiddenIconUrl.value = '/img/dirt.png';
    iconSearch.value = '';
    await fetchItems();
  } catch (err) {
    showToast(`出事了：${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '扔进集市';
  }
});

// ========== Toast ==========
function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// ========== 排序按钮 ==========
document.querySelectorAll('.shop-sort .sort-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.shop-sort .sort-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentSort = this.dataset.sort;
    renderItems(allShopItems);
  });
});

// ========== 初始化 ==========
async function init() {
  loadLoginInfo();
  await loadIcons();
  await fetchItems();
  if (typeof rough !== 'undefined') {
    const formArea = document.getElementById('roughForm');
    if (formArea) {
      const rect = formArea.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = rect.width + 20;
      canvas.height = rect.height + 20;
      canvas.style.cssText = 'position:absolute;top:-10px;left:-10px;pointer-events:none;z-index:0;';
      formArea.style.position = 'relative';
      formArea.appendChild(canvas);
      const rc = rough.canvas(canvas);
      rc.rectangle(0, 0, canvas.width, canvas.height, {
        stroke: '#E85D04',
        strokeWidth: 2,
        roughness: 2.8,
        fill: 'transparent'
      });
    }
  }
}

init();