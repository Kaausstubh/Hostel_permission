/**
 * StudentAttendanceManager Component
 *
 * Mounts the real-time attendance listener globally across all student screens.
 * When staff requests attendance for the student's room:
 * 1. Automatically intercepts the request.
 * 2. Displays the 5-minute countdown modal.
 * 3. Handles 1-click GPS geofence verification.
 */

import { useAuth } from '../context/AuthContext';
import { useAttendanceListener } from '../hooks/useAttendanceListener';
import GlobalStudentAttendanceModal from './GlobalStudentAttendanceModal';

export default function StudentAttendanceManager() {
  const { user } = useAuth();
  const { activeRequest, dismissRequest, checkPending } = useAttendanceListener(user, {
    enabled: user?.role === 'student',
  });

  if (!activeRequest) return null;

  return (
    <GlobalStudentAttendanceModal
      request={activeRequest}
      onDismiss={dismissRequest}
      onVerified={() => {
        checkPending(true);
      }}
    />
  );
}
