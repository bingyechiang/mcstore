let adminToken = '';

async function adminLogin() {
  const pwd = document.getElementById('adminPwd').value;
  const errorEl = document.getElementById('adminError');
  errorEl.textContent = '';
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', password: pwd })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      adminToken = data.token;
      document.getElementById('loginSection').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
      loadItems();
    } else {
      errorEl.textContent = '密码错误';
    }
  } catch (err) {
    errorEl.textContent = '网络错误';
  }
}

async function loadItems() {
  const filter = document.getElementById('filterSeller').value.trim();
  const url = `/api/admin?token=${adminToken}` + (filter ? `&seller=${encodeURIComponent(filter)}` : '');
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const list = document.getElementById('itemList');
    if (data.items.length === 0) {
      list.innerHTML = '<p>暂无商品</p>';
      return;
    }
    let html = '<table border="1" cellpadding="5"><tr><th>ID</th><th>商品名</th><th>单价</th><th>数量</th><th>卖家</th><th>操作</th></tr>';
    data.items.forEach(item => {
      html += `<tr>
        <td>${item.id}</td>
        <td>${item.name}</td>
        <td>${item.price}</td>
        <td>${item.qty}</td>
        <td>${item.seller}</td>
        <td><button onclick="deleteItem('${item.id}')">删除</button></td>
      </tr>`;
    });
    html += '</table>';
    list.innerHTML = html;
  } catch (err) {
    document.getElementById('itemList').innerHTML = '<p style="color:red;">加载失败</p>';
  }
}

async function deleteItem(id) {
  if (!confirm('确定删除该商品吗？')) return;
  try {
    const res = await fetch('/api/admin', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: adminToken, id })
    });
    const data = await res.json();
    if (res.ok) {
      loadItems();
    } else {
      alert('删除失败：' + data.error);
    }
  } catch (err) {
    alert('网络错误');
  }
}

async function setPlayerPassword() {
  const playerId = document.getElementById('setPlayerId').value.trim();
  const newPwd = document.getElementById('setPlayerPwd').value.trim();
  const resultEl = document.getElementById('pwdResult');
  if (!playerId || !newPwd) {
    resultEl.textContent = '请填写完整';
    return;
  }
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setPassword', token: adminToken, playerId, newPassword: newPwd })
    });
    const data = await res.json();
    if (res.ok) {
      resultEl.textContent = '密码已更新';
    } else {
      resultEl.textContent = '失败：' + data.error;
    }
  } catch (err) {
    resultEl.textContent = '网络错误';
  }
}