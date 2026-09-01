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

// The three user types of the ISA hierarchy. `role` on the USER row is the
// discriminator: it says which subtype table holds that user's extra fields.
const ROLES = {
  STUDENT: 'student',
  MANAGER: 'manager',
  SUPER_ADMIN: 'super_admin',
};

// The roles that administer complaints. A manager is scoped to their own
// hostel; a super admin is unscoped and sees every hostel. Routes that used to
// require the single 'admin' role now require membership of this set, and the
// service layer applies the hostel filter.
const STAFF_ROLES = [ROLES.MANAGER, ROLES.SUPER_ADMIN];

module.exports = { CATEGORIES, STATUSES, ROLES, STAFF_ROLES };
