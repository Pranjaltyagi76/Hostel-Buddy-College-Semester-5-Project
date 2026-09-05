'use strict';

// data-requires="guest" + js/guard.js send an already-signed-in visitor home.

const form = document.getElementById('registerForm');
const submitBtn = document.getElementById('submitBtn');
const hostelSelect = document.getElementById('hostel');

// Every student belongs to a hostel, so the list has to be loaded before anyone
// can register. This is the one API call the app makes without a session.
(async () => {
  try {
    const hostels = await API.get('/hostels');
    if (!hostels.length) {
      hostelSelect.innerHTML = '<option value="">No hostels available</option>';
      UI.showError('formError', 'No hostels have been set up yet. Please contact the administrator.');
      submitBtn.disabled = true;
      return;
    }
    hostelSelect.innerHTML =
      '<option value="" disabled selected>Select your hostel…</option>' +
      hostels
        .map((h) => `<option value="${h.hostel_id}">${UI.esc(h.hostel_name)}</option>`)
        .join('');
  } catch (err) {
    hostelSelect.innerHTML = '<option value="">Could not load hostels</option>';
    UI.showError('formError', 'Could not load the hostel list. Please refresh and try again.');
    submitBtn.disabled = true;
  }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  UI.hideAlert('formError');

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const roll_no = document.getElementById('rollNo').value.trim();
  const hostel_id = hostelSelect.value;
  const room_number = document.getElementById('room').value.trim();
  const password = document.getElementById('password').value;

  // Client-side checks for fast feedback (the server validates too).
  if (!name) return UI.showError('formError', 'Please enter your name.');
  if (!email) return UI.showError('formError', 'Please enter your email.');
  if (!roll_no) return UI.showError('formError', 'Please enter your roll number.');
  if (!hostel_id) return UI.showError('formError', 'Please select your hostel.');
  if (password.length < 6) return UI.showError('formError', 'Password must be at least 6 characters.');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account…';
  try {
    const { token, user } = await API.post('/auth/register', {
      name,
      email,
      password,
      roll_no,
      hostel_id: Number(hostel_id),
      room_number,
    });
    Auth.save(token, user);
    location.href = Auth.homeFor(user);
  } catch (err) {
    UI.showError('formError', err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
});
