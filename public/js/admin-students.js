'use strict';

// FR-17 — the admin's view of every registered student account.
// The list is small and already scoped to students by the API, so filtering
// happens in the browser rather than costing a round trip per keystroke.
if (!Auth.requireStaff()) throw new Error('redirecting');
UI.renderNav('students');

const resultArea = document.getElementById('resultArea');
const searchInput = document.getElementById('search');

let students = [];

document.getElementById('clearBtn').onclick = () => {
  searchInput.value = '';
  render();
};
searchInput.addEventListener('input', render);

function flashSuccess(message) {
  UI.showSuccess('pageSuccess', message);
  setTimeout(() => UI.hideAlert('pageSuccess'), 3000);
}

function matches(student, term) {
  if (!term) return true;
  const haystack = [student.name, student.email, student.roll_no, student.hostel_name, student.room_number]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term);
}

const CAN_REMOVE_STUDENTS = !Auth.isSuperAdmin();

function rowHtml(s) {
  return `<tr>
    <td>${UI.esc(s.roll_no || '—')}</td>
    <td>${UI.esc(s.name)}</td>
    <td>${UI.esc(s.email)}</td>
    <td><span class="chip">${UI.esc(s.hostel_name || '—')}</span></td>
    <td>${UI.esc(s.room_number || '—')}</td>
    <td>${UI.fmtDay(s.created_at)}</td>
    ${CAN_REMOVE_STUDENTS ? `<td class="actions">
      <button class="btn btn-sm btn-danger" data-del="${s.user_id}">Remove</button>
    </td>` : ''}
  </tr>`;
}

async function deleteStudent(studentId) {
  const student = students.find((s) => s.user_id === studentId);
  if (!student) return;
  if (!confirm(`Remove student "${student.name}" (${student.roll_no || 'No roll no'})? This will also remove any complaints filed by this student and cannot be undone.`)) return;
  UI.hideAlert('pageError');
  try {
    await API.del(`/users/students/${studentId}`);
    flashSuccess('Student removed successfully.');
    await loadStudents();
  } catch (err) {
    UI.showError('pageError', err.message);
  }
}

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const shown = students.filter((s) => matches(s, term));

  if (students.length === 0) {
    resultArea.innerHTML = '<div class="empty"><div class="big">👥</div>No students have registered yet.</div>';
    return;
  }
  if (shown.length === 0) {
    resultArea.innerHTML = '<div class="empty"><div class="big">🔍</div>No students match your search.</div>';
    return;
  }

  resultArea.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Roll No</th><th>Name</th><th>Email</th><th>Hostel</th><th>Room</th><th>Registered</th>${CAN_REMOVE_STUDENTS ? '<th>Actions</th>' : ''}
      </tr></thead>
      <tbody>${shown.map(rowHtml).join('')}</tbody>
    </table></div>
    <div class="pagination">
      <span class="page-info">Showing ${shown.length} of ${students.length} student${students.length === 1 ? '' : 's'}</span>
    </div>`;

  if (CAN_REMOVE_STUDENTS) {
    resultArea.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => deleteStudent(+b.dataset.del);
    });
  }
}


async function loadStudents() {
  try {
    students = await API.get('/users');
    render();
  } catch (err) {
    resultArea.innerHTML = `<div class="empty">Could not load students: ${UI.esc(err.message)}</div>`;
  }
}

(async () => {
  resultArea.innerHTML = '<div class="loading"><div class="spinner"></div>Loading students…</div>';
  await loadStudents();
})();

