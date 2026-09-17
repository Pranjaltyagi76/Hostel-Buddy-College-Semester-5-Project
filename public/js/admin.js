'use strict';

if (!Auth.requireStaff()) throw new Error('redirecting');
UI.renderNav('dashboard');

const statsEl = document.getElementById('stats');
const recentArea = document.getElementById('recentArea');
const hotspotArea = document.getElementById('hotspotArea');
const hotspotStats = document.getElementById('hotspotStats');
const hotspotPeriod = document.getElementById('hotspotPeriod');
let hotspotChart = null;

const CATEGORY_COLORS = ['#2e75b6', '#5a8f4e', '#c98a17', '#7a2e8a', '#b23b3b', '#1f4e79', '#0f9b8e', '#94a3b8'];
const STATUS_COLORS = { 'Pending': '#c98a17', 'In Progress': '#2e75b6', 'Resolved': '#5a8f4e', 'Closed': '#6b7280' };
const PRIORITY_COLORS = { Low: '#94a3b8', Medium: '#2e75b6', High: '#c98a17', Critical: '#b23b3b' };

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
    statCard(d.byPriority['Critical'], 'Critical Priority', 'critical'),
    statCard(d.sla.overdue, 'SLA Overdue', 'overdue'),
  ].join('');

  renderCategoryChart(d.byCategory);
  renderStatusChart(d.byStatus);
  renderPriorityChart(d.byPriority);
  if (d.activity) renderActivityChart(d.activity);
  renderRecent(d.recent);
})();

hotspotPeriod.addEventListener('change', loadHotspots);
loadHotspots();

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

function renderPriorityChart(byPriority) {
  const labels = Object.keys(byPriority);
  new Chart(document.getElementById('priorityChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Complaints',
        data: Object.values(byPriority),
        backgroundColor: labels.map((priority) => PRIORITY_COLORS[priority]),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Complaints by Priority', font: { size: 14 } },
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderActivityChart(activity) {
  const card = document.getElementById('activityCard');
  card.hidden = false;
  document.getElementById('activityPeriod').textContent =
    `Daily institution-wide activity for the last ${activity.periodDays} days.`;
  document.getElementById('activityStats').innerHTML = [
    statCard(activity.raisedTotal, `Raised (${activity.periodDays} days)`, 'total'),
    statCard(activity.resolvedTotal, `Resolved (${activity.periodDays} days)`, 'resolved'),
  ].join('');

  const labels = activity.daily.map((row) => {
    const date = new Date(`${row.day}T00:00:00`);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });

  new Chart(document.getElementById('activityChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Raised',
          data: activity.daily.map((row) => row.raised),
          borderColor: '#2e75b6',
          backgroundColor: 'rgba(46, 117, 182, .12)',
          tension: 0.25,
          fill: true,
        },
        {
          label: 'Resolved',
          data: activity.daily.map((row) => row.resolved),
          borderColor: '#5a8f4e',
          backgroundColor: 'rgba(90, 143, 78, .12)',
          tension: 0.25,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
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

async function loadHotspots() {
  const days = hotspotPeriod.value;
  if (hotspotChart) { hotspotChart.destroy(); hotspotChart = null; }
  hotspotPeriod.disabled = true;
  hotspotStats.innerHTML = '';
  hotspotArea.className = 'loading';
  hotspotArea.innerHTML = '<div class="spinner"></div>Analysing complaint clusters…';

  try {
    const data = await API.get(`/dashboard/admin/hotspots?days=${encodeURIComponent(days)}`);
    renderHotspots(data);
  } catch (err) {
    hotspotArea.className = 'empty';
    hotspotArea.innerHTML = `Could not load hotspot analytics: ${UI.esc(err.message)}`;
  } finally {
    hotspotPeriod.disabled = false;
  }
}

function riskBadge(level, score) {
  return `<span class="badge risk-${UI.esc(level.toLowerCase())}">${UI.esc(level)} · ${score}</span>`;
}

function trendLabel(location) {
  const labels = {
    new: `New +${location.change}`,
    rising: `↑ ${location.change}`,
    steady: '→ 0',
    easing: `↓ ${Math.abs(location.change)}`,
  };
  return `<span class="hotspot-trend ${UI.esc(location.trend)}">${UI.esc(labels[location.trend] || location.trend)}</span>`;
}

function renderHotspots(data) {
  hotspotStats.innerHTML = [
    statCard(data.summary.locations, `Active locations (${data.period_days}d)`, 'total'),
    statCard(data.summary.complaints, 'Complaints analysed', 'progress'),
    statCard(data.summary.high_risk_locations, 'High-risk locations', 'critical'),
  ].join('');

  if (!data.locations.length) {
    hotspotArea.className = 'empty';
    hotspotArea.innerHTML = `No complaints were raised in the last ${data.period_days} days.`;
    return;
  }

  hotspotArea.className = 'hotspot-layout';
  hotspotArea.innerHTML = `
    <div class="chart-box hotspot-chart"><canvas id="hotspotChart"></canvas></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Location</th><th>Dominant issue</th><th>Cases / trend</th><th>Pressure</th><th>Risk / action</th></tr></thead>
      <tbody>${data.locations.map((location) => `<tr>
        <td><b>#${location.rank}</b> ${UI.esc(location.location_label)}</td>
        <td><span class="chip">${UI.esc(location.dominant_category)}</span><br><span class="muted">${location.dominant_category_count} case${location.dominant_category_count === 1 ? '' : 's'}</span></td>
        <td><b>${location.complaint_count}</b> ${trendLabel(location)}<br><span class="muted">previous: ${location.previous_count}</span></td>
        <td>${location.open_count} open<br>${location.overdue_count} overdue · ${location.critical_count} Critical</td>
        <td>${riskBadge(location.risk_level, location.risk_score)}<div class="hotspot-action">${UI.esc(location.recommended_action)}</div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;

  const chartLocations = [...data.locations].reverse();
  hotspotChart = new Chart(document.getElementById('hotspotChart'), {
    type: 'bar',
    data: {
      labels: chartLocations.map((location) => location.location_label),
      datasets: [{
        label: 'Risk score',
        data: chartLocations.map((location) => location.risk_score),
        backgroundColor: chartLocations.map((location) => ({
          Normal: '#94a3b8', Watch: '#2e75b6', High: '#c98a17', Critical: '#b23b3b',
        })[location.risk_level]),
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: `Top complaint hotspots · ${data.period_days} days`, font: { size: 14 } },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}
