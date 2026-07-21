'use strict';

if (!Auth.requireStudent()) throw new Error('redirecting');
UI.renderNav('profile');

const nameEl = document.getElementById('name');
const roomEl = document.getElementById('room');
const emailEl = document.getElementById('email');
const form = document.getElementById('profileForm');
const submitBtn = document.getElementById('submitBtn');

(async () => {
  try {
    const me = await API.get('/users/me');
    nameEl.value = me.name || '';
    roomEl.value = me.room_number || '';
    emailEl.value = me.email || '';
  } catch (err) {
    UI.showError('formError', 'Could not load profile: ' + err.message);
  }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  UI.hideAlert('formError'); UI.hideAlert('formSuccess');

  const name = nameEl.value.trim();
  const room_number = roomEl.value.trim();
  if (!name) return UI.showError('formError', 'Name cannot be empty.');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  try {
    const updated = await API.put('/users/me', { name, room_number });
    // Keep the cached user (used by the nav) in sync.
    const user = Auth.getUser();
    user.name = updated.name;
    Auth.save(Auth.getToken(), user);
    UI.renderNav('profile');
    UI.showSuccess('formSuccess', 'Profile updated.');
  } catch (err) {
    UI.showError('formError', err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Changes';
  }
});
