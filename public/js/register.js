'use strict';

if (Auth.isLoggedIn()) location.href = Auth.homeFor(Auth.getUser());

const form = document.getElementById('registerForm');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  UI.hideAlert('formError');

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const room_number = document.getElementById('room').value.trim();
  const password = document.getElementById('password').value;

  // Client-side checks for fast feedback (the server validates too).
  if (!name) return UI.showError('formError', 'Please enter your name.');
  if (!email) return UI.showError('formError', 'Please enter your email.');
  if (password.length < 6) return UI.showError('formError', 'Password must be at least 6 characters.');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account…';
  try {
    const { token, user } = await API.post('/auth/register', { name, email, room_number, password });
    Auth.save(token, user);
    location.href = Auth.homeFor(user);
  } catch (err) {
    UI.showError('formError', err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
});
