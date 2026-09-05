'use strict';

// Page access control, enforced BEFORE the page renders.
//
// This file must be loaded from <head>, ahead of the stylesheet and of every
// other script. That placement is the whole point: a <script> in the head
// blocks HTML parsing, so if the check fails the browser navigates away
// without ever parsing — let alone painting — the protected markup below.
//
// The guards used to live at the bottom of the body, after the page content
// and after the 192 KB chart library. Signing out and pressing reload showed
// the admin dashboard for as long as all of that took to load, which is the
// bug this fixes.
//
// Each protected page declares what it needs on the <html> element:
//   <html lang="en" data-requires="student">   student only
//   <html lang="en" data-requires="staff">     manager or super admin
//   <html lang="en" data-requires="super">     super admin only
//   <html lang="en" data-requires="guest">     signed-out visitors only
//
// The server remains the real authority. Everything here is about showing the
// right person the right page; no data is protected by this file, because
// every byte of data comes from an API route that checks the token itself.

(function () {
  const REQUIREMENT = document.documentElement.dataset.requires;
  if (!REQUIREMENT) return; // a public page — nothing to enforce

  // Does the role we believe the user has satisfy what this page asks for?
  function satisfies(user) {
    if (!user || !user.role) return false;
    if (REQUIREMENT === 'student') return user.role === 'student';
    if (REQUIREMENT === 'staff') return Auth.isStaff(user);
    if (REQUIREMENT === 'super') return Auth.isSuperAdmin(user);
    return false;
  }

  // Where a request that fails the check should end up.
  //
  // Being signed in as the wrong role is not an authentication failure — a
  // manager who opens the Hostels page is perfectly well signed in, just not
  // for that page — so they go to their own home rather than to login.
  //
  // location.replace, never location.href: the page being left must not stay
  // in the history, or the Back button walks straight back into it.
  function sendAway(user) {
    location.replace(user ? Auth.homeFor(user) : 'login.html');
  }

  // The synchronous gate. Runs before the body is parsed.
  function enforceLocally() {
    const user = Auth.getUser();

    // A signed-out-only page (login, register, the landing page) is the mirror
    // image: it is the presence of a session that fails the check. That one is
    // left entirely to the server below, because a stale token here would
    // otherwise bounce the visitor to a dashboard and straight back again once
    // the token turned out to be dead. Showing the login form for a moment
    // beats sending someone on a round trip to find out they are signed out.
    if (REQUIREMENT === 'guest') return true;

    if (!Auth.isLoggedIn() || !user) {
      location.replace('login.html');
      return false;
    }
    if (!satisfies(user)) {
      sendAway(user);
      return false;
    }
    return true;
  }

  // The asynchronous half: ask the server who this actually is.
  //
  // The check above trusts localStorage, which the person sitting at the
  // browser can edit — writing themselves a super_admin role takes one line in
  // a console. That never yielded any data, because the API checks the token
  // on every request, but it did render the shell of a page they had no
  // business seeing. This settles it against the only opinion that counts.
  //
  // It also refreshes the cached snapshot, so a manager who has been moved to
  // a different hostel stops seeing the old hostel's name in the nav without
  // having to sign out and back in.
  async function confirmWithServer() {
    const token = Auth.getToken();
    if (!token) return;

    let res;
    try {
      res = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      return; // offline or the server is down — leave the page alone
    }

    if (res.status === 401) {
      // Expired, tampered with, or revoked. There is no session here.
      Auth.clear();
      location.replace('login.html');
      return;
    }
    if (!res.ok) return; // some other server-side problem; not a verdict on the session

    const fresh = await res.json();
    Auth.saveUser(fresh);

    if (REQUIREMENT === 'guest') {
      location.replace(Auth.homeFor(fresh));
      return;
    }
    if (!satisfies(fresh)) sendAway(fresh);
  }

  function enforce() {
    if (enforceLocally()) confirmWithServer();
  }

  enforce();

  // Restoring a page from the back/forward cache runs no script at all: the
  // browser puts back the fully rendered page, data and all. Without this, the
  // Back button after signing out returns to a populated dashboard.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) enforce();
  });
})();
