import { useState, useEffect } from 'react';
import { resolvePhotoUrl } from '../services/backendUrl';

/**
 * Robust student avatar component that intelligently resolves:
 * 1. Verified official registration face photo (studentPhoto)
 * 2. Scan record snapshot (student_photo, if not a generic Google letter avatar)
 * 3. Profile picture (if not a generic Google letter avatar)
 * 4. Fallback to initials badge with clean error recovery
 */
export default function StudentAvatar({
  student,
  recordPhoto,
  name,
  size = 34,
  style = {},
}) {
  const [imgError, setImgError] = useState(false);

  // Intelligently resolve the most authoritative actual face photo
  const resolvedUrl = (() => {
    // 1. Student's verified face photo taken during onboarding/registration
    if (student?.studentPhoto) {
      return resolvePhotoUrl(student.studentPhoto);
    }
    // 2. Snapshot photo saved on the scan record
    if (recordPhoto) {
      return resolvePhotoUrl(recordPhoto);
    }
    // 3. User's profile picture (including Google OAuth profile photo)
    if (student?.picture) {
      return resolvePhotoUrl(student.picture);
    }
    // 4. User's photo property
    if (student?.photo) {
      return resolvePhotoUrl(student.photo);
    }
    // 5. If student ID exists, use fast cached binary photo endpoint
    const studentId = student?._id || student?.id;
    if (studentId) {
      return resolvePhotoUrl(`/api/auth/student-photo/${studentId}`);
    }
    return null;
  })();

  const photoUrl = resolvedUrl;

  // Reset image error state whenever resolved photo URL changes
  useEffect(() => {
    setImgError(false);
  }, [photoUrl]);

  const studentName = student?.name || name || 'Student';
  const initial = studentName.trim()[0]?.toUpperCase() || 'S';

  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={studentName}
        onError={() => setImgError(true)}
        loading="lazy"
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          border: '1.5px solid var(--border-color)',
          ...style,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'rgba(99, 102, 241, 0.15)',
        color: 'var(--primary-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: Math.max(11, Math.round(size * 0.38)),
        flexShrink: 0,
        ...style,
      }}
      title={studentName}
    >
      {initial}
    </div>
  );
}
