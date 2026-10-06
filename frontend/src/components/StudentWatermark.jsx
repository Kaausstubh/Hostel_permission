import { useMemo } from 'react';

/**
 * StudentWatermark Component
 *
 * Renders an unobtrusive, tamper-resistant forensic visual watermark across
 * the Student Portal.
 *
 * Imprints:
 *  - Student Roll No / MIS
 *  - Student Full Name
 *  - Live Session Date
 *  - Organization / Portal Name
 *
 * Forensic Security:
 *  If an external physical camera photographs the screen, the photographic evidence
 *  is immediately traceable back to the student's authorized account.
 *
 * Performance:
 *  - 100% SVG Data-URI background pattern (zero DOM node duplication overhead).
 *  - pointer-events: none (zero interaction interference).
 */
export default function StudentWatermark({ user }) {
  const watermarkText = useMemo(() => {
    if (!user) return 'HEIMDALL SECURE PORTAL';
    const roll = user.rollNumber || user.roll_no || user.mis || user.studentId || '';
    const name = user.name || 'STUDENT';
    const today = new Date().toISOString().split('T')[0];
    const parts = ['HEIMDALL', roll, name, today].filter(Boolean);
    return parts.join(' • ').toUpperCase();
  }, [user]);

  const svgBackground = useMemo(() => {
    const encodedText = encodeURIComponent(watermarkText);
    // 320x160 SVG tile with 22-degree diagonal rotated text
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="180">
      <text x="20" y="100" fill="rgba(148, 163, 184, 0.055)" font-size="11" font-weight="700" font-family="Inter, -apple-system, sans-serif" letter-spacing="1.2" transform="rotate(-22 170 90)">
        ${encodedText}
      </text>
    </svg>`;
    return `url("data:image/svg+xml;utf8,${svg}")`;
  }, [watermarkText]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        backgroundImage: svgBackground,
        backgroundRepeat: 'repeat',
        mixBlendMode: 'difference',
        opacity: 0.85,
      }}
    />
  );
}
