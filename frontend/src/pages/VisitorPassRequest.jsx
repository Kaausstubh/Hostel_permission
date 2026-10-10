/**
 * Visitor Pass Self Check-In Page — Public Kiosk & Gate Webpage
 *
 * Replaces the static Google Form with an integrated real-time self-service webpage:
 *  - Connects directly to MongoDB to retrieve and search enrolled students by Name & MIS (Roll No)
 *  - Recommends matching students with live hostel & room details
 *  - Dispatches instant real-time approval notifications directly to the student portal
 *  - Automatically updates the visitor's screen when the student Approves or Declines
 *  - Fully standalone and public (does NOT appear as a link on the student portal)
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { resolveBackendOrigin } from '../services/backendUrl';
import { getHostelLabel, HOSTEL_OPTIONS } from '../utils/hostel';
import { useTheme } from '../context/ThemeContext';
import io from 'socket.io-client';
import toast from 'react-hot-toast';
import {
  MdSecurity,
  MdPerson,
  MdPhone,
  MdDirectionsCar,
  MdCheckCircle,
  MdCancel,
  MdAccessTime,
  MdSearch,
  MdClear,
  MdMeetingRoom,
  MdGroup,
  MdBadge,
  MdApartment,
  MdLightMode,
  MdDarkMode,
  MdQrCodeScanner,
  MdArrowBack,
  MdSend,
  MdInfoOutline,
  MdLocationOn,
} from 'react-icons/md';

const VISITOR_PURPOSES = [
  'Meeting a student',
  'Delivery / Courier',
  'Official / Campus Visit',
  'Guest House / Visiting Faculty',
  'Maintenance / Vendor',
  'Other',
];

export default function VisitorPassRequest() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  // ── Database & Student Stats ───────────────────────────────────────────────
  const [totalStudents, setTotalStudents] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);

  // ── Form State ─────────────────────────────────────────────────────────────
  const [purpose, setPurpose] = useState('Meeting a student');
  const [purposeDetails, setPurposeDetails] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitorCount, setVisitorCount] = useState(1);
  const [hasVehicle, setHasVehicle] = useState(false);
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [entryGate, setEntryGate] = useState('Main Gate');

  // ── Student Search & Recommendation State ──────────────────────────────────
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [manualStudentMode, setManualStudentMode] = useState(false);
  const [manualStudent, setManualStudent] = useState({
    name: '',
    rollNo: '',
    hostel: 'BH1',
    roomNo: '',
  });

  // ── Submission & Real-time Pass Tracking ───────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [createdPass, setCreatedPass] = useState(null);
  const [liveStatus, setLiveStatus] = useState('PENDING'); // PENDING | APPROVED | REJECTED | INSIDE
  const [statusRemarks, setStatusRemarks] = useState('');
  const [timeElapsed, setTimeElapsed] = useState(0);

  const searchBoxRef = useRef(null);
  const socketRef = useRef(null);

  // ── 1. Fetch Student Database Stats ─────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    api
      .get('/visitors/public/stats')
      .then((res) => {
        if (isMounted && res.data?.success) {
          setTotalStudents(res.data.totalStudents || 0);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setLoadingStats(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // ── 2. Real-time Student Autocomplete & Recommendations ────────────────────
  useEffect(() => {
    if (manualStudentMode || selectedStudent) return;

    const timer = setTimeout(async () => {
      setSearchingStudents(true);
      try {
        const q = studentQuery.trim();
        const res = await api.get(`/visitors/public/students-search?q=${encodeURIComponent(q)}`);
        if (res.data?.success) {
          setStudentResults(res.data.students || []);
          if (res.data.totalStudents) {
            setTotalStudents(res.data.totalStudents);
          }
        }
      } catch (err) {
        console.warn('[Visitor Web] Student search failed:', err);
      } finally {
        setSearchingStudents(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [studentQuery, manualStudentMode, selectedStudent]);

  // Click outside search results to close dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── 3. Elapsed Time Counter for Pending Pass ───────────────────────────────
  useEffect(() => {
    if (!createdPass || liveStatus !== 'PENDING') return;

    const interval = setInterval(() => {
      setTimeElapsed((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [createdPass, liveStatus]);

  // ── 4. Live Socket & Polling for Pass Approval ──────────────────────────────
  useEffect(() => {
    if (!createdPass?._id) return;

    const passId = createdPass._id;
    const backendOrigin = resolveBackendOrigin();

    // Secondary Polling Fallback (every 3 seconds)
    const pollInterval = setInterval(async () => {
      try {
        const res = await api.get(`/visitors/public/pass-status/${passId}`);
        if (res.data?.success && res.data.visitor) {
          const v = res.data.visitor;
          if (v.studentApprovalStatus === 'APPROVED' || v.status === 'INSIDE') {
            setLiveStatus('APPROVED');
            if (v.studentApprovalRemarks) setStatusRemarks(v.studentApprovalRemarks);
          } else if (v.studentApprovalStatus === 'REJECTED' || v.status === 'REJECTED') {
            setLiveStatus('REJECTED');
            if (v.studentApprovalRemarks) setStatusRemarks(v.studentApprovalRemarks);
          }
        }
      } catch (_) {}
    }, 3000);

    // Primary Socket.IO Real-time Connection
    try {
      const socket = io(backendOrigin, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
      });
      socketRef.current = socket;

      socket.on('visitor:student_response', (data) => {
        const vId = data?.visitor?._id || data?.visitorId;
        if (vId === passId) {
          if (data.action === 'APPROVE') {
            setLiveStatus('APPROVED');
            toast.success('Pass approved by student! Entry granted.', { icon: '✅', duration: 5000 });
          } else {
            setLiveStatus('REJECTED');
            if (data.remarks) setStatusRemarks(data.remarks);
            toast.error('Pass request declined by student.', { duration: 5000 });
          }
        }
      });

      socket.on('visitor:resolved', (data) => {
        const vId = data?.visitor?._id || data?.visitorId;
        if (vId === passId) {
          if (data.action === 'APPROVE') {
            setLiveStatus('APPROVED');
          } else {
            setLiveStatus('REJECTED');
            if (data.remarks) setStatusRemarks(data.remarks);
          }
        }
      });
    } catch (err) {
      console.warn('[Visitor Web] Socket connection warning:', err);
    }

    return () => {
      clearInterval(pollInterval);
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [createdPass]);

  // ── Student Selection Handlers ─────────────────────────────────────────────
  const handleSelectStudent = (student) => {
    setSelectedStudent(student);
    setStudentQuery('');
    setStudentResults([]);
    setIsSearchFocused(false);
  };

  const handleClearStudent = () => {
    setSelectedStudent(null);
    setStudentQuery('');
    setManualStudentMode(false);
  };

  // ── Form Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!visitorName.trim()) {
      return toast.error('Please enter your full name');
    }

    const cleanPhone = visitorPhone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return toast.error('Please enter a valid 10-digit mobile number');
    }

    const isStudentVisit = purpose === 'Meeting a student';
    if (isStudentVisit) {
      if (!manualStudentMode && !selectedStudent) {
        return toast.error('Please select a student from the MongoDB directory or switch to manual entry');
      }
      if (manualStudentMode && (!manualStudent.name.trim() || !manualStudent.roomNo.trim())) {
        return toast.error('Please provide student name, hostel, and room number');
      }
    }

    if (purpose === 'Other' && !purposeDetails.trim()) {
      return toast.error('Please describe the specific reason for your visit');
    }

    if (hasVehicle && !vehicleNumber.trim()) {
      return toast.error('Please provide your vehicle registration number');
    }

    setSubmitting(true);
    try {
      const payload = {
        name: visitorName.trim(),
        phone: cleanPhone,
        purpose,
        purposeDetails: purpose === 'Other' ? purposeDetails.trim() : '',
        visitorCount: Number(visitorCount) || 1,
        hasVehicle,
        vehicleNumber: hasVehicle ? vehicleNumber.trim() : null,
        entryGate,
      };

      if (isStudentVisit) {
        if (selectedStudent) {
          payload.student_id = selectedStudent._id;
          payload.studentName = selectedStudent.name;
          payload.studentRollNo = selectedStudent.rollNo || '';
          payload.studentHostel = selectedStudent.hostel || '';
          payload.studentRoomNo = selectedStudent.roomNo || '';
        } else {
          payload.studentName = manualStudent.name.trim();
          payload.studentRollNo = manualStudent.rollNo.trim();
          payload.studentHostel = manualStudent.hostel;
          payload.studentRoomNo = manualStudent.roomNo.trim();
        }
      }

      const res = await api.post('/visitors/public/register', payload);

      if (res.data?.success) {
        const v = res.data.visitor;
        setCreatedPass(v);
        setLiveStatus(v.status || (isStudentVisit ? 'PENDING' : 'INSIDE'));
        toast.success(
          isStudentVisit
            ? 'Request sent! We have alerted the student portal for approval.'
            : 'Visitor pass issued successfully!'
        );
      } else {
        toast.error(res.data?.message || 'Failed to submit visitor pass request');
      }
    } catch (err) {
      console.error('[Visitor Web] Submit error:', err);
      toast.error(err.response?.data?.message || 'Failed to submit visitor pass request. Please check inputs.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatSeconds = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: Pass Created / Real-Time Tracking
  // ─────────────────────────────────────────────────────────────────────────
  if (createdPass) {
    const isStudentVisit = createdPass.purpose === 'Meeting a student';
    const isApproved = liveStatus === 'APPROVED' || liveStatus === 'INSIDE';
    const isRejected = liveStatus === 'REJECTED';
    const isPending = liveStatus === 'PENDING';

    return (
      <div style={containerStyle}>
        {/* Header Bar */}
        <header style={headerBarStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🏛️</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                HEIMDALL SMART CAMPUS
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>IIIT Pune Campus Digital Gate Pass</div>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            style={themeToggleStyle}
            aria-label="Toggle theme"
            title="Toggle light/dark theme"
          >
            {theme === 'dark' ? <MdLightMode size={18} color="#f59e0b" /> : <MdDarkMode size={18} color="#6366f1" />}
          </button>
        </header>

        <main style={{ maxWidth: 560, margin: '24px auto', padding: '0 16px' }}>
          {/* Status Card */}
          <div
            style={{
              background: isApproved
                ? 'linear-gradient(145deg, rgba(16, 185, 129, 0.12), rgba(5, 150, 105, 0.05))'
                : isRejected
                ? 'linear-gradient(145deg, rgba(239, 68, 68, 0.12), rgba(185, 28, 28, 0.05))'
                : 'linear-gradient(145deg, rgba(99, 102, 241, 0.12), rgba(79, 70, 229, 0.05))',
              border: `2px solid ${
                isApproved ? '#10b981' : isRejected ? '#ef4444' : '#6366f1'
              }`,
              borderRadius: 20,
              padding: '24px 20px',
              textAlign: 'center',
              boxShadow: isApproved
                ? '0 12px 36px rgba(16, 185, 129, 0.2)'
                : isRejected
                ? '0 12px 36px rgba(239, 68, 68, 0.2)'
                : '0 12px 36px rgba(99, 102, 241, 0.2)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Status Icon & Indicator */}
            {isPending && (
              <div style={{ marginBottom: 14 }}>
                <div style={pulsingRadarRingStyle} />
                <div
                  style={{
                    width: 60,
                    height: 60,
                    margin: '0 auto',
                    borderRadius: '50%',
                    background: 'rgba(99, 102, 241, 0.2)',
                    color: '#6366f1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MdAccessTime size={32} />
                </div>
              </div>
            )}

            {isApproved && (
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    width: 60,
                    height: 60,
                    margin: '0 auto',
                    borderRadius: '50%',
                    background: '#10b981',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 6px 20px rgba(16, 185, 129, 0.4)',
                  }}
                >
                  <MdCheckCircle size={36} />
                </div>
              </div>
            )}

            {isRejected && (
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    width: 60,
                    height: 60,
                    margin: '0 auto',
                    borderRadius: '50%',
                    background: '#ef4444',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 6px 20px rgba(239, 68, 68, 0.4)',
                  }}
                >
                  <MdCancel size={36} />
                </div>
              </div>
            )}

            {/* Status Heading */}
            <h2
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: isApproved ? '#10b981' : isRejected ? '#ef4444' : 'var(--text-primary)',
                marginBottom: 6,
                letterSpacing: '-0.02em',
              }}
            >
              {isApproved
                ? 'Entry Pass Approved!'
                : isRejected
                ? 'Request Declined by Student'
                : 'Awaiting Student Approval'}
            </h2>

            {/* Pass Number Pill */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border)',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 16,
              }}
            >
              <span>Pass #</span>
              <span style={{ fontFamily: 'monospace', color: '#6366f1' }}>{createdPass.passNumber}</span>
            </div>

            {/* Status Subtitle Instructions */}
            <p
              style={{
                fontSize: 13.5,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                maxWidth: 440,
                margin: '0 auto 16px',
              }}
            >
              {isApproved &&
                'Your entry pass is active. Please present this screen to the security guard at the gate for admission.'}
              {isPending &&
                `We have sent an instant notification to ${createdPass.studentName}'s student portal. As soon as the student taps Approve, this screen will update automatically.`}
              {isRejected &&
                (statusRemarks
                  ? `Student remarks: "${statusRemarks}"`
                  : 'The student has declined this visit request. Please contact campus security for assistance.')}
            </p>

            {/* Live Timer if pending */}
            {isPending && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />
                <span>Waiting for response: {formatSeconds(timeElapsed)}</span>
              </div>
            )}
          </div>

          {/* Pass Details Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 20,
              marginTop: 18,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 14,
              }}
            >
              Pass Information
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Visitor Name</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                  {createdPass.name}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Party Headcount</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                  {createdPass.visitorCount} {createdPass.visitorCount === 1 ? 'person' : 'people'}
                </div>
              </div>

              {isStudentVisit && (
                <>
                  <div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Host Student</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                      {createdPass.studentName}
                    </div>
                    {createdPass.studentRollNo && (
                      <div style={{ fontSize: 11.5, color: '#6366f1', marginTop: 1 }}>
                        MIS: {createdPass.studentRollNo}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Host Location</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                      {getHostelLabel(createdPass.studentHostel)}, Rm {createdPass.studentRoomNo}
                    </div>
                  </div>
                </>
              )}

              <div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Purpose of Visit</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                  {createdPass.purpose}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Entry Gate</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                  {createdPass.entryGate}
                </div>
              </div>

              {createdPass.hasVehicle && (
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Vehicle Registered</div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace',
                      marginTop: 2,
                    }}
                  >
                    🚗 {createdPass.vehicleNumber}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            {isRejected ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setCreatedPass(null);
                  setSelectedStudent(null);
                  setLiveStatus('PENDING');
                }}
                style={{ flex: 1, padding: '14px', borderRadius: 12, fontWeight: 700 }}
              >
                Submit New Request
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.print()}
                style={{ flex: 1, padding: '14px', borderRadius: 12, fontWeight: 700 }}
              >
                Print / Save Pass
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: Visitor Registration Form
  // ─────────────────────────────────────────────────────────────────────────
  const isStudentVisit = purpose === 'Meeting a student';

  return (
    <div style={containerStyle}>
      {/* Header Bar */}
      <header style={headerBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 20,
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
            }}
          >
            🏛️
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              HEIMDALL SMART CAMPUS
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Visitor Self Check-In & Gate Pass</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={toggleTheme}
            style={themeToggleStyle}
            aria-label="Toggle theme"
            title="Toggle light/dark theme"
          >
            {theme === 'dark' ? <MdLightMode size={18} color="#f59e0b" /> : <MdDarkMode size={18} color="#6366f1" />}
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: '20px auto', padding: '0 16px 40px' }}>
        {/* MongoDB Student Directory Live Connectivity Strip */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(16, 185, 129, 0.08))',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: 14,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 10px #10b981',
              }}
            />
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                MongoDB Student Directory Connected
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {loadingStats ? (
                  'Synchronizing student records…'
                ) : (
                  <span>
                    <strong>{totalStudents}</strong> registered students accessible for instant approval
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '4px 10px',
              borderRadius: 20,
              background: 'rgba(99, 102, 241, 0.15)',
              fontSize: 11,
              fontWeight: 700,
              color: '#6366f1',
            }}
          >
            Instant Notification
          </div>
        </div>

        {/* Check-In Card Form */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '24px 22px',
            boxShadow: 'var(--shadow-card, 0 8px 30px rgba(0, 0, 0, 0.12))',
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: 'var(--text-primary)',
                marginBottom: 4,
              }}
            >
              Issue Campus Visitor Pass
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Fill in your visit details below. For student visits, an instant approval alert will be sent directly to the
              student portal.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* 1. Purpose of Visit */}
            <div className="form-group" style={{ marginBottom: 18 }}>
              <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>
                Purpose of Visit *
              </label>
              <select
                className="form-select"
                value={purpose}
                onChange={(e) => {
                  setPurpose(e.target.value);
                  if (e.target.value !== 'Meeting a student') {
                    setSelectedStudent(null);
                  }
                }}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  fontSize: 14,
                }}
              >
                {VISITOR_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Specific Visit Reason (If "Other") */}
            {purpose === 'Other' && (
              <div className="form-group" style={{ marginBottom: 18 }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>
                  Specific Reason / Details *
                </label>
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder="Please specify your detailed reason for campus entry..."
                  value={purposeDetails}
                  onChange={(e) => setPurposeDetails(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 12,
                    fontSize: 13.5,
                  }}
                />
              </div>
            )}

            {/* 3. Student Search & Recommendation Section (Shown for "Meeting a student") */}
            {isStudentVisit && (
              <div
                style={{
                  background: 'rgba(99, 102, 241, 0.04)',
                  border: '1.5px solid rgba(99, 102, 241, 0.28)',
                  borderRadius: 16,
                  padding: 16,
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13.5 }}>
                    <MdApartment size={18} color="#6366f1" />
                    <span>Host Student Details (MongoDB Directory)</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setManualStudentMode(!manualStudentMode);
                      if (!manualStudentMode) setSelectedStudent(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#6366f1',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {manualStudentMode ? 'Switch to Database Search' : "Can't find student? Enter manually"}
                  </button>
                </div>

                {!manualStudentMode ? (
                  <>
                    {/* Selected Student Card */}
                    {selectedStudent ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '12px 16px',
                          borderRadius: 12,
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1.5px solid rgba(16, 185, 129, 0.35)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              minWidth: 40,
                              borderRadius: '50%',
                              background: '#10b981',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                              fontSize: 16,
                            }}
                          >
                            {selectedStudent.name?.charAt(0).toUpperCase()}
                          </div>
                          <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                            <div
                              style={{
                                fontWeight: 800,
                                fontSize: 14,
                                color: 'var(--text-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {selectedStudent.name}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--text-muted)',
                                marginTop: 2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {selectedStudent.rollNo && (
                                <span
                                  style={{
                                    fontWeight: 700,
                                    color: '#10b981',
                                    marginRight: 6,
                                  }}
                                >
                                  MIS: {selectedStudent.rollNo}
                                </span>
                              )}
                              • {getHostelLabel(selectedStudent.hostel)}, Rm {selectedStudent.roomNo || 'N/A'}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={handleClearStudent}
                          style={{
                            fontSize: 12,
                            padding: '6px 12px',
                            borderRadius: 8,
                            flexShrink: 0,
                            border: '1px solid var(--border)',
                          }}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      /* Live Autocomplete Search Input */
                      <div ref={searchBoxRef} style={{ position: 'relative' }}>
                        <div style={{ position: 'relative' }}>
                          <MdSearch
                            size={18}
                            style={{
                              position: 'absolute',
                              left: 12,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              color: 'var(--text-muted)',
                              pointerEvents: 'none',
                            }}
                          />
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Type Student Name or MIS (e.g., 202301042)..."
                            value={studentQuery}
                            onChange={(e) => {
                              setStudentQuery(e.target.value);
                              setIsSearchFocused(true);
                            }}
                            onFocus={() => setIsSearchFocused(true)}
                            style={{
                              width: '100%',
                              padding: '12px 14px 12px 38px',
                              borderRadius: 12,
                              fontSize: 13.5,
                            }}
                          />
                          {studentQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setStudentQuery('');
                                setStudentResults([]);
                              }}
                              style={{
                                position: 'absolute',
                                right: 12,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                              }}
                            >
                              <MdClear size={16} />
                            </button>
                          )}
                        </div>

                        {/* Dropdown Recommendations */}
                        {isSearchFocused && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 'calc(100% + 6px)',
                              left: 0,
                              right: 0,
                              background: 'var(--bg-card)',
                              border: '1.5px solid var(--border)',
                              borderRadius: 14,
                              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
                              maxHeight: 280,
                              overflowY: 'auto',
                              zIndex: 100,
                            }}
                          >
                            <div
                              style={{
                                padding: '8px 12px',
                                fontSize: 11,
                                fontWeight: 700,
                                color: 'var(--text-muted)',
                                borderBottom: '1px solid var(--border)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                display: 'flex',
                                justifyContent: 'space-between',
                              }}
                            >
                              <span>
                                {studentQuery ? `Matching Results (${studentResults.length})` : 'Recommended Students'}
                              </span>
                              <span>{totalStudents} Enrolled</span>
                            </div>

                            {searchingStudents ? (
                              <div
                                style={{
                                  padding: '18px',
                                  textAlign: 'center',
                                  fontSize: 12.5,
                                  color: 'var(--text-muted)',
                                }}
                              >
                                Searching student database…
                              </div>
                            ) : studentResults.length === 0 ? (
                              <div style={{ padding: '16px', textAlign: 'center' }}>
                                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No student matched "{studentQuery}"</div>
                                <button
                                  type="button"
                                  onClick={() => setManualStudentMode(true)}
                                  style={{
                                    marginTop: 6,
                                    background: 'none',
                                    border: 'none',
                                    color: '#6366f1',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Enter details manually →
                                </button>
                              </div>
                            ) : (
                              studentResults.map((st) => (
                                <div
                                  key={st._id}
                                  onClick={() => handleSelectStudent(st)}
                                  style={{
                                    padding: '10px 14px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    cursor: 'pointer',
                                    borderBottom: '1px solid var(--border)',
                                    transition: 'background 0.15s ease',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'transparent';
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 32,
                                      height: 32,
                                      borderRadius: '50%',
                                      background: '#6366f1',
                                      color: '#fff',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontWeight: 700,
                                      fontSize: 13,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {st.name?.charAt(0).toUpperCase()}
                                  </div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        fontSize: 13.5,
                                        color: 'var(--text-primary)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {st.name}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 11.5,
                                        color: 'var(--text-muted)',
                                        marginTop: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                      }}
                                    >
                                      {st.rollNo && (
                                        <span
                                          style={{
                                            fontWeight: 700,
                                            color: '#6366f1',
                                            background: 'rgba(99, 102, 241, 0.12)',
                                            padding: '1px 6px',
                                            borderRadius: 4,
                                          }}
                                        >
                                          MIS: {st.rollNo}
                                        </span>
                                      )}
                                      <span>
                                        {getHostelLabel(st.hostel)}, Rm {st.roomNo || 'N/A'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  /* Manual Student Entry Inputs */
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ gridColumn: 'span 2' }}>
                      <label className="form-label" style={{ fontSize: 12 }}>
                        Student Full Name *
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. Aarav Sharma"
                        value={manualStudent.name}
                        onChange={(e) => setManualStudent({ ...manualStudent, name: e.target.value })}
                        required
                        style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13 }}
                      />
                    </div>

                    <div>
                      <label className="form-label" style={{ fontSize: 12 }}>
                        MIS / Roll Number
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. 202301042"
                        value={manualStudent.rollNo}
                        onChange={(e) => setManualStudent({ ...manualStudent, rollNo: e.target.value })}
                        style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13 }}
                      />
                    </div>

                    <div>
                      <label className="form-label" style={{ fontSize: 12 }}>
                        Hostel *
                      </label>
                      <select
                        className="form-select"
                        value={manualStudent.hostel}
                        onChange={(e) => setManualStudent({ ...manualStudent, hostel: e.target.value })}
                        style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13 }}
                      >
                        {HOSTEL_OPTIONS.map((h) => (
                          <option key={h.value} value={h.value}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                      <label className="form-label" style={{ fontSize: 12 }}>
                        Room Number *
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. B-204"
                        value={manualStudent.roomNo}
                        onChange={(e) => setManualStudent({ ...manualStudent, roomNo: e.target.value })}
                        required
                        style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13 }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 4. Visitor Personal Information */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>
                  Your Full Name *
                </label>
                <div style={{ position: 'relative' }}>
                  <MdPerson
                    size={18}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Rajesh Kumar"
                    value={visitorName}
                    onChange={(e) => setVisitorName(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '12px 14px 12px 38px',
                      borderRadius: 12,
                      fontSize: 13.5,
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>
                  Mobile Phone *
                </label>
                <div style={{ position: 'relative' }}>
                  <MdPhone
                    size={18}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type="tel"
                    className="form-control"
                    placeholder="10-digit mobile"
                    value={visitorPhone}
                    onChange={(e) => setVisitorPhone(e.target.value)}
                    required
                    maxLength={10}
                    style={{
                      width: '100%',
                      padding: '12px 14px 12px 38px',
                      borderRadius: 12,
                      fontSize: 13.5,
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>
                  Total Visitors *
                </label>
                <div style={{ position: 'relative' }}>
                  <MdGroup
                    size={18}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <select
                    className="form-select"
                    value={visitorCount}
                    onChange={(e) => setVisitorCount(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '12px 14px 12px 38px',
                      borderRadius: 12,
                      fontSize: 13.5,
                    }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'Person' : 'People'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 5. Vehicle Information */}
            <div
              style={{
                background: 'var(--bg-base)',
                borderRadius: 14,
                padding: '14px 16px',
                marginBottom: 18,
                border: '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: hasVehicle ? 12 : 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MdDirectionsCar size={18} color="#f59e0b" />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Are you bringing a vehicle?
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setHasVehicle(false)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: !hasVehicle ? 'var(--primary)' : 'transparent',
                      color: !hasVehicle ? '#fff' : 'var(--text-muted)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasVehicle(true)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: hasVehicle ? 'var(--primary)' : 'transparent',
                      color: hasVehicle ? '#fff' : 'var(--text-muted)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Yes
                  </button>
                </div>
              </div>

              {hasVehicle && (
                <div>
                  <label className="form-label" style={{ fontSize: 12 }}>
                    Vehicle Registration Number *
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. MH12AB1234"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                    required={hasVehicle}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 10,
                      fontSize: 13.5,
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                    }}
                  />
                </div>
              )}
            </div>

            {/* 6. Gate Selection */}
            <div className="form-group" style={{ marginBottom: 24 }}>
              <label className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>
                Campus Entry Gate
              </label>
              <select
                className="form-select"
                value={entryGate}
                onChange={(e) => setEntryGate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  fontSize: 13.5,
                }}
              >
                <option value="Main Gate">Main Gate (Primary Entrance)</option>
                <option value="North Gate">Campus North Gate</option>
                <option value="Hostel Gate">Hostel Gate</option>
                <option value="Vendor Gate">Vendor / Service Gate</option>
              </select>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                boxShadow: '0 8px 24px rgba(99, 102, 241, 0.35)',
              }}
            >
              {submitting ? (
                <>
                  <div className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Processing Check-In…
                </>
              ) : (
                <>
                  <MdSend size={18} />
                  {isStudentVisit ? 'Request Pass & Send Student Notification' : 'Issue Campus Gate Pass'}
                </>
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const containerStyle = {
  minHeight: '100vh',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  fontFamily: 'Inter, -apple-system, sans-serif',
};

const headerBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 20px',
  background: 'var(--bg-card)',
  borderBottom: '1px solid var(--border)',
};

const themeToggleStyle = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-base)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const pulsingRadarRingStyle = {
  position: 'absolute',
  top: '50px',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '140px',
  height: '140px',
  borderRadius: '50%',
  border: '2px solid rgba(99, 102, 241, 0.4)',
  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  pointerEvents: 'none',
};
