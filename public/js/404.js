'use strict';

// Point the "back" link at wherever this visitor actually belongs: their own
// dashboard when signed in, the landing page otherwise.
const backLink = document.querySelector('.auth-card .btn');

if (backLink && Auth.isLoggedIn()) {
  const user = Auth.getUser();
  if (user) {
    backLink.href = '/' + Auth.homeFor(user);
    backLink.textContent = 'Back to my dashboard';
  }
}
