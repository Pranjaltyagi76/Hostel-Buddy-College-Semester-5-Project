'use strict';

// Fixed, controlled vocabularies used across the application.
// Keeping them in one place means adding a category or a role is a one-line change.

const CATEGORIES = [
  'Electricity',
  'Plumbing',
  'Water Supply',
  'Wi-Fi',
  'Cleaning',
  'Furniture',
  'Security',
  'Other',
];

// The complaint lifecycle, in forward order.
const STATUSES = ['Pending', 'In Progress', 'Resolved', 'Closed'];

const ROLES = {
  STUDENT: 'student',
  ADMIN: 'admin',
};

module.exports = { CATEGORIES, STATUSES, ROLES };
