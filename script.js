// ========== 全局变量 ==========
let allProducts = [];           // 所有商品（官方 + 玩家集市）
let recommendProducts = [];     // 推荐商品（来自 recommend.csv）
let currentSort = 'price-asc';
let fuseInstance = null;        // Fuse 实例

// ========== 加载所有数据 ==========
async function loadAllData() {
  const inputEl = document.getElementById('searchInput');
  inputEl.placeholder = '扫描商店箱子中...';

  // 1. 加载官方 CSV
  const officialFiles = [
    '/csv/store.csv',
    '/csv/market.csv',
    '/csv/book.csv',
    '/csv/score.csv',
    '/csv/superdirt.csv'
  ];
  const officialPromises = officialFiles.map(file =>
    new Promise((resolve) => {
      Papa.parse(file, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (result) => resolve(result.data),
        error: () => resolve([])
      });
    })
  );

  // 2. 加载推荐商品 CSV
  const recommendPromise = new Promise((resolve) => {
    Papa.parse('/csv/recommend.csv', {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: () => resolve([])
    });
  });

  // 3. 从 API 加载玩家集市数据（动态）
  let playerItems = [];
  try {
    const res = await fetch('/api/shop');
    if (res.ok) {
      const data = await res.json();
      playerItems = data.items || [];
    }
  } catch (e) {
    console.warn('加载玩家集市失败', e);
  }

  // 4. 加载推荐
  const recommendRows = await recommendPromise;
  recommendRows.forEach(row => {
    const name = row['商品名']?.trim();
    if (!name) return;
    recommendProducts.push({
      name: name,
      price: parseInt(row['单价']) || 0,
      qty: parseInt(row['剩余数量']) || 0,
      x: null,
      y: null,
      z: null,
      shop: null,
      seller: row['卖家']?.trim() || '玩家集市',
      sourceType: 'player'
    });
  });

  // 5. 合并官方数据
  const merged = [];
  const officialResults = await Promise.all(officialPromises);
  const shopNameMap = ['商店', '商场', '附魔书商店', '积分商店', '超级泥土币商店'];
  officialResults.forEach((rows, idx) => {
    rows.forEach(row => {
      const name = row['商品名']?.trim();
      if (!name) return;
      merged.push({
        name: name,
        price: parseInt(row['单价']) || 0,
        qty: parseInt(row['数量']) || 0,
        x: parseFloat(row['坐标X']) || 0,
        y: parseFloat(row['坐标Y']) || 0,
        z: parseFloat(row['坐标Z']) || 0,
        shop: shopNameMap[idx] || '官方商店',
        seller: null,
        sourceType: 'official'
      });
    });
  });

  // 6. 添加玩家集市数据（来自API）
  playerItems.forEach(item => {
    merged.push({
      name: item.name,
      price: item.price,
      qty: item.qty,
      x: null,
      y: null,
      z: null,
      shop: null,
      seller: item.seller || '玩家集市',
      sourceType: 'player',
      id: item.id   // 保留id供后续操作
    });
  });

  allProducts = merged;

  // 7. 初始化 Fuse（只搜索商品名）
  fuseInstance = new Fuse(allProducts, {
    keys: ['name'],
    threshold: 0.3,
    minMatchCharLength: 1,
    includeScore: false
  });

  inputEl.placeholder = '搜商品名，坐标直接糊脸';
  renderResults(document.getElementById('searchInput').value);
  applyRough();
}

// ========== 渲染结果 ==========
function renderResults(filterText) {
  const list = document.getElementById('resultsList');
  const text = filterText.trim();

  let matched = [];

  if (text === '') {
    // 空搜索 → 显示推荐商品
    matched = recommendProducts.length > 0 ? recommendProducts : [];
    if (matched.length === 0) {
      list.innerHTML = `<div class="no-result">暂无推荐商品</div>`;
      list.classList.add('show');
      return;
    }
  } else {
    // 使用 Fuse 搜索
    const results = fuseInstance.search(text);
    matched = results.map(r => r.item);
    if (matched.length === 0) {
      list.innerHTML = `<div class="no-result">没找到，试试其他词</div>`;
      list.classList.add('show');
      return;
    }
  }

  // 排序（仅对搜索匹配结果有效）
  if (text !== '') {
    switch (currentSort) {
      case 'price-asc': matched.sort((a, b) => a.price - b.price); break;
      case 'price-desc': matched.sort((a, b) => b.price - a.price); break;
      case 'official-first':
        matched.sort((a, b) => {
          if (a.sourceType === 'official' && b.sourceType !== 'official') return -1;
          if (a.sourceType !== 'official' && b.sourceType === 'official') return 1;
          return 0;
        });
        break;
      case 'player-first':
        matched.sort((a, b) => {
          if (a.sourceType === 'player' && b.sourceType !== 'player') return -1;
          if (a.sourceType !== 'player' && b.sourceType === 'player') return 1;
          return 0;
        });
        break;
    }
  }

  // 挑衅头部
  let headerMsg = '';
  if (text !== '') {
    const taunts = [
      `找到 ${matched.length} 件，别翻了，你要的就在前 3 个`,
      `${matched.length} 件匹配，再犹豫就被别人抢了`,
      `就 ${matched.length} 件，闭眼挑吧`,
      `总共 ${allProducts.length} 件货，筛出 ${matched.length} 个`
    ];
    headerMsg = `<div class="result-item" style="border-bottom:2px solid #E85D04; background:#1a1a1a; font-size:0.8rem; color:#8a847a; cursor:default; pointer-events:none; justify-content:center;">${taunts[Math.floor(Math.random() * taunts.length)]}</div>`;
  }

  let html = headerMsg;
  matched.forEach(p => {
    let displayName = p.name;
    if (text !== '') {
      const regex = new RegExp(`(${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      displayName = p.name.replace(regex, '<span style="color:#E85D04; font-weight:700;">$1</span>');
    }

    let tag = '';
    if (p.sourceType === 'official') {
      tag = `<span class="tag" style="border-color:#E85D04; color:#E85D04;">官方·${p.shop}</span>`;
    } else {
      tag = `<span class="tag" style="border-color:#6a7a5a; color:#b0c0a0;">玩家·${p.seller}</span>`;
    }

    let coordDisplay = '';
    if (p.sourceType === 'official' && p.x !== null && p.x !== undefined) {
      coordDisplay = `<span class="coord">(${p.x}, ${p.y}, ${p.z})</span>`;
    }

    // 玩家商品显示剩余数量
    let qtyDisplay = '';
    if (p.sourceType === 'player') {
      qtyDisplay = `<span style="color:#7a7265; font-size:0.75rem;">剩余 ${p.qty} 个</span>`;
    }

    html += `
      <div class="result-item" data-name="${p.name}" data-id="${p.id || ''}">
        <span class="name">${displayName}</span>
        <span class="meta">
          <span class="price">${p.price} 泥土</span>
          ${coordDisplay}
          ${qtyDisplay}
          ${tag}
        </span>
      </div>
    `;
  });

  list.innerHTML = html;
  list.classList.add('show');
}

// ========== 事件绑定（保持不变） ==========
const input = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');

let debounceTimer;
input.addEventListener('input', function() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => renderResults(this.value), 300);
});

searchBtn.addEventListener('click', () => renderResults(input.value));

resultsList.addEventListener('click', function(e) {
  const item = e.target.closest('.result-item');
  if (item) {
    const name = item.dataset.name;
    if (name) { input.value = name; renderResults(name); }
  }
});

document.addEventListener('click', function(e) {
  if (!document.querySelector('.search-area').contains(e.target)) {
    resultsList.classList.remove('show');
  }
});

input.addEventListener('keydown', function(e) {
  const items = resultsList.querySelectorAll('.result-item');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    let idx = -1;
    items.forEach((el, i) => { if (el.classList.contains('active-item')) idx = i; });
    idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items.forEach(el => el.classList.remove('active-item'));
    items[idx].classList.add('active-item');
    items[idx].scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter') {
    const active = resultsList.querySelector('.result-item.active-item');
    if (active) {
      const name = active.dataset.name;
      if (name) { input.value = name; renderResults(name); }
    } else {
      renderResults(input.value);
    }
  }
  if (e.key === 'Escape') {
    resultsList.classList.remove('show');
    input.blur();
  }
});

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    currentSort = this.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    renderResults(input.value);
  });
});

// ========== Rough.js 手绘描边 ==========
function applyRough() {
  if (typeof rough === 'undefined') return;
  document.querySelectorAll('#roughSearch canvas, .nav-btn canvas').forEach(c => c.remove());

  const searchBox = document.getElementById('roughSearch');
  if (searchBox) {
    const rect = searchBox.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = rect.width + 10;
    canvas.height = rect.height + 10;
    canvas.style.cssText = 'position:absolute;top:-5px;left:-5px;pointer-events:none;z-index:2;';
    searchBox.style.position = 'relative';
    searchBox.appendChild(canvas);
    const rc = rough.canvas(canvas);
    rc.rectangle(0, 0, canvas.width, canvas.height, {
      stroke: '#E85D04', strokeWidth: 2, roughness: 2.2, fill: 'transparent'
    });
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    const rect = btn.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = rect.width + 20;
    canvas.height = rect.height + 20;
    canvas.style.cssText = 'position:absolute;top:-10px;left:-10px;pointer-events:none;z-index:2;';
    btn.style.position = 'relative';
    btn.appendChild(canvas);
    const rc = rough.canvas(canvas);
    rc.rectangle(0, 0, canvas.width, canvas.height, {
      stroke: btn === document.getElementById('btnStore') ? '#E85D04' : '#6a7a5a',
      strokeWidth: 2,
      roughness: 2.8,
      fill: 'transparent'
    });
  });
}

window.addEventListener('load', function() {
  loadAllData();
  setTimeout(applyRough, 600);
});

let resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    document.querySelectorAll('#roughSearch canvas, .nav-btn canvas').forEach(c => c.remove());
    applyRough();
  }, 400);
});