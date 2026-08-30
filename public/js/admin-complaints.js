'use strict';

if (!Auth.requireAdmin()) throw new Error('redirecting');
UI.renderNav('complaints');

const PAGE_SIZE = 10;
const state = { q: '', category: '', status: '', page: 1 };
let cache = {}; // id -> complaint row (for the modal)

const resultArea = document.getElementById('resultArea');
const searchInput = document.getElementById('search');
const filterCategory = document.getElementById('filterCategory');
const filterStatus = document.getElementById('filterStatus');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

// Populate filter dropdowns.
CATEGORIES.forEach((c) => filterCategory.add(new Option(c, c)));
STATUSES.forEach((s) => filterStatus.add(new Option(s, s)));

// After a successful update the dialog lingers briefly to show the confirmation,
// then closes on a timer. The id is kept so the timer can be cancelled — without
// that, opening another complaint inside the delay would close the new dialog.
let closeTimer = null;

function cancelPendingClose() {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

document.getElementById('modalClose').onclick = closeModal;
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
function closeModal() {
  cancelPendingClose();
  modal.classList.remove('show');
  modalBody.innerHTML = '';
}

document.getElementById('searchBtn').onclick = applyFilters;
document.getElementById('clearBtn').onclick = () => {
  searchInput.value = ''; filterCategory.value = ''; filterStatus.value = '';
  Object.assign(state, { q: '', category: '', status: '', page: 1 });
  load();
};
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });

function applyFilters() {
  state.q = searchInput.value.trim();
  state.category = filterCategory.value;
  state.status = filterStatus.value;
  state.page = 1;
  load();
}

const short = (s, n = 55) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

async function load() {
  resultArea.innerHTML = '<div class="loading"><div class="spinner"></div>Loading complaints…</div>';
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category) params.set('category', state.category);
  if (state.status) params.set('status', state.status);
  params.set('page', state.page);
  params.set('limit', PAGE_SIZE);

  try {
    const { data, pagination } = await API.get('/complaints?' + params.toString());
    cache = {};
    data.forEach((c) => { cache[c.id] = c; });

    if (data.length === 0) {
      resultArea.innerHTML = '<div class="empty"><div class="big">🔍</div>No complaints match your search.</div>';
      return;
    }

    resultArea.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>ID</th><th>Student</th><th>Room</th><th>Category</th>
          <th>Description</th><th>Status</th><th>Submitted</th><th>Action</th>
        </tr></thead>
        <tbody>${data.map(rowHtml).join('')}</tbody>
      </table></div>
      ${paginationHtml(pagination)}`;

    resultArea.querySelectorAll('[data-manage]').forEach((b) => b.onclick = () => manage(+b.dataset.manage));
    const prev = resultArea.querySelector('#prevPage');
    const next = resultArea.querySelector('#nextPage');
    if (prev) prev.onclick = () => { state.page--; load(); };
    if (next) next.onclick = () => { state.page++; load(); };
  } catch (err) {
    resultArea.innerHTML = `<div class="empty">Could not load complaints: ${UI.esc(err.message)}</div>`;
  }
}

function rowHtml(c) {
  return `<tr>
    <td>#${c.id}</td>
    <td>${UI.esc(c.student_name)}</td>
    <td>${UI.esc(c.room_number || '—')}</td>
    <td><span class="chip">${UI.esc(c.category)}</span></td>
    <td>${UI.esc(short(c.description))}</td>
    <td>${UI.statusBadge(c.status)}</td>
    <td>${UI.fmtDay(c.created_at)}</td>
    <td class="actions"><button class="btn btn-sm" data-manage="${c.id}">Manage</button></td>
  </tr>`;
}

function paginationHtml(p) {
  return `<div class="pagination">
    <button class="btn btn-sm btn-ghost" id="prevPage" ${p.page <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <span class="page-info">Page ${p.page} of ${p.totalPages} · ${p.total} complaint${p.total === 1 ? '' : 's'}</span>
    <button class="btn btn-sm btn-ghost" id="nextPage" ${p.page >= p.totalPages ? 'disabled' : ''}>Next ›</button>
  </div>`;
}

function detailRow(k, v) {
  return `<div class="detail-row"><span class="k">${k}</span><span>${v}</span></div>`;
}

// The server rejects a status that would move a complaint backwards, so only
// offer the ones it will accept: the current status (to edit remarks alone)
// and everything after it.
function forwardStatuses(current) {
  const from = STATUSES.indexOf(current);
  return from === -1 ? STATUSES : STATUSES.slice(from);
}

function manage(id) {
  const c = cache[id];
  if (!c) return;
  cancelPendingClose();
  modalTitle.textContent = `Complaint #${c.id}`;
  modal.classList.add('show');

  const img = c.image_url ? `<img class="detail-img" src="${UI.esc(c.image_url)}" alt="Complaint image">` : '<span class="muted">None</span>';
  modalBody.innerHTML = `
    <div id="mgError" class="alert alert-error"></div>
    <div id="mgSuccess" class="alert alert-success"></div>
    ${detailRow('Student', `${UI.esc(c.student_name)} · Room ${UI.esc(c.room_number || '—')}`)}
    ${detailRow('Category', `<span class="chip">${UI.esc(c.category)}</span>`)}
    ${detailRow('Description', UI.esc(c.description))}
    ${detailRow('Submitted', UI.fmtDate(c.created_at))}
    ${detailRow('Resolved On', c.resolved_at ? UI.fmtDate(c.resolved_at) : '<span class="muted">—</span>')}
    ${detailRow('Image', img)}
    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">
    <form id="statusForm">
      <div class="form-group">
        <label for="mgStatus">Status</label>
        <select id="mgStatus">${forwardStatuses(c.status).map((s) =>
          `<option value="${s}" ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <div class="hint">A complaint only moves forward: ${STATUSES.join(' → ')}.</div>
      </div>
      <div class="form-group">
        <label for="mgRemarks">Admin Remarks</label>
        <textarea id="mgRemarks" maxlength="1000" placeholder="Add a note for the student…">${UI.esc(c.admin_remarks || '')}</textarea>
      </div>
      <button type="submit" class="btn" id="mgSubmit">Update Complaint</button>
      <button type="button" class="btn btn-ghost" id="mgCancel">Close</button>
    </form>`;

  document.getElementById('mgCancel').onclick = closeModal;
  document.getElementById('statusForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert('mgError'); UI.hideAlert('mgSuccess');
    const status = document.getElementById('mgStatus').value;
    const admin_remarks = document.getElementById('mgRemarks').value;
    const btn = document.getElementById('mgSubmit');
    btn.disabled = true; btn.textContent = 'Updating…';
    try {
      const updated = await API.patch(`/complaints/${id}/status`, { status, admin_remarks });
      cache[id] = { ...cache[id], ...updated };
      UI.showSuccess('mgSuccess', 'Complaint updated.');
      // Refresh the underlying list, keep the modal open briefly to show success.
      closeTimer = setTimeout(() => { closeModal(); load(); }, 700);
    } catch (err) {
      UI.showError('mgError', err.message);
      btn.disabled = false; btn.textContent = 'Update Complaint';
    }
  });
}

load();
