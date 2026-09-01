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

  // --- Roles ---
  // A manager and a super admin are both "staff": they share the admin screens.
  // Where they differ is scope — the server narrows a manager to their own
  // hostel — plus the super-admin-only Hostels page.
  isStaff(user) {
    const u = user || this.getUser();
    return !!u && (u.role === 'manager' || u.role === 'super_admin');
  },
  isSuperAdmin(user) {
    const u = user || this.getUser();
    return !!u && u.role === 'super_admin';
  },

  homeFor(user) {
    return this.isStaff(user) ? 'admin.html' : 'dashboard.html';
  },

  // --- Page guards (call at the top of a page script) ---
  requireStudent() {
    const user = this.getUser();
    if (!this.isLoggedIn() || !user) { location.href = 'login.html'; return false; }
    if (user.role !== 'student') { location.href = 'admin.html'; return false; }
    return true;
  },
  // Either staff role — the shared admin screens.
  requireStaff() {
    const user = this.getUser();
    if (!this.isLoggedIn() || !user) { location.href = 'login.html'; return false; }
    if (!this.isStaff(user)) { location.href = 'dashboard.html'; return false; }
    return true;
  },
  // Super admin only — hostel and manager management. A manager landing here
  // is sent back to the admin dashboard rather than to login: they are signed
  // in perfectly well, just not for this page.
  requireSuperAdmin() {
    const user = this.getUser();
    if (!this.isLoggedIn() || !user) { location.href = 'login.html'; return false; }
    if (!this.isSuperAdmin(user)) { location.href = 'admin.html'; return false; }
    return true;
  },
};

window.Auth = Auth;
