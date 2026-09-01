'use strict';

if (!Auth.requireStaff()) throw new Error('redirecting');
UI.renderNav('dashboard');

const statsEl = document.getElementById('stats');
const recentArea = document.getElementById('recentArea');

const CATEGORY_COLORS = ['#2e75b6', '#5a8f4e', '#c98a17', '#7a2e8a', '#b23b3b', '#1f4e79', '#0f9b8e', '#94a3b8'];
const STATUS_COLORS = { 'Pending': '#c98a17', 'In Progress': '#2e75b6', 'Resolved': '#5a8f4e', 'Closed': '#6b7280' };

function statCard(num, label, accent) {
  return `<div class="stat accent-${accent}"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}

(async () => {
  let d;
  try {
    d = await API.get('/dashboard/admin');
  } catch (err) {
    statsEl.innerHTML = `<div class="empty" style="grid-column:1/-1;">Could not load dashboard: ${UI.esc(err.message)}</div>`;
    return;
  }

  // Say plainly whose figures these are. A manager's dashboard covers only
  // their own hostel, and an unlabelled "Total Complaints: 5" next to a
  // colleague's "13" would otherwise look like a bug rather than a boundary.
  renderScope(d.scope);

  statsEl.innerHTML = [
    statCard(d.totalStudents, 'Total Students', 'students'),
    statCard(d.totalComplaints, 'Total Complaints', 'total'),
    statCard(d.byStatus['Pending'], 'Pending', 'pending'),
    statCard(d.byStatus['In Progress'], 'In Progress', 'progress'),
    statCard(d.byStatus['Resolved'], 'Resolved', 'resolved'),
    statCard(d.byStatus['Closed'], 'Closed', 'closed'),
  ].join('');

  renderCategoryChart(d.byCategory);
  renderStatusChart(d.byStatus);
  renderRecent(d.recent);
})();

function renderScope(scope) {
  const el = document.getElementById('scopeNote');
  if (!el) return;
  if (scope && scope.hostel_id) {
    el.className = 'box-scope scoped';
    el.innerHTML = `Showing <b>${UI.esc(scope.hostel_name)}</b> only — you manage this hostel.`;
  } else {
    el.className = 'box-scope all';
    el.innerHTML = 'Showing <b>all hostels</b> — you are signed in as super admin.';
  }
}

function renderCategoryChart(byCategory) {
  const labels = Object.keys(byCategory);
  const values = Object.values(byCategory);
  new Chart(document.getElementById('categoryChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: CATEGORY_COLORS, borderWidth: 1, borderColor: '#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 14, font: { size: 11 } } },
        title: { display: true, text: 'Complaints by Category', font: { size: 14 } },
      },
    },
  });
}

function renderStatusChart(byStatus) {
  const labels = Object.keys(byStatus);
  new Chart(document.getElementById('statusChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Complaints', data: Object.values(byStatus), backgroundColor: labels.map((s) => STATUS_COLORS[s]) }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Complaints by Status', font: { size: 14 } },
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderRecent(recent) {
  if (!recent || recent.length === 0) {
    recentArea.innerHTML = '<div class="empty">No complaints yet.</div>';
    return;
  }
  recentArea.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Student</th><th>Room</th><th>Category</th><th>Status</th><th>Submitted</th></tr></thead>
      <tbody>
        ${recent.map((c) => `<tr>
          <td>#${c.complaint_id}</td>
          <td>${UI.esc(c.student_name)}</td>
          <td>${UI.esc(c.room_number || '—')}</td>
          <td><span class="chip">${UI.esc(c.category)}</span></td>
          <td>${UI.statusBadge(c.status)}</td>
          <td>${UI.fmtDay(c.created_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}
