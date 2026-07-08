// /login/script.js
document.getElementById('loginForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const errorEl = document.getElementById('errorMsg');
  errorEl.textContent = '';
  
  if (!username || !password) {
    errorEl.textContent = '填全了再提交';
    return;
  }
  
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      // 存储 token 和 username 到 cookie
      document.cookie = `player_token=${data.token}; path=/; max-age=86400; SameSite=Lax`;
      document.cookie = `player_username=${username}; path=/; max-age=86400; SameSite=Lax`;
      window.location.href = '/shop';
    } else {
      errorEl.textContent = data.error || '账号或密码错误';
    }
  } catch (err) {
    errorEl.textContent = '网络错误，稍后再试';
  }
});