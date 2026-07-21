'use strict';

// Client-side session handling. The JWT and a small user snapshot live in
// localStorage; page guards redirect based on role.
const Auth = {
  TOKEN_KEY: 'hb_token',
  USER_KEY: 'hb_user',

  save(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },
  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },
  getUser() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY)); }
    catch { return null; }
  },
  isLoggedIn() {
    return !!this.getToken();
  },
  clear() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },
  logout() {
    this.clear();
    location.href = 'login.html';
  },

  homeFor(user) {
    return user && user.role === 'admin' ? 'admin.html' : 'dashboard.html';
  },

  // --- Page guards (call at the top of a page script) ---
  requireStudent() {
    const user = this.getUser();
    if (!this.isLoggedIn() || !user) { location.href = 'login.html'; return false; }
    if (user.role !== 'student') { location.href = 'admin.html'; return false; }
    return true;
  },
  requireAdmin() {
    const user = this.getUser();
    if (!this.isLoggedIn() || !user) { location.href = 'login.html'; return false; }
    if (user.role !== 'admin') { location.href = 'dashboard.html'; return false; }
    return true;
  },
};

window.Auth = Auth;
