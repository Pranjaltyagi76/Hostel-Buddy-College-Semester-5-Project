'use strict';

// Super-admin only. A manager is scoped BY a hostel, so letting one edit
// hostels — or create another manager — would let them redraw their own
// authority. The server enforces this; the guard here just avoids showing a
// manager a page every button on which would fail.
if (!Auth.requireSuperAdmin()) throw new Error('redirecting');
UI.renderNav('hostels');

const hostelArea = document.getElementById('hostelArea');
const managerArea = document.getElementById('managerArea');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

let hostels = [];
let managers = [];

document.getElementById('modalClose').onclick = closeModal;
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
function openModal(title) { modalTitle.textContent = title; modal.classList.add('show'); }
function closeModal() { modal.classList.remove('show'); modalBody.innerHTML = ''; }

function flashSuccess(message) {
  UI.showSuccess('pageSuccess', message);
  setTimeout(() => UI.hideAlert('pageSuccess'), 3000);
}

// --- loading ---------------------------------------------------------------

async function load() {
  UI.hideAlert('pageError');
  try {
    [hostels, managers] = await Promise.all([API.get('/hostels'), API.get('/users/managers')]);
    renderHostels();
    renderManagers();
  } catch (err) {
    hostelArea.innerHTML = `<div class="empty">Could not load: ${UI.esc(err.message)}</div>`;
    managerArea.innerHTML = '';
  }
}

// How many managers each hostel has, so the table can show it without a
// second request per row.
function managerCountFor(hostelId) {
  return managers.filter((m) => m.hostel_id === hostelId).length;
}

function renderHostels() {
  if (!hostels.length) {
    hostelArea.innerHTML = `<div class="empty"><div class="big">🏢</div>
      No hostels yet. Add one before students can register.</div>`;
    return;
  }
  hostelArea.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Name</th><th>Location</th><th>Capacity</th><th>Managers</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${hostels.map((h) => `<tr>
          <td><b>${UI.esc(h.hostel_name)}</b></td>
          <td>${UI.esc(h.location || '—')}</td>
          <td>${h.capacity ?? '—'}</td>
          <td>${managerCountFor(h.hostel_id)}</td>
          <td class="actions">
            <button class="btn btn-sm btn-ghost" data-edit="${h.hostel_id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del="${h.hostel_id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;

  hostelArea.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editHostel(+b.dataset.edit));
  hostelArea.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => deleteHostel(+b.dataset.del));
}

function renderManagers() {
  if (!managers.length) {
    managerArea.innerHTML = '<div class="empty">No managers yet.</div>';
    return;
  }
  managerArea.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Manages</th><th>Added</th></tr></thead>
      <tbody>
        ${managers.map((m) => `<tr>
          <td>${UI.esc(m.name)}</td>
          <td>${UI.esc(m.email)}</td>
          <td><span class="chip">${UI.esc(m.hostel_name || '—')}</span></td>
          <td>${UI.fmtDay(m.created_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// --- hostel create / edit --------------------------------------------------

function hostelForm(hostel) {
  const h = hostel || { hostel_name: '', location: '', capacity: '' };
  return `
    <div id="formError" class="alert alert-error"></div>
    <form id="hostelForm" novalidate>
      <div class="form-group">
        <label for="fName">Hostel Name</label>
        <input type="text" id="fName" maxlength="100" required value="${UI.esc(h.hostel_name)}">
      </div>
      <div class="form-group">
        <label for="fLocation">Location <span class="muted">(optional)</span></label>
        <input type="text" id="fLocation" maxlength="100" value="${UI.esc(h.location || '')}">
      </div>
      <div class="form-group">
        <label for="fCapacity">Capacity <span class="muted">(optional)</span></label>
        <input type="number" id="fCapacity" min="1" value="${h.capacity ?? ''}">
        <div class="hint">A whole number greater than zero.</div>
      </div>
      <button type="submit" class="btn" id="fSubmit">${hostel ? 'Save Changes' : 'Add Hostel'}</button>
      <button type="button" class="btn btn-ghost" id="fCancel">Cancel</button>
    </form>`;
}

function wireHostelForm(hostel) {
  document.getElementById('fCancel').onclick = closeModal;
  document.getElementById('hostelForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert('formError');
    const body = {
      hostel_name: document.getElementById('fName').value.trim(),
      location: document.getElementById('fLocation').value.trim(),
      capacity: document.getElementById('fCapacity').value.trim(),
    };
    if (!body.hostel_name) return UI.showError('formError', 'Hostel name is required.');

    const btn = document.getElementById('fSubmit');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (hostel) await API.put(`/hostels/${hostel.hostel_id}`, body);
      else await API.post('/hostels', body);
      closeModal();
      flashSuccess(hostel ? 'Hostel updated.' : 'Hostel added.');
      load();
    } catch (err) {
      UI.showError('formError', err.message);
      btn.disabled = false; btn.textContent = hostel ? 'Save Changes' : 'Add Hostel';
    }
  });
}

document.getElementById('addHostelBtn').onclick = () => {
  openModal('Add Hostel');
  modalBody.innerHTML = hostelForm(null);
  wireHostelForm(null);
};

function editHostel(hostelId) {
  const hostel = hostels.find((h) => h.hostel_id === hostelId);
  if (!hostel) return;
  openModal(`Edit ${hostel.hostel_name}`);
  modalBody.innerHTML = hostelForm(hostel);
  wireHostelForm(hostel);
}

// The server refuses to delete a hostel that still has students, managers or
// complaints, and says which. Surfacing that message verbatim is more useful
// than a generic failure, because it tells the admin what to move first.
async function deleteHostel(hostelId) {
  const hostel = hostels.find((h) => h.hostel_id === hostelId);
  if (!hostel) return;
  if (!confirm(`Delete "${hostel.hostel_name}"? This cannot be undone.`)) return;
  UI.hideAlert('pageError');
  try {
    await API.del(`/hostels/${hostelId}`);
    flashSuccess('Hostel deleted.');
    load();
  } catch (err) {
    UI.showError('pageError', err.message);
  }
}

// --- manager creation ------------------------------------------------------

document.getElementById('addManagerBtn').onclick = () => {
  if (!hostels.length) {
    UI.showError('pageError', 'Add a hostel first — a manager has to be assigned to one.');
    return;
  }
  openModal('Add Manager');
  modalBody.innerHTML = `
    <div id="formError" class="alert alert-error"></div>
    <form id="managerForm" novalidate>
      <div class="form-group">
        <label for="mName">Full Name</label>
        <input type="text" id="mName" maxlength="100" required>
      </div>
      <div class="form-group">
        <label for="mEmail">Email</label>
        <input type="email" id="mEmail" required>
      </div>
      <div class="form-group">
        <label for="mHostel">Hostel</label>
        <select id="mHostel" required>
          <option value="" disabled selected>Select a hostel…</option>
          ${hostels.map((h) => `<option value="${h.hostel_id}">${UI.esc(h.hostel_name)}</option>`).join('')}
        </select>
        <div class="hint">This manager will see only this hostel's complaints and students.</div>
      </div>
      <div class="form-group">
        <label for="mPassword">Initial Password</label>
        <input type="password" id="mPassword" required placeholder="At least 6 characters">
      </div>
      <button type="submit" class="btn" id="mSubmit">Create Manager</button>
      <button type="button" class="btn btn-ghost" id="mCancel">Cancel</button>
    </form>`;

  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('managerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.hideAlert('formError');
    const body = {
      name: document.getElementById('mName').value.trim(),
      email: document.getElementById('mEmail').value.trim(),
      hostel_id: Number(document.getElementById('mHostel').value),
      password: document.getElementById('mPassword').value,
    };
    if (!body.name) return UI.showError('formError', 'Please enter a name.');
    if (!body.email) return UI.showError('formError', 'Please enter an email.');
    if (!body.hostel_id) return UI.showError('formError', 'Please select a hostel.');
    if (body.password.length < 6) return UI.showError('formError', 'Password must be at least 6 characters.');

    const btn = document.getElementById('mSubmit');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      await API.post('/users/managers', body);
      closeModal();
      flashSuccess('Manager created.');
      load();
    } catch (err) {
      UI.showError('formError', err.message);
      btn.disabled = false; btn.textContent = 'Create Manager';
    }
  });
};

load();
