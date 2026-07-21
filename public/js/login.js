'use strict';

// Redirect away if already signed in.
if (Auth.isLoggedIn()) location.href = Auth.homeFor(Auth.getUser());

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
