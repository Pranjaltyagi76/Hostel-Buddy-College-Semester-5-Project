'use strict';

if (!Auth.requireStudent()) throw new Error('redirecting');

UI.renderNav('dashboard');
document.getElementById('userName').textContent = Auth.getUser().name;

const statsEl = document.getElementById('stats');

function statCard(num, label, accent) {
  return `<div class="stat accent-${accent}"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}

(async () => {
  try {
    const d = await API.get('/dashboard/student');
    statsEl.innerHTML = [
      statCard(d.total, 'Total Complaints', 'total'),
      statCard(d.pending, 'Pending', 'pending'),
      statCard(d.inProgress, 'In Progress', 'progress'),
      statCard(d.resolved, 'Resolved', 'resolved'),
      statCard(d.closed, 'Closed', 'closed'),
    ].join('');
  } catch (err) {
    statsEl.innerHTML = `<div class="empty" style="grid-column:1/-1;">Could not load dashboard: ${UI.esc(err.message)}</div>`;
  }
})();
