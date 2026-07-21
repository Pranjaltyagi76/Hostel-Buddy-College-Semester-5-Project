'use strict';

if (!Auth.requireStudent()) throw new Error('redirecting');
UI.renderNav('mine');

const listArea = document.getElementById('listArea');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
document.getElementById('modalClose').onclick = closeModal;
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

let items = {}; // id -> complaint

function openModal(title) { modalTitle.textContent = title; modal.classList.add('show'); }
function closeModal() { modal.classList.remove('show'); modalBody.innerHTML = ''; }

const short = (s, n = 60) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

async function load() {
  listArea.innerHTML = '<div class="loading"><div class="spinner"></div>Loading your complaints…</div>';
  try {
    const list = await API.get('/complaints/mine');
    items = {};
    list.forEach((c) => { items[c.id] = c; });

    if (list.length === 0) {
      listArea.innerHTML = `<div class="empty"><div class="big">📭</div>
        You haven't raised any complaints yet.<br>
        <a class="btn" href="raise.html" style="margin-top:14px;">Raise your first complaint</a></div>`;
      return;
    }

    listArea.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>ID</th><th>Category</th><th>Description</th><th>Status</th>
          <th>Submitted</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${list.map(rowHtml).join('')}
        </tbody>
      </table></div>`;

    listArea.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => viewComplaint(+b.dataset.view));
    listArea.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editComplaint(+b.dataset.edit));
    listArea.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => deleteComplaint(+b.dataset.del));
  } catch (err) {
    listArea.innerHTML = `<div class="empty">Could not load complaints: ${UI.esc(err.message)}</div>`;
  }
}

function rowHtml(c) {
  const canEdit = c.status === 'Pending';
  const editBtns = canEdit
    ? `<button class="btn btn-sm btn-ghost" data-edit="${c.id}">Edit</button>
       <button class="btn btn-sm btn-danger" data-del="${c.id}">Delete</button>`
    : '';
  return `<tr>
    <td>#${c.id}</td>
    <td><span class="chip">${UI.esc(c.category)}</span></td>
    <td>${UI.esc(short(c.description))}</td>
    <td>${UI.statusBadge(c.status)}</td>
    <td>${UI.fmtDay(c.created_at)}</td>
    <td class="actions">
      <button class="btn btn-sm btn-ghost" data-view="${c.id}">View</button>
      ${editBtns}
    </td>
  </tr>`;
}

function detailRow(k, v) {
  return `<div class="detail-row"><span class="k">${k}</span><span>${v}</span></div>`;
}

function viewComplaint(id) {
  const c = items[id];
  if (!c) return;
  openModal(`Complaint #${c.id}`);
  const img = c.image_url
    ? `<img class="detail-img" src="${UI.esc(c.image_url)}" alt="Complaint image">` : '<span class="muted">None</span>';
  modalBody.innerHTML =
    detailRow('Category', `<span class="chip">${UI.esc(c.category)}</span>`) +
    detailRow('Status', UI.statusBadge(c.status)) +
    detailRow('Description', UI.esc(c.description)) +
    detailRow('Admin Remarks', c.admin_remarks ? UI.esc(c.admin_remarks) : '<span class="muted">No remarks yet</span>') +
    detailRow('Submitted', UI.fmtDate(c.created_at)) +
    detailRow('Last Updated', UI.fmtDate(c.updated_at)) +
    detailRow('Resolved On', c.resolved_at ? UI.fmtDate(c.resolved_at) : '<span class="muted">—</span>') +
    detailRow('Image', img);
}

function editComplaint(id) {
  const c = items[id];
  if (!c || c.status !== 'Pending') return;
  openModal(`Edit Complaint #${c.id}`);
  modalBody.innerHTML = `
    <div id="editError" class="alert alert-error"></div>
    <form id="editForm" novalidate>
      <div class="form-group">
        <label for="editCategory">Category</label>
        <select id="editCategory">${CATEGORIES.map((x) =>
          `<option value="${x}" ${x === c.category ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <label for="editDescription">Description</label>
        <textarea id="editDescription" maxlength="1000">${UI.esc(c.description)}</textarea>
      </div>
      <div class="form-group">
        <label for="editImage">Replace image <span class="muted">(optional)</span></label>
        <input type="file" id="editImage" accept="image/png,image/jpeg,image/webp">
        <div class="hint">${c.image_url ? 'An image is already attached; choosing a new one replaces it.' : 'PNG, JPEG or WEBP, up to 5 MB.'}</div>
      </div>
      <button type="submit" class="btn" id="editSubmit">Save Changes</button>
      <button type="button" class="btn btn-ghost" id="editCancel">Cancel</button>
    </form>`;

  document.getElementById('editCancel').onclick = closeModal;
  document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert('editError');
    const category = document.getElementById('editCategory').value;
    const desc = document.getElementById('editDescription').value.trim();
    if (!desc) return UI.showError('editError', 'Description is required.');

    const fd = new FormData();
    fd.append('category', category);
    fd.append('description', desc);
    const file = document.getElementById('editImage').files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) return UI.showError('editError', 'Image is too large (max 5 MB).');
      fd.append('image', file);
    }

    const btn = document.getElementById('editSubmit');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await API.putForm(`/complaints/${id}`, fd);
      closeModal();
      load();
    } catch (err) {
      UI.showError('editError', err.message);
      btn.disabled = false; btn.textContent = 'Save Changes';
    }
  });
}

async function deleteComplaint(id) {
  const c = items[id];
  if (!c) return;
  if (!confirm(`Delete complaint #${id} (${c.category})? This cannot be undone.`)) return;
  try {
    await API.del(`/complaints/${id}`);
    load();
  } catch (err) {
    alert('Could not delete: ' + err.message);
  }
}

load();
