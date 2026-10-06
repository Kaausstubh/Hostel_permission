import StudentProtectionProvider from './StudentProtectionProvider';

/**
 * StudentLayout
 *
 * Dedicated layout wrapper for all student routes (/student, /onboarding).
 * This is the SINGLE mount-point for capture-deterrence — it wraps the
 * student page in StudentProtectionProvider.
 *
 * Mount in App.jsx like:
 *   <ProtectedRoute allowedRoles={['student']}>
 *     <StudentLayout><StudentDashboard /></StudentLayout>
 *   </ProtectedRoute>
 *
 * When the student navigates to guard/warden/admin/login, React unmounts
 * this component, which automatically:
 *   - Removes all event listeners (visibility, blur, keyboard, etc.)
 *   - Removes the privacy overlay
 *   - Disables FLAG_SECURE via the native bridge
 *   - Removes the forensic watermark
 *   - Restores the original document.title
 *
 * Guard, warden, admin, and public pages NEVER render this component.
 */
export default function StudentLayout({ children }) {
  return (
    <StudentProtectionProvider>
      {children}
    </StudentProtectionProvider>
  );
}
