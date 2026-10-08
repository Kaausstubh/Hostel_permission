/**
 * Shared Visitor Purpose Constants
 * Used across Backend validations, Frontend selectors, and Google Form integration.
 */

const VISITOR_PURPOSES = [
  'Meeting a student',
  'Delivery / Courier',
  'Official / Campus Visit',
  'Guest House / Visiting Faculty',
  'Maintenance / Vendor',
  'Other',
];

const PURPOSE_STUDENT_REQUIRED = 'Meeting a student';
const PURPOSE_OTHER = 'Other';

module.exports = {
  VISITOR_PURPOSES,
  PURPOSE_STUDENT_REQUIRED,
  PURPOSE_OTHER,
};
