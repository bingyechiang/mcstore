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
    window.iconMap = map; // 暴露给全局
    fuseInstance = new Fuse(names, {
      threshold: 0.3,
      minMatchCharLength: 1,
    });
    console.log('已加载图标数量:', names.length);
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
        <img src="${url}" alt="${name}" loading="lazy" onerror="this.onerror=null; this.src='${url.replace(/^https:/, 'http:')}';">
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
    let iconUrl = item.icon || '/img/dirt.png';
    // 如果存的是名称，从映射取 URL
    if (window.iconMap && window.iconMap[iconUrl]) {
      iconUrl = window.iconMap[iconUrl];
    }
    // 确保是有效 URL
    if (!iconUrl.startsWith('http') && !iconUrl.startsWith('/')) {
      iconUrl = '/img/dirt.png';
    }
    const rot = (Math.random() * 3 - 1.5).toFixed(1);
    html += `
      <div class="card-item" style="--rot:${rot}deg">
        <div class="top-row">
          <img src="${iconUrl}" alt="" loading="lazy" onerror="this.onerror=null; this.src='${iconUrl.replace(/^https:/, 'http:')}';">
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
          <div class="manage-item-info">
            <span>${escapeHtml(item.name)} × ${item.qty} 个 · ${item.price} 泥土</span>
            <button class="del-btn" data-id="${item.id}">下架</button>
            <button class="edit-btn" data-id="${item.id}">编辑</button>
          </div>
          <div class="manage-edit-form" data-id="${item.id}" style="display:none; margin-top:0.5rem;">
            <div class="form-group"><input type="text" class="edit-name" value="${escapeHtml(item.name)}" placeholder="商品名"></div>
            <div class="form-group"><input type="number" class="edit-price" value="${item.price}" placeholder="单价" min="1"></div>
            <div class="form-group"><input type="number" class="edit-qty" value="${item.qty}" placeholder="数量" min="1"></div>
            <div class="form-group"><input type="text" class="edit-icon" value="${item.icon || ''}" placeholder="图标URL"></div>
            <button class="save-edit-btn" data-id="${item.id}">保存修改</button>
            <button class="cancel-edit-btn" data-id="${item.id}">取消</button>
          </div>
        </div>
      `;
    });
    manageResults.innerHTML = html;

    // 事件绑定：编辑/取消/保存（使用事件委托）
    manageResults.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = this.dataset.id;
        const formDiv = manageResults.querySelector(`.manage-edit-form[data-id="${id}"]`);
        if (formDiv) formDiv.style.display = 'block';
      });
    });

    manageResults.querySelectorAll('.cancel-edit-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = this.dataset.id;
        const formDiv = manageResults.querySelector(`.manage-edit-form[data-id="${id}"]`);
        if (formDiv) formDiv.style.display = 'none';
      });
    });

    manageResults.querySelectorAll('.save-edit-btn').forEach(btn => {
      btn.addEventListener('click', async function() {
        const id = this.dataset.id;
        const itemDiv = this.closest('.manage-item');
        const name = itemDiv.querySelector('.edit-name').value.trim();
        const price = parseInt(itemDiv.querySelector('.edit-price').value);
        const qty = parseInt(itemDiv.querySelector('.edit-qty').value);
        const icon = itemDiv.querySelector('.edit-icon').value.trim() || '/img/dirt.png';
        if (!name || !price || !qty) {
          showToast('请填完整');
          return;
        }
        const seller = manageSeller.value.trim();
        const password = managePassword.value.trim();
        if (!seller || !password) {
          showToast('请先输入卖家名和密码');
          return;
        }
        try {
          const res = await fetch('/api/shop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              id: id,
              name, price, qty, icon,
              seller, password
            })
          });
          const data = await res.json();
          if (!res.ok) {
            showToast(data.error || '更新失败');
            return;
          }
          showToast('修改成功');
          // 刷新管理列表
          manageBtn.click();
          // 刷新主列表
          fetchItems();
        } catch (err) {
          showToast('出错了：' + err.message);
        }
      });
    });

    // 下架按钮（同样使用事件委托，但已绑定过，为了避免重复绑定，用新方式）
    // 但上面动态生成的 del-btn 还没有绑定，我们重新绑定
    manageResults.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', async function() {
        const id = this.dataset.id;
        if (!confirm('确定下架这件商品？')) return;
        const seller = manageSeller.value.trim();
        const password = managePassword.value.trim();
        if (!seller || !password) {
          showToast('请先输入卖家名和密码');
          return;
        }
        const res = await fetch('/api/shop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'delete',
            id: id,
            seller, password
          })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || '下架失败');
          return;
        }
        showToast('已下架');
        manageBtn.click();
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
