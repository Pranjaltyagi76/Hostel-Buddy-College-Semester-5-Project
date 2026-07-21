'use strict';

// If already logged in, skip the landing page and go to the right home.
if (Auth.isLoggedIn()) {
  location.href = Auth.homeFor(Auth.getUser());
}
