import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MdArrowBack, MdShield, MdLocationOn, MdPeople, MdSecurity, MdHelpOutline } from 'react-icons/md';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--bg-main, #0b0f19)',
      color: 'var(--text-primary, #f1f5f9)',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      padding: '40px 20px',
      boxSizing: 'border-box',
    }}>
      <div style={{
        maxWidth: '860px',
        margin: '0 auto',
        backgroundColor: 'var(--bg-card, #131b2e)',
        border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
        borderRadius: '20px',
        padding: '36px 32px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.35)',
      }}>
        {/* Navigation Bar */}
        <div style={{ marginBottom: '28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            onClick={() => navigate('/login')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'var(--text-primary, #ffffff)',
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.18s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
          >
            <MdArrowBack size={18} />
            Back to Login
          </button>

          <span style={{
            fontSize: '12px',
            color: 'var(--text-muted, #94a3b8)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 600,
          }}>
            Institutional Policy
          </span>
        </div>

        {/* Header */}
        <div style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          paddingBottom: '24px',
          marginBottom: '32px',
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#60a5fa',
            padding: '6px 14px',
            borderRadius: '999px',
            fontSize: '13px',
            fontWeight: 700,
            marginBottom: '14px',
          }}>
            <MdShield size={16} />
            HEIMDALL · SMART CAMPUS & HOSTEL SYSTEM
          </div>
          <h1 style={{
            fontSize: '28px',
            fontWeight: 800,
            margin: '0 0 10px 0',
            color: '#ffffff',
          }}>
            Privacy Policy
          </h1>
          <p style={{
            fontSize: '14px',
            color: 'var(--text-muted, #94a3b8)',
            margin: 0,
          }}>
            IIIT Pune Hostel Permission, Attendance & Gate Control Management &bull; Last Revised: October 2026
          </p>
        </div>

        {/* Introduction */}
        <section style={{ marginBottom: '32px' }}>
          <p style={{
            fontSize: '15px',
            lineHeight: 1.7,
            color: 'var(--text-secondary, #cbd5e1)',
            margin: 0,
          }}>
            This Privacy Policy governs the collection, processing, and safeguarding of personal data within the
            <strong> HEIMDALL Hostel Permission & Attendance Management System</strong> (&ldquo;Heimdall&rdquo;, &ldquo;we&rdquo;, or &ldquo;the System&rdquo;)
            deployed at <strong>IIIT Pune</strong>. The portal is engineered to streamline out-pass requests, floor-by-floor roll-call attendance,
            bi-directional parent consent, and automated gate security clearance.
          </p>
        </section>

        {/* Section 1: Data We Collect */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 700,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px',
          }}>
            <MdPeople size={20} color="#3b82f6" />
            1. Information Collected
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
          }}>
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '14px',
              padding: '18px',
            }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#93c5fd', margin: '0 0 10px 0' }}>
                Student Profile & Credentials
              </h3>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-secondary, #cbd5e1)' }}>
                <li>Full Name, Roll Number, Academic Department</li>
                <li>Hostel Block, Floor, and Room Allocation</li>
                <li>Institutional Email (Google OAuth single-sign-on)</li>
                <li>Contact phone number</li>
              </ul>
            </div>

            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '14px',
              padding: '18px',
            }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#93c5fd', margin: '0 0 10px 0' }}>
                Guardian & Parent Contact
              </h3>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-secondary, #cbd5e1)' }}>
                <li>Parent/Guardian Full Name and relationship</li>
                <li>Verified contact number for SMS/WhatsApp verification</li>
                <li>Parent email for automated leave approval notifications</li>
                <li>Emergency contact telephone numbers</li>
              </ul>
            </div>

            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '14px',
              padding: '18px',
            }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#93c5fd', margin: '0 0 10px 0' }}>
                Out-Pass & Permission History
              </h3>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-secondary, #cbd5e1)' }}>
                <li>Request category (Day Outing, Overnight Pass, Home Visit, Emergency)</li>
                <li>Intended destination address and reason for leave</li>
                <li>Expected and actual departure/return timestamps</li>
                <li>Warden approval, rejection, or revocation logs</li>
              </ul>
            </div>

            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '14px',
              padding: '18px',
            }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#93c5fd', margin: '0 0 10px 0' }}>
                Security Gate Clearance Logs
              </h3>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-secondary, #cbd5e1)' }}>
                <li>Dynamic QR pass verification scans at main gate</li>
                <li>Actual exit timestamp and verified security officer ID</li>
                <li>Actual return timestamp and overdue flagging</li>
                <li>Visitor gate-pass check-ins and host student tags</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 2: Geofencing */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 700,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px',
          }}>
            <MdLocationOn size={20} color="#10b981" />
            2. Geofencing & Location Transparency
          </h2>
          <div style={{
            background: 'rgba(16, 185, 129, 0.06)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: '14px',
            padding: '20px',
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#34d399', margin: '0 0 8px 0' }}>
              On-Demand Perimeter Verification (Zero Continuous Background Tracking)
            </h3>
            <p style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--text-secondary, #cbd5e1)', margin: '0 0 12px 0' }}>
              Our geofencing service calculates device GPS coordinates strictly on an <strong>on-demand, event-triggered basis</strong>:
            </p>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', lineHeight: 1.65, color: 'var(--text-secondary, #cbd5e1)' }}>
              <li><strong>No Background Surveillance:</strong> The system does not track your coordinates in the background, record your path of travel, or monitor off-campus locations.</li>
              <li><strong>Attendance Boundary Check:</strong> Location is requested solely at the specific moment a student triggers self-attendance or checks in to confirm presence within the designated hostel boundary.</li>
              <li><strong>Anti-Proxy Protection:</strong> Coordinates are compared against campus geofence polygons solely to validate physical proximity.</li>
            </ul>
          </div>
        </section>

        {/* Section 3: Role-Based Access */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 700,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px',
          }}>
            <MdSecurity size={20} color="#f59e0b" />
            3. Role-Based Access Control & Privacy Safeguards
          </h2>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', lineHeight: 1.7, color: 'var(--text-secondary, #cbd5e1)' }}>
            <li><strong>Students:</strong> Access is limited to your own profile, submitted leave records, and real-time pass status.</li>
            <li><strong>Hostel Staff & Wardens:</strong> Granted oversight exclusively for students under their assigned hostel wings and floors.</li>
            <li><strong>Security Personnel:</strong> Access is restricted to real-time QR code validation and gate entry/exit logging.</li>
            <li><strong>Parents & Guardians:</strong> Authenticated access strictly to their own ward’s requests and response history.</li>
            <li><strong>Zero Commercial Monetization:</strong> No personal details, logs, or contact numbers are ever monetized, sold, or shared with commercial entities.</li>
          </ul>
        </section>

        {/* Section 4: Data Security & Retention */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 700,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px',
          }}>
            <MdShield size={20} color="#a855f7" />
            4. Data Security & Storage
          </h2>
          <p style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--text-secondary, #cbd5e1)', margin: 0 }}>
            All transmissions between client devices and the server are encrypted using Transport Layer Security (TLS/HTTPS).
            Authentication utilizes industry-standard Google OAuth 2.0 with JSON Web Tokens (JWT). Records are retained
            in accordance with the IIIT Pune hostel administration guidelines for safety and audit compliance.
          </p>
        </section>

        {/* Section 5: Support & Inquiries */}
        <section style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          paddingTop: '24px',
        }}>
          <h2 style={{
            fontSize: '16px',
            fontWeight: 700,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '10px',
          }}>
            <MdHelpOutline size={18} color="#60a5fa" />
            5. Inquiries & Hostel Administration Office
          </h2>
          <p style={{ fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-muted, #94a3b8)', margin: 0 }}>
            For privacy queries, data verification, or geofence boundary calibration questions, please contact the
            <strong> IIIT Pune Hostel Administration Office</strong> or reach out via official campus channels.
          </p>
        </section>

      </div>
    </div>
  );
}
