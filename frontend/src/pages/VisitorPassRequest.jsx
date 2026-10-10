/**
 * Visitor Pass Self Check-In Page — Authentic Google Forms UI
 *
 * Designed to faithfully replicate the Google Forms experience:
 *  - Signature lavender canvas background & top purple accent card
 *  - Individual floating question cards with active card highlight
 *  - Radio button groups with authentic circular selection
 *  - Well-structured student recommendation cards with Hostel quick-filters,
 *    MIS badges, avatar initials, and real-time MongoDB search
 *  - Verified Student Host confirmation card
 *  - Live Google Form response status screen with real-time student approval radar
 */

import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { resolveBackendOrigin } from '../services/backendUrl';
import { getHostelLabel, HOSTEL_OPTIONS } from '../utils/hostel';
import { useTheme } from '../context/ThemeContext';
import io from 'socket.io-client';
import toast from 'react-hot-toast';
import {
  MdCheckCircle,
  MdCancel,
  MdAccessTime,
  MdSearch,
  MdClear,
  MdLightMode,
  MdDarkMode,
  MdApartment,
  MdMeetingRoom,
  MdDirectionsCar,
  MdPerson,
  MdPhone,
  MdGroup,
  MdVerified,
  MdArrowForward,
  MdRefresh,
} from 'react-icons/md';

const VISITOR_PURPOSES = [
  { value: 'Meeting a student', label: 'Meeting a student (Requires host student approval)' },
  { value: 'Delivery / Courier', label: 'Delivery / Courier (Amazon, Swiggy, Zomato, etc.)' },
  { value: 'Official / Campus Visit', label: 'Official / Campus Visit (Faculty, Administration, Interview)' },
  { value: 'Guest House / Visiting Faculty', label: 'Guest House / Visiting Faculty accommodation' },
  { value: 'Maintenance / Vendor', label: 'Maintenance / Vendor / Utility services' },
  { value: 'Other', label: 'Other' },
];

export default function VisitorPassRequest() {
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
  const [hostelFilter, setHostelFilter] = useState('ALL');
  const [studentResults, setStudentResults] = useState([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [manualStudentMode, setManualStudentMode] = useState(false);
  const [manualStudent, setManualStudent] = useState({
    name: '',
    rollNo: '',
    hostel: 'BH1',
    roomNo: '',
  });

  // ── Active Card Tracking (Google Form style active border) ─────────────────
  const [activeCard, setActiveCard] = useState('purpose');

  // ── Submission & Real-time Pass Tracking ───────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [createdPass, setCreatedPass] = useState(null);
  const [liveStatus, setLiveStatus] = useState('PENDING'); // PENDING | APPROVED | REJECTED | INSIDE
  const [statusRemarks, setStatusRemarks] = useState('');
  const [timeElapsed, setTimeElapsed] = useState(0);

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
        const hostelParam = hostelFilter !== 'ALL' ? `&hostel=${encodeURIComponent(hostelFilter)}` : '';
        const res = await api.get(`/visitors/public/students-search?q=${encodeURIComponent(q)}${hostelParam}`);
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
    }, 180);

    return () => clearTimeout(timer);
  }, [studentQuery, hostelFilter, manualStudentMode, selectedStudent]);

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

    // Polling Fallback (every 3 seconds)
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

    // Socket.IO Real-time Connection
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
      console.warn('[Visitor Web] Socket warning:', err);
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
  };

  const handleClearStudent = () => {
    setSelectedStudent(null);
    setStudentQuery('');
    setManualStudentMode(false);
  };

  const handleClearForm = () => {
    if (window.confirm('Are you sure you want to clear this form?')) {
      setPurpose('Meeting a student');
      setPurposeDetails('');
      setVisitorName('');
      setVisitorPhone('');
      setVisitorCount(1);
      setHasVehicle(false);
      setVehicleNumber('');
      setEntryGate('Main Gate');
      setSelectedStudent(null);
      setStudentQuery('');
      setManualStudentMode(false);
      setManualStudent({ name: '', rollNo: '', hostel: 'BH1', roomNo: '' });
      toast.success('Form cleared');
    }
  };

  // ── Form Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!visitorName.trim()) {
      setActiveCard('name');
      return toast.error('Please enter your full name');
    }

    const cleanPhone = visitorPhone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setActiveCard('phone');
      return toast.error('Please enter a valid 10-digit mobile number');
    }

    const isStudentVisit = purpose === 'Meeting a student';
    if (isStudentVisit) {
      if (!manualStudentMode && !selectedStudent) {
        setActiveCard('student');
        return toast.error('Please select a student from the MongoDB directory or switch to manual entry');
      }
      if (manualStudentMode && (!manualStudent.name.trim() || !manualStudent.roomNo.trim())) {
        setActiveCard('student');
        return toast.error('Please provide student name, hostel, and room number');
      }
    }

    if (purpose === 'Other' && !purposeDetails.trim()) {
      setActiveCard('details');
      return toast.error('Please specify the exact reason for your visit');
    }

    if (hasVehicle && !vehicleNumber.trim()) {
      setActiveCard('vehicle');
      return toast.error('Please enter your vehicle registration number');
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
            ? 'Response submitted! Live notification sent to student portal for approval.'
            : 'Response submitted! Visitor pass issued.'
        );
      } else {
        toast.error(res.data?.message || 'Failed to submit visitor pass request');
      }
    } catch (err) {
      console.error('[Visitor Web] Submit error:', err);
      toast.error(err.response?.data?.message || 'Failed to submit visitor pass request.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatSeconds = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  // Google Forms Theme Colors
  const isDark = theme === 'dark';
  const colors = {
    canvasBg: isDark ? '#191526' : '#f0ebf8',
    cardBg: isDark ? '#231e34' : '#ffffff',
    cardBorder: isDark ? '#383050' : '#dadce0',
    primaryPurple: isDark ? '#a855f7' : '#673ab7',
    primaryPurpleLight: isDark ? 'rgba(168, 85, 247, 0.15)' : '#ede7f6',
    textMain: isDark ? '#f3f4f6' : '#202124',
    textSub: isDark ? '#9ca3af' : '#70757a',
    inputBg: isDark ? '#2a243d' : '#f8f9fa',
    inputBorder: isDark ? '#4a4165' : '#dadce0',
    activeGlow: isDark ? '#c084fc' : '#673ab7',
    tagBg: isDark ? 'rgba(168, 85, 247, 0.2)' : 'rgba(103, 58, 183, 0.08)',
    tagText: isDark ? '#d8b4fe' : '#673ab7',
    successBg: isDark ? 'rgba(16, 185, 129, 0.15)' : '#e6f4ea',
    successText: isDark ? '#34d399' : '#137333',
    successBorder: isDark ? '#059669' : '#ceead6',
    errorText: '#d93025',
  };

  // Helper card style generator
  const getCardStyle = (cardId) => {
    const isActive = activeCard === cardId;
    return {
      background: colors.cardBg,
      border: `1px solid ${isActive ? colors.primaryPurple : colors.cardBorder}`,
      borderLeft: isActive ? `6px solid ${colors.primaryPurple}` : `1px solid ${colors.cardBorder}`,
      borderRadius: 8,
      padding: '24px 26px',
      marginBottom: 12,
      boxShadow: isActive ? '0 2px 10px rgba(0, 0, 0, 0.08)' : '0 1px 3px rgba(0, 0, 0, 0.04)',
      transition: 'border 0.2s ease, box-shadow 0.2s ease',
    };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: POST-SUBMISSION / RESPONSE RECORDED SCREEN (Google Forms Style)
  // ─────────────────────────────────────────────────────────────────────────
  if (createdPass) {
    const isStudentVisit = createdPass.purpose === 'Meeting a student';
    const isApproved = liveStatus === 'APPROVED' || liveStatus === 'INSIDE';
    const isRejected = liveStatus === 'REJECTED';
    const isPending = liveStatus === 'PENDING';

    return (
      <div style={{ minHeight: '100vh', background: colors.canvasBg, padding: '36px 16px', fontFamily: 'Roboto, Inter, Arial, sans-serif' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          {/* Header Card with Google Form Top Accent Bar */}
          <div
            style={{
              background: colors.cardBg,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 8,
              borderTop: `10px solid ${colors.primaryPurple}`,
              padding: '28px 26px',
              marginBottom: 14,
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}
          >
            <h1 style={{ fontSize: 28, fontWeight: 500, color: colors.textMain, margin: '0 0 10px 0', letterSpacing: '-0.01em' }}>
              IIIT Pune Campus Visitor Entry Pass
            </h1>
            <p style={{ fontSize: 14, color: colors.textSub, margin: '0 0 18px 0', lineHeight: 1.6 }}>
              Your check-in response has been recorded.
            </p>

            {/* Real-time Status Card Inside Response */}
            <div
              style={{
                background: isApproved ? colors.successBg : isRejected ? 'rgba(239, 68, 68, 0.1)' : colors.primaryPurpleLight,
                border: `1.5px solid ${isApproved ? colors.successBorder : isRejected ? '#ef4444' : colors.primaryPurple}`,
                borderRadius: 8,
                padding: '20px 22px',
                textAlign: 'center',
                marginTop: 10,
              }}
            >
              {isPending && (
                <div>
                  <div style={{ width: 48, height: 48, margin: '0 auto 12px', borderRadius: '50%', background: colors.primaryPurple, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MdAccessTime size={28} />
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.textMain, margin: '0 0 6px 0' }}>
                    Awaiting Student Host Approval
                  </h3>
                  <div style={{ fontSize: 13.5, color: colors.textSub, maxWidth: 480, margin: '0 auto 12px', lineHeight: 1.5 }}>
                    An instant approval alert has been dispatched to <strong>{createdPass.studentName}</strong>'s student portal. As soon as the student taps <em>Approve</em>, this pass will validate automatically.
                  </div>
                  <div style={{ fontSize: 12, color: colors.primaryPurple, fontWeight: 600 }}>
                    ⏱️ Waiting for host response: {formatSeconds(timeElapsed)}
                  </div>
                </div>
              )}

              {isApproved && (
                <div>
                  <div style={{ width: 48, height: 48, margin: '0 auto 12px', borderRadius: '50%', background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MdCheckCircle size={32} />
                  </div>
                  <h3 style={{ fontSize: 20, fontWeight: 600, color: colors.successText, margin: '0 0 6px 0' }}>
                    ✓ Entry Pass Approved!
                  </h3>
                  <div style={{ fontSize: 13.5, color: colors.textSub, margin: '0 0 12px 0' }}>
                    {isStudentVisit ? `Approved by host student ${createdPass.studentName}.` : 'Visitor entry recorded.'}
                    <br />Please present this pass number to the security guard at <strong>{createdPass.entryGate}</strong>.
                  </div>
                  <div style={{ display: 'inline-block', background: colors.cardBg, border: `2px dashed ${colors.primaryPurple}`, padding: '10px 24px', borderRadius: 6, fontWeight: 700, fontSize: 18, letterSpacing: '0.05em', color: colors.primaryPurple }}>
                    {createdPass.passNumber}
                  </div>
                </div>
              )}

              {isRejected && (
                <div>
                  <div style={{ width: 48, height: 48, margin: '0 auto 12px', borderRadius: '50%', background: '#ef4444', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MdCancel size={32} />
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, color: '#ef4444', margin: '0 0 6px 0' }}>
                    Request Declined by Student
                  </h3>
                  <div style={{ fontSize: 13.5, color: colors.textSub, margin: '0 0 6px 0' }}>
                    {statusRemarks ? `Remarks: "${statusRemarks}"` : 'The host student is currently unable to accept visitors.'}
                  </div>
                </div>
              )}
            </div>

            {/* Pass Summary Details */}
            <div style={{ marginTop: 22, borderTop: `1px solid ${colors.cardBorder}`, paddingTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textSub, marginBottom: 12 }}>
                Response Summary
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13.5 }}>
                <div>
                  <span style={{ color: colors.textSub }}>Visitor:</span> <strong style={{ color: colors.textMain }}>{createdPass.name}</strong>
                </div>
                <div>
                  <span style={{ color: colors.textSub }}>Party Headcount:</span> <strong style={{ color: colors.textMain }}>{createdPass.visitorCount} {createdPass.visitorCount === 1 ? 'Person' : 'People'}</strong>
                </div>
                {isStudentVisit && (
                  <>
                    <div>
                      <span style={{ color: colors.textSub }}>Host Student:</span> <strong style={{ color: colors.textMain }}>{createdPass.studentName}</strong> {createdPass.studentRollNo ? `(${createdPass.studentRollNo})` : ''}
                    </div>
                    <div>
                      <span style={{ color: colors.textSub }}>Host Room:</span> <strong style={{ color: colors.textMain }}>{getHostelLabel(createdPass.studentHostel)}, Rm {createdPass.studentRoomNo}</strong>
                    </div>
                  </>
                )}
                <div>
                  <span style={{ color: colors.textSub }}>Purpose:</span> <strong style={{ color: colors.textMain }}>{createdPass.purpose}</strong>
                </div>
                <div>
                  <span style={{ color: colors.textSub }}>Entry Gate:</span> <strong style={{ color: colors.textMain }}>{createdPass.entryGate}</strong>
                </div>
                {createdPass.hasVehicle && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: colors.textSub }}>Vehicle:</span> <strong style={{ color: colors.textMain, fontFamily: 'monospace' }}>🚗 {createdPass.vehicleNumber}</strong>
                  </div>
                )}
              </div>
            </div>

            {/* Action Links */}
            <div style={{ marginTop: 24, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setCreatedPass(null);
                  setSelectedStudent(null);
                  setLiveStatus('PENDING');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.primaryPurple,
                  fontSize: 14,
                  fontWeight: 500,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Submit another response
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                style={{
                  background: colors.primaryPurple,
                  color: '#fff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  marginLeft: 'auto',
                }}
              >
                Print / Save Pass
              </button>
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: 12, color: colors.textSub, marginTop: 16 }}>
            Never submit passwords through Google Forms.
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW: AUTHENTIC GOOGLE FORMS QUESTIONNAIRE
  // ─────────────────────────────────────────────────────────────────────────
  const isStudentVisit = purpose === 'Meeting a student';

  return (
    <div style={{ minHeight: '100vh', background: colors.canvasBg, padding: '24px 16px 60px', fontFamily: 'Roboto, Inter, Arial, sans-serif' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* ── Google Forms Utility Bar (Theme Toggle) ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            type="button"
            onClick={toggleTheme}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: colors.cardBg,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 20,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 500,
              color: colors.textMain,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            {isDark ? <MdLightMode size={16} color="#f59e0b" /> : <MdDarkMode size={16} color="#673ab7" />}
            <span>{isDark ? 'Light Theme' : 'Dark Theme'}</span>
          </button>
        </div>

        {/* ── 1. FORM HEADER CARD (Top Purple Accent Bar) ── */}
        <div
          onClick={() => setActiveCard('header')}
          style={{
            background: colors.cardBg,
            border: `1px solid ${activeCard === 'header' ? colors.primaryPurple : colors.cardBorder}`,
            borderTop: `10px solid ${colors.primaryPurple}`,
            borderRadius: 8,
            padding: '24px 26px',
            marginBottom: 12,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <h1
            style={{
              fontSize: 32,
              fontWeight: 400,
              color: colors.textMain,
              margin: '0 0 10px 0',
              lineHeight: 1.25,
              letterSpacing: '-0.01em',
            }}
          >
            IIIT Pune Campus Visitor Entry Pass
          </h1>
          <p
            style={{
              fontSize: 14,
              color: colors.textSub,
              margin: '0 0 18px 0',
              lineHeight: 1.6,
            }}
          >
            Welcome to Indian Institute of Information Technology Pune. Please complete this self check-in pass request before entering the campus.
            For visits to hostel residents, an instant approval alert will be dispatched to the host student portal.
          </p>

          {/* Connected MongoDB Student Directory Banner (Google Forms Account Style) */}
          <div
            style={{
              borderTop: `1px solid ${colors.cardBorder}`,
              paddingTop: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12.5,
              color: colors.textSub,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
              <span>
                Connected to <strong>MongoDB Student Directory</strong> ({loadingStats ? 'Loading...' : `${totalStudents} registered students`})
              </span>
            </div>
            <div style={{ color: colors.primaryPurple, fontWeight: 500 }}>
              Live Gate Notification
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${colors.cardBorder}`, marginTop: 14, paddingTop: 10, fontSize: 13, color: colors.errorText }}>
            * Indicates required question
          </div>
        </div>

        <form onSubmit={handleSubmit}>

          {/* ── 2. QUESTION CARD: PURPOSE OF VISIT ── */}
          <div
            onClick={() => setActiveCard('purpose')}
            style={getCardStyle('purpose')}
          >
            <div style={{ fontSize: 16, fontWeight: 500, color: colors.textMain, marginBottom: 14 }}>
              Purpose of Visit <span style={{ color: colors.errorText }}>*</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {VISITOR_PURPOSES.map((item) => {
                const isSelected = purpose === item.value;
                return (
                  <label
                    key={item.value}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      cursor: 'pointer',
                      fontSize: 14,
                      color: colors.textMain,
                      lineHeight: 1.4,
                      userSelect: 'none',
                    }}
                  >
                    {/* Google Form Circular Radio Button */}
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        border: `2px solid ${isSelected ? colors.primaryPurple : colors.textSub}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 1,
                        transition: 'border 0.15s ease',
                      }}
                    >
                      {isSelected && (
                        <div
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: colors.primaryPurple,
                          }}
                        />
                      )}
                    </div>
                    <input
                      type="radio"
                      name="purpose"
                      value={item.value}
                      checked={isSelected}
                      onChange={() => {
                        setPurpose(item.value);
                        if (item.value !== 'Meeting a student') {
                          setSelectedStudent(null);
                        }
                      }}
                      style={{ display: 'none' }}
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ── 3. QUESTION CARD: OTHER SPECIFIC REASON (Conditional) ── */}
          {purpose === 'Other' && (
            <div
              onClick={() => setActiveCard('details')}
              style={getCardStyle('details')}
            >
              <div style={{ fontSize: 16, fontWeight: 500, color: colors.textMain, marginBottom: 6 }}>
                Specific Reason / Details <span style={{ color: colors.errorText }}>*</span>
              </div>
              <div style={{ fontSize: 12, color: colors.textSub, marginBottom: 16 }}>
                Please provide the specific reason for entering IIIT Pune campus.
              </div>

              <input
                type="text"
                placeholder="Your answer"
                value={purposeDetails}
                onChange={(e) => setPurposeDetails(e.target.value)}
                required
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${colors.inputBorder}`,
                  padding: '8px 0',
                  fontSize: 14,
                  color: colors.textMain,
                  outline: 'none',
                  borderBottomColor: activeCard === 'details' ? colors.primaryPurple : colors.inputBorder,
                  transition: 'border-bottom-color 0.2s',
                }}
              />
            </div>
          )}

          {/* ── 4. QUESTION CARD: HOST STUDENT RECOMMENDATION & SEARCH (Well-Structured) ── */}
          {isStudentVisit && (
            <div
              onClick={() => setActiveCard('student')}
              style={getCardStyle('student')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 500, color: colors.textMain }}>
                  Host Student Information <span style={{ color: colors.errorText }}>*</span>
                </div>

                {/* Search Mode Toggle Tabs */}
                <div style={{ display: 'flex', background: colors.inputBg, borderRadius: 6, padding: 2, border: `1px solid ${colors.inputBorder}` }}>
                  <button
                    type="button"
                    onClick={() => {
                      setManualStudentMode(false);
                    }}
                    style={{
                      background: !manualStudentMode ? colors.primaryPurple : 'transparent',
                      color: !manualStudentMode ? '#fff' : colors.textSub,
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    🔍 Database Search
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setManualStudentMode(true);
                      setSelectedStudent(null);
                    }}
                    style={{
                      background: manualStudentMode ? colors.primaryPurple : 'transparent',
                      color: manualStudentMode ? '#fff' : colors.textSub,
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    ✍️ Manual Entry
                  </button>
                </div>
              </div>

              <div style={{ fontSize: 12, color: colors.textSub, marginBottom: 16 }}>
                Search by Student Name or MIS (Roll Number) from MongoDB. Live notification will be routed to their portal.
              </div>

              {/* ── A. Database Search & Rich Structured Recommendations ── */}
              {!manualStudentMode ? (
                <>
                  {/* Selected Student Confirmation Card */}
                  {selectedStudent ? (
                    <div
                      style={{
                        background: colors.successBg,
                        border: `1.5px solid ${colors.successBorder}`,
                        borderRadius: 8,
                        padding: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 14,
                        boxShadow: '0 2px 8px rgba(16, 185, 129, 0.1)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            background: '#10b981',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 18,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {selectedStudent.name?.charAt(0).toUpperCase()}
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: colors.textMain }}>
                              {selectedStudent.name}
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(16, 185, 129, 0.2)', color: colors.successText, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>
                              <MdVerified size={13} /> Verified Host
                            </span>
                          </div>

                          <div style={{ fontSize: 12.5, color: colors.textSub, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {selectedStudent.rollNo && (
                              <span style={{ fontWeight: 600, color: colors.primaryPurple, background: colors.tagBg, padding: '2px 6px', borderRadius: 4 }}>
                                MIS: {selectedStudent.rollNo}
                              </span>
                            )}
                            <span>🏢 {getHostelLabel(selectedStudent.hostel)}</span>
                            <span>🚪 Room {selectedStudent.roomNo || 'N/A'}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleClearStudent}
                        style={{
                          background: colors.cardBg,
                          border: `1px solid ${colors.cardBorder}`,
                          borderRadius: 4,
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: colors.textMain,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div>
                      {/* Search Bar with Search Icon */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          background: colors.inputBg,
                          border: `1px solid ${colors.inputBorder}`,
                          borderRadius: 6,
                          padding: '6px 12px',
                          marginBottom: 12,
                        }}
                      >
                        <MdSearch size={20} color={colors.textSub} style={{ marginRight: 8, flexShrink: 0 }} />
                        <input
                          type="text"
                          placeholder="Search student by Name or MIS (e.g. 202301042)..."
                          value={studentQuery}
                          onChange={(e) => setStudentQuery(e.target.value)}
                          style={{
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: 13.5,
                            color: colors.textMain,
                          }}
                        />
                        {studentQuery && (
                          <button
                            type="button"
                            onClick={() => setStudentQuery('')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textSub, padding: 2 }}
                          >
                            <MdClear size={16} />
                          </button>
                        )}
                      </div>

                      {/* Hostel Quick-Filter Chips */}
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 12 }}>
                        <button
                          type="button"
                          onClick={() => setHostelFilter('ALL')}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 14,
                            fontSize: 11.5,
                            fontWeight: 500,
                            border: `1px solid ${hostelFilter === 'ALL' ? colors.primaryPurple : colors.inputBorder}`,
                            background: hostelFilter === 'ALL' ? colors.primaryPurpleLight : 'transparent',
                            color: hostelFilter === 'ALL' ? colors.primaryPurple : colors.textSub,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          All Hostels
                        </button>
                        {HOSTEL_OPTIONS.map((h) => {
                          const isSelected = hostelFilter === h.value;
                          return (
                            <button
                              key={h.value}
                              type="button"
                              onClick={() => setHostelFilter(h.value)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 14,
                                fontSize: 11.5,
                                fontWeight: 500,
                                border: `1px solid ${isSelected ? colors.primaryPurple : colors.inputBorder}`,
                                background: isSelected ? colors.primaryPurpleLight : 'transparent',
                                color: isSelected ? colors.primaryPurple : colors.textSub,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {h.value}
                            </button>
                          );
                        })}
                      </div>

                      {/* ── Structured Student Recommendation Cards List ── */}
                      <div
                        style={{
                          border: `1px solid ${colors.inputBorder}`,
                          borderRadius: 6,
                          maxHeight: 280,
                          overflowY: 'auto',
                          background: colors.cardBg,
                        }}
                      >
                        <div
                          style={{
                            padding: '8px 12px',
                            fontSize: 11,
                            fontWeight: 700,
                            color: colors.textSub,
                            borderBottom: `1px solid ${colors.inputBorder}`,
                            background: colors.inputBg,
                            display: 'flex',
                            justifyContent: 'space-between',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                          }}
                        >
                          <span>
                            {studentQuery ? `Search Results (${studentResults.length})` : 'Recommended Enrolled Students'}
                          </span>
                          <span>{totalStudents} in MongoDB</span>
                        </div>

                        {searchingStudents ? (
                          <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: colors.textSub }}>
                            Searching student database…
                          </div>
                        ) : studentResults.length === 0 ? (
                          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                            <div style={{ fontSize: 13, color: colors.textSub, marginBottom: 8 }}>
                              No enrolled student matched your search.
                            </div>
                            <button
                              type="button"
                              onClick={() => setManualStudentMode(true)}
                              style={{
                                background: 'none',
                                border: `1px solid ${colors.primaryPurple}`,
                                color: colors.primaryPurple,
                                padding: '6px 14px',
                                borderRadius: 4,
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                              }}
                            >
                              Switch to Manual Entry
                            </button>
                          </div>
                        ) : (
                          studentResults.map((st) => (
                            <div
                              key={st._id}
                              onClick={() => handleSelectStudent(st)}
                              style={{
                                padding: '12px 14px',
                                borderBottom: `1px solid ${colors.inputBorder}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                cursor: 'pointer',
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = colors.primaryPurpleLight;
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: '50%',
                                    background: colors.primaryPurple,
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    fontSize: 14,
                                    flexShrink: 0,
                                  }}
                                >
                                  {st.name?.charAt(0).toUpperCase()}
                                </div>

                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.textMain, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {st.name}
                                  </div>
                                  <div style={{ fontSize: 12, color: colors.textSub, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    {st.rollNo && (
                                      <span
                                        style={{
                                          fontWeight: 700,
                                          color: colors.primaryPurple,
                                          background: colors.tagBg,
                                          padding: '1px 5px',
                                          borderRadius: 3,
                                          fontSize: 11,
                                        }}
                                      >
                                        MIS: {st.rollNo}
                                      </span>
                                    )}
                                    <span>• {getHostelLabel(st.hostel)}</span>
                                    <span>• Rm {st.roomNo || 'N/A'}</span>
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                style={{
                                  background: colors.primaryPurple,
                                  color: '#fff',
                                  border: 'none',
                                  padding: '5px 12px',
                                  borderRadius: 4,
                                  fontSize: 12,
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                <span>Select</span>
                                <MdArrowForward size={14} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* ── B. Manual Student Entry Form ── */
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ fontSize: 13, color: colors.textMain, marginBottom: 4 }}>
                      Student Full Name <span style={{ color: colors.errorText }}>*</span>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. Aarav Sharma"
                      value={manualStudent.name}
                      onChange={(e) => setManualStudent({ ...manualStudent, name: e.target.value })}
                      required
                      style={{
                        width: '100%',
                        background: colors.inputBg,
                        border: `1px solid ${colors.inputBorder}`,
                        borderRadius: 4,
                        padding: '10px 12px',
                        fontSize: 13.5,
                        color: colors.textMain,
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 13, color: colors.textMain, marginBottom: 4 }}>
                      MIS / Roll Number
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. 202301042"
                      value={manualStudent.rollNo}
                      onChange={(e) => setManualStudent({ ...manualStudent, rollNo: e.target.value })}
                      style={{
                        width: '100%',
                        background: colors.inputBg,
                        border: `1px solid ${colors.inputBorder}`,
                        borderRadius: 4,
                        padding: '10px 12px',
                        fontSize: 13.5,
                        color: colors.textMain,
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 13, color: colors.textMain, marginBottom: 4 }}>
                      Hostel <span style={{ color: colors.errorText }}>*</span>
                    </div>
                    <select
                      value={manualStudent.hostel}
                      onChange={(e) => setManualStudent({ ...manualStudent, hostel: e.target.value })}
                      style={{
                        width: '100%',
                        background: colors.inputBg,
                        border: `1px solid ${colors.inputBorder}`,
                        borderRadius: 4,
                        padding: '10px 12px',
                        fontSize: 13.5,
                        color: colors.textMain,
                        outline: 'none',
                      }}
                    >
                      {HOSTEL_OPTIONS.map((h) => (
                        <option key={h.value} value={h.value}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={{ fontSize: 13, color: colors.textMain, marginBottom: 4 }}>
                      Room Number <span style={{ color: colors.errorText }}>*</span>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. B-204"
                      value={manualStudent.roomNo}
                      onChange={(e) => setManualStudent({ ...manualStudent, roomNo: e.target.value })}
                      required
                      style={{
                        width: '100%',
                        background: colors.inputBg,
                        border: `1px solid ${colors.inputBorder}`,
                        borderRadius: 4,
                        padding: '10px 12px',
                        fontSize: 13.5,
                        color: colors.textMain,
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 5. QUESTION CARD: VISITOR FULL NAME ── */}
          <div
            onClick={() => setActiveCard('name')}
            style={getCardStyle('name')}
          >
            <div style={{ fontSize: 16, fontWeight: 500, color: colors.textMain, marginBottom: 6 }}>
              Visitor Full Name <span style={{ color: colors.errorText }}>*</span>
            </div>
            <div style={{ fontSize: 12, color: colors.textSub, marginBottom: 16 }}>
              Please enter your full name as on your government ID.
            </div>

            <input
              type="text"
              placeholder="Your answer"
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              required
              style={{
                width: '100%',
                maxWidth: 360,
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${activeCard === 'name' ? colors.primaryPurple : colors.inputBorder}`,
                padding: '8px 0',
                fontSize: 14,
                color: colors.textMain,
                outline: 'none',
                transition: 'border-bottom-color 0.2s',
              }}
            />
          </div>

          {/* ── 6. QUESTION CARD: VISITOR MOBILE NUMBER ── */}
          <div
            onClick={() => setActiveCard('phone')}
            style={getCardStyle('phone')}
          >
            <div style={{ fontSize: 16, fontWeight: 500, color: colors.textMain, marginBottom: 6 }}>
              Visitor Mobile Number <span style={{ color: colors.errorText }}>*</span>
            </div>
            <div style={{ fontSize: 12, color: colors.textSub, marginBottom: 16 }}>
              10-digit Indian phone number for entry log verification.
            </div>

            <input
              type="tel"
              placeholder="Your answer"
              value={visitorPhone}
              onChange={(e) => setVisitorPhone(e.target.value)}
              required
              maxLength={10}
              style={{
                width: '100%',
                maxWidth: 360,
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${activeCard === 'phone' ? colors.primaryPurple : colors.inputBorder}`,
                padding: '8px 0',
                fontSize: 14,
                color: colors.textMain,
                outline: 'none',
                transition: 'border-bottom-color 0.2s',
              }}
            />
          </div>

          {/* ── 7. QUESTION CARD: VISITOR COUNT (HEADCOUNT) ── */}
          <div
            onClick={() => setActiveCard('count')}
            style={getCardStyle('count')}
          >
            <div style={{ fontSize: 16, fontWeight: 500, color: colors.textMain, marginBottom: 6 }}>
              Number of Visitors (Total Party Size) <span style={{ color: colors.errorText }}>*</span>
            </div>
            <div style={{ fontSize: 12, color: colors.textSub, marginBottom: 14 }}>
              Including yourself, how many persons are entering the campus together?
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => {
                const isSelected = visitorCount === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setVisitorCount(n)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: 500,
                      border: `1px solid ${isSelected ? colors.primaryPurple : colors.inputBorder}`,
                      background: isSelected ? colors.primaryPurpleLight : 'transparent',
                      color: isSelected ? colors.primaryPurple : colors.textMain,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {n} {n === 1 ? 'Person' : 'People'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 8. QUESTION CARD: VEHICLE DETAILS ── */}
          <div
            onClick={() => setActiveCard('vehicle')}
            style={getCardStyle('vehicle')}
          >
            <div style={{ fontSize: 16, fontWeight: 500, color: colors.textMain, marginBottom: 6 }}>
              Are you bringing a vehicle inside the campus? <span style={{ color: colors.errorText }}>*</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12, marginBottom: hasVehicle ? 16 : 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', fontSize: 14, color: colors.textMain }}>
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: `2px solid ${!hasVehicle ? colors.primaryPurple : colors.textSub}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {!hasVehicle && <div style={{ width: 10, height: 10, borderRadius: '50%', background: colors.primaryPurple }} />}
                </div>
                <input
                  type="radio"
                  name="hasVehicle"
                  checked={!hasVehicle}
                  onChange={() => setHasVehicle(false)}
                  style={{ display: 'none' }}
                />
                <span>No, entering on foot or dropped off</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', fontSize: 14, color: colors.textMain }}>
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: `2px solid ${hasVehicle ? colors.primaryPurple : colors.textSub}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {hasVehicle && <div style={{ width: 10, height: 10, borderRadius: '50%', background: colors.primaryPurple }} />}
                </div>
                <input
                  type="radio"
                  name="hasVehicle"
                  checked={hasVehicle}
                  onChange={() => setHasVehicle(true)}
                  style={{ display: 'none' }}
                />
                <span>Yes, bringing a two-wheeler or four-wheeler</span>
              </label>
            </div>

            {hasVehicle && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.inputBorder}` }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: colors.textMain, marginBottom: 6 }}>
                  Vehicle Registration Number <span style={{ color: colors.errorText }}>*</span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. MH12AB1234"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  required={hasVehicle}
                  style={{
                    width: '100%',
                    maxWidth: 360,
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `1px solid ${colors.primaryPurple}`,
                    padding: '8px 0',
                    fontSize: 14,
                    color: colors.textMain,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    outline: 'none',
                  }}
                />
              </div>
            )}
          </div>

          {/* ── GOOGLE FORMS ACTION ROW (Submit & Clear Form) ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 18,
              padding: '0 4px',
            }}
          >
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: colors.primaryPurple,
                color: '#ffffff',
                border: 'none',
                borderRadius: 4,
                padding: '10px 28px',
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: '0.25px',
                cursor: submitting ? 'wait' : 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>

            <button
              type="button"
              onClick={handleClearForm}
              style={{
                background: 'none',
                border: 'none',
                color: colors.primaryPurple,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                padding: '8px 12px',
              }}
            >
              Clear form
            </button>
          </div>

          {/* ── 11. GOOGLE FORMS FOOTER ── */}
          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: colors.textSub, lineHeight: 1.6 }}>
            Never submit passwords through Google Forms.
            <div style={{ marginTop: 4 }}>
              This content is neither created nor endorsed by Google. - IIIT Pune Campus Gate Pass
            </div>
          </div>

        </form>
      </div>
    </div>
  );
}
