const api = (p, opts) => fetch('/api' + p, opts).then(r => r.json());

document.getElementById('addChild').addEventListener('click', async () => {
  const parentEmail = document.getElementById('parentEmail').value.trim();
  const childEmail = document.getElementById('childEmail').value.trim();
  if (!parentEmail || !childEmail) return alert('enter both emails');
  // create parent if not exists (demo: create each time)
  const parent = await api('/parents', { method: 'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ firstName: '', lastName: '', email: parentEmail }) });
  const added = await api(`/parents/${parent.id}/children`, { method: 'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email: childEmail }) });
  const list = document.getElementById('childrenList');
  const el = document.createElement('div'); el.className='child';
  el.innerHTML = `<div>${childEmail}</div><div><small>demo-code:${added.sentCodeForDemo}</small></div>`;
  list.appendChild(el);
  alert('Verification code sent (demo). Use code shown in card to verify.');
});

document.getElementById('verifyBtn').addEventListener('click', async () => {
  const parentId = document.getElementById('verifyParentId').value.trim();
  const email = document.getElementById('verifyEmail').value.trim();
  const code = document.getElementById('verifyCode').value.trim();
  const accept = document.getElementById('verifyAccept').checked;
  try{
    const res = await api('/verify', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ parentId, email, code, accept }) });
    document.getElementById('verifyResult').innerText = JSON.stringify(res);
  }catch(e){ document.getElementById('verifyResult').innerText = 'error' }
});

document.getElementById('loadDashboard').addEventListener('click', async () => {
  const parentId = document.getElementById('dashboardParentId').value.trim();
  const dash = await api(`/parents/${parentId}/dashboard`);
  const out = document.getElementById('dashboard');
  out.innerHTML = '';
  if (!dash.parent) return out.innerText = 'Parent not found';
  out.appendChild(renderParentCard(dash.parent));
  dash.children.forEach(c => out.appendChild(renderChildCard(c)));
  out.appendChild(renderNotifications(dash.notifications));
});

function renderParentCard(p){
  const el = document.createElement('div'); el.className='card';
  el.innerHTML = `<h3>${p.firstName || ''} ${p.lastName || ''} — ${p.email}</h3><div>Role: ${p.role}</div>`;
  return el;
}

function renderChildCard(c){
  const el = document.createElement('div'); el.className='card';
  const status = c.relationshipStatus === 'VERIFIED' ? 'status-safe' : c.relationshipStatus === 'PENDING' ? 'status-warn' : 'status-high';
  el.innerHTML = `<h4>${c.email}</h4><div class='${status}'>Status: ${c.relationshipStatus}</div>`;
  return el;
}

function renderNotifications(list){
  const el = document.createElement('div'); el.className='card';
  el.innerHTML = '<h3>Notifications</h3>' + (list.length? '' : '<div>None</div>');
  list.slice(0,10).forEach(n => {
    const row = document.createElement('div'); row.style.padding='8px'; row.style.borderTop='1px solid rgba(255,255,255,0.03)';
    row.innerHTML = `<div>${n.message}</div><small>${new Date(n.timestamp).toLocaleString()} • ${n.domain}</small>`;
    el.appendChild(row);
  });
  return el;
}
