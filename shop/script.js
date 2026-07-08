// ========== 全局状态 ==========
let allShopItems = [];
let iconMap = {};
let iconList = [];
let fuseInstance = null;
let selectedIconUrl = '/img/dirt.png';
let selectedIconName = '泥土（默认）';
let currentSort = 'latest';
let manageMode = false;

// DOM 引用
const grid = document.getElementById('cardGrid');
const countEl = document.getElementById('itemCount');
const form = document.getElementById('publishForm');
const nameInput = document.getElementById('itemName');
const priceInput = document.getElementById('itemPrice');
const qtyInput = document.getElementById('itemQty');
const sellerInput = document.getElementById('itemSeller');
const passwordInput = document.getElementById('itemPassword');
const iconSearch = document.getElementById('iconSearch');
const iconDropdown = document.getElementById('iconDropdown');
const iconPreviewImg = document.getElementById('selectedIconImg');
const iconPreviewName = document.getElementById('selectedIconName');
const hiddenIconUrl = document.getElementById('selectedIconUrl');
const submitBtn = document.getElementById('submitBtn');

const manageToggle = document.getElementById('manageToggle');
const managePanel = document.getElementById('managePanel');
const manageSeller = document.getElementById('manageSeller');
const managePassword = document.getElementById('managePassword');
const manageBtn = document.getElementById('manageBtn');
const manageResults = document.getElementById('manageResults');

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
      threshold: 0.3,
      minMatchCharLength: 1,
    });
  } catch (err) {
    console.warn('图标加载失败', err);
  }
}

// ========== 图标搜索 ==========
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

// ========== 渲染商品卡片 ==========
function renderItems(items) {
  if (!items || items.length === 0) {
    grid.innerHTML = `<div class="empty-state">集市还空着，你是第一个敢吃螃蟹的</div>`;
    countEl.textContent = '摆摊：0 件';
    return;
  }

  let sorted = [...items];
  switch (currentSort) {
    case 'latest': sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); break;
    case 'price-asc': sorted.sort((a, b) => a.price - b.price); break;
    case 'price-desc': sorted.sort((a, b) => b.price - a.price); break;
  }

  let html = '';
  sorted.forEach((item) => {
    const rot = (Math.random() * 3 - 1.5).toFixed(1);
    const icon = item.icon || '/img/dirt.png';
    html += `
      <div class="card-item" style="--rot:${rot}deg">
        <div class="top-row">
          <img src="${icon}" alt="" loading="lazy" onerror="this.style.display='none'">
          <span class="item-name">${escapeHtml(item.name)}</span>
        </div>
        <div class="seller">
          <span>${escapeHtml(item.seller || '匿名')}</span>
          <span class="qty">剩余 <span>${item.qty}</span> 个</span>
        </div>
        <div class="price">${item.price} 泥土</div>
      </div>
    `;
  });
  grid.innerHTML = html;
  countEl.textContent = `摆摊：${items.length} 件`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== 加载商品列表 ==========
async function fetchItems() {
  try {
    const res = await fetch('/api/shop');
    if (!res.ok) throw new Error('API 错误');
    const data = await res.json();
    allShopItems = data.items || [];
    renderItems(allShopItems);
  } catch (err) {
    console.error('加载商品失败', err);
    grid.innerHTML = `<div class="empty-state">加载失败，试试刷新</div>`;
  }
}

// ========== 发布商品 ==========
form.addEventListener('submit', async function(e) {
  e.preventDefault();
  const name = nameInput.value.trim();
  const price = parseInt(priceInput.value);
  const qty = parseInt(qtyInput.value);
  const seller = sellerInput.value.trim();
  const password = passwordInput.value.trim();
  const icon = hiddenIconUrl.value || '/img/dirt.png';

  if (!name || !price || !qty || !seller || !password) {
    showToast('填全了再扔，别糊弄');
    return;
  }
  if (password.length < 4) {
    showToast('管理密码至少4位');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '扔…';

  try {
    const res = await fetch('/api/shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price, qty, seller, icon, password })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || '发布失败');
      submitBtn.disabled = false;
      submitBtn.textContent = '扔进集市';
      return;
    }
    showToast('扔进集市了，密码记好，删货要用');
    form.reset();
    selectedIconUrl = '/img/dirt.png';
    selectedIconName = '泥土（默认）';
    iconPreviewImg.src = '/img/dirt.png';
    iconPreviewName.textContent = '泥土（默认）';
    hiddenIconUrl.value = '/img/dirt.png';
    iconSearch.value = '';
    await fetchItems();
  } catch (err) {
    showToast('出事了：' + err.message);
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

// ========== 排序 ==========
document.querySelectorAll('.shop-sort .sort-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.shop-sort .sort-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentSort = this.dataset.sort;
    renderItems(allShopItems);
  });
});

// ========== 管理面板折叠 ==========
manageToggle.addEventListener('click', function() {
  managePanel.classList.toggle('open');
  this.querySelector('.arrow').classList.toggle('open');
});

// ========== 管理：查询我的商品 ==========
manageBtn.addEventListener('click', async function() {
  const seller = manageSeller.value.trim();
  const password = managePassword.value.trim();

  if (!seller || !password) {
    manageResults.innerHTML = `<div class="error-msg">填全了再查</div>`;
    return;
  }
  if (password.length < 4) {
    manageResults.innerHTML = `<div class="error-msg">密码至少4位</div>`;
    return;
  }

  manageBtn.disabled = true;
  manageBtn.textContent = '翻…';

  try {
    // 用 POST 去查（复用同一个接口，传 action=manage）
    const res = await fetch('/api/shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'manage',
        seller: seller,
        password: password
      })
    });
    const data = await res.json();
    if (!res.ok) {
      manageResults.innerHTML = `<div class="error-msg">${data.error || '查询失败'}</div>`;
      return;
    }

    const myItems = data.items || [];
    if (myItems.length === 0) {
      manageResults.innerHTML = `<div class="empty-msg">你还没上过货，发一条吧</div>`;
      return;
    }

    let html = '';
    myItems.forEach(item => {
      html += `
        <div class="manage-item" data-id="${item.id}">
          <span>${escapeHtml(item.name)} × ${item.qty} 个 · ${item.price} 泥土</span>
          <button class="del-btn" data-id="${item.id}">下架</button>
        </div>
      `;
    });
    manageResults.innerHTML = html;

    // ===== 下架按钮事件 =====
    manageResults.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', async function() {
        const id = this.dataset.id;
        if (!confirm('确定下架这件商品？')) return;
        const delRes = await fetch('/api/shop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'delete',
            id: id,
            seller: seller,
            password: password
          })
        });
        const delData = await delRes.json();
        if (!delRes.ok) {
          showToast(delData.error || '下架失败');
          return;
        }
        showToast('已下架');
        // 刷新管理列表
        manageBtn.click();
        // 刷新主列表
        fetchItems();
      });
    });

  } catch (err) {
    manageResults.innerHTML = `<div class="error-msg">出错了：${err.message}</div>`;
  } finally {
    manageBtn.disabled = false;
    manageBtn.textContent = '翻我的摊';
  }
});

// ========== 初始化 ==========
async function init() {
  await loadIcons();
  await fetchItems();
  // Rough.js
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
