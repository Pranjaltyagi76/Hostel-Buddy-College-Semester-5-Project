'use strict';

// Small view helpers shared across pages: escaping, date formatting, status
// badges, the top navigation, and alert boxes.
const CATEGORIES = ['Electricity', 'Plumbing', 'Water Supply', 'Wi-Fi', 'Cleaning', 'Furniture', 'Security', 'Other'];
const STATUSES = ['Pending', 'In Progress', 'Resolved', 'Closed'];

const UI = {
  esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // SQLite stores UTC as "YYYY-MM-DD HH:MM:SS"; parse it as UTC then localize.
  _parse(iso) {
    if (!iso) return null;
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return isNaN(d) ? null : d;
  },
  fmtDate(iso) {
    const d = this._parse(iso);
    return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  },
  fmtDay(iso) {
    const d = this._parse(iso);
    return d ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
  },

  statusBadge(status) {
    const cls = {
      'Pending': 'st-pending', 'In Progress': 'st-progress',
      'Resolved': 'st-resolved', 'Closed': 'st-closed',
    }[status] || '';
    return `<span class="badge ${cls}">${UI.esc(status)}</span>`;
  },

  // Build the top navigation for the logged-in user into #app-nav.
  renderNav(active) {
    const user = Auth.getUser();
    const el = document.getElementById('app-nav');
    if (!el || !user) return;
    const isAdmin = user.role === 'admin';

    const links = isAdmin
      ? [['admin.html', 'Dashboard', 'dashboard'], ['admin-complaints.html', 'All Complaints', 'complaints']]
      : [
          ['dashboard.html', 'Dashboard', 'dashboard'],
          ['raise.html', 'Raise Complaint', 'raise'],
          ['my-complaints.html', 'My Complaints', 'mine'],
          ['profile.html', 'Profile', 'profile'],
        ];

    el.innerHTML = `
      <nav class="topnav ${isAdmin ? 'admin' : ''}">
        <div class="nav-inner">
          <a class="brand" href="${isAdmin ? 'admin.html' : 'dashboard.html'}">🏠 Hostel Buddy</a>
          <button class="nav-toggle" aria-label="Toggle menu">☰</button>
          <div class="nav-links">
            ${links.map(([href, label, key]) =>
              `<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`).join('')}
            <span class="nav-user">${UI.esc(user.name)}${isAdmin ? ' · Admin' : ''}</span>
            <button class="btn-logout" id="logoutBtn">Logout</button>
          </div>
        </div>
      </nav>`;

    el.querySelector('#logoutBtn').onclick = () => Auth.logout();
    el.querySelector('.nav-toggle').onclick = () =>
      el.querySelector('.nav-links').classList.toggle('open');
  },

  // Alert helpers — target an .alert element by id.
  showError(id, message) { this._alert(id, message, 'error'); },
  showSuccess(id, message) { this._alert(id, message, 'success'); },
  hideAlert(id) { const el = document.getElementById(id); if (el) el.classList.remove('show'); },
  _alert(id, message, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `alert alert-${type} show`;
    el.textContent = message;
  },
};

window.UI = UI;
window.CATEGORIES = CATEGORIES;
window.STATUSES = STATUSES;
