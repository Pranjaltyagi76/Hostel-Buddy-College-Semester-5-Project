'use strict';

// Redirecting an already-signed-in visitor away is handled by js/guard.js
// (data-requires="guest"), which confirms the session with the server first.

const form = document.getElementById('loginForm');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  UI.hideAlert('formError');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) {
    UI.showError('formError', 'Please enter your email and password.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';
  try {
    const { token, user } = await API.post('/auth/login', { email, password });
    Auth.save(token, user);
    location.href = Auth.homeFor(user);
  } catch (err) {
    UI.showError('formError', err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
});
