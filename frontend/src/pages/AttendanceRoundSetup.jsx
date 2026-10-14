/**
 * Attendance Screen 1: Select Hostel, Floor & Session
 * Fast, instant-render hostel selection with 1-Click Request All Attendance support.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdMeetingRoom,
  MdPlayArrow,
  MdCalendarToday,
  MdLayers,
  MdApartment,
  MdCheckCircle,
  MdBolt,
  MdLocationOn,
} from 'react-icons/md';
import Navbar from '../components/Navbar';

// Standard 4 Campus Hostels (Instant render, zero latency)
const DEFAULT_HOSTELS = [
  {
    hostel: 'BH1',
    name: "Boys' Hostel 1",
    subtitle: 'Brahmaputra Building',
    coords: "18°45'50.8\"N 73°41'57.4\"E",
    studentCount: 0,
    floors: ['All Floors', 'Basement / Wing B', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
  },
  {
    hostel: 'BH2',
    name: "Boys' Hostel 2",
    subtitle: 'Krishna Building',
    coords: "18°45'47.1\"N 73°41'57.7\"E",
    studentCount: 0,
    floors: ['All Floors', 'Basement / Wing B', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
  },
  {
    hostel: 'GH1',
    name: "Girls' Hostel 1",
    subtitle: 'Indrayani Building',
    coords: "18°45'54.4\"N 73°41'56.8\"E",
    studentCount: 0,
    floors: ['All Floors', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
  },
  {
    hostel: 'GH2',
    name: "Girls' Hostel 2",
    subtitle: 'Sindhu Building',
    coords: "18°45'54.4\"N 73°41'56.8\"E",
    studentCount: 0,
    floors: ['All Floors', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
  },
];

export default function AttendanceRoundSetup() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Instant render with default 4 hostels
  const [hostels, setHostels] = useState(DEFAULT_HOSTELS);
  const [selectedHostel, setSelectedHostel] = useState('BH2');
  const [selectedFloor, setSelectedFloor] = useState('All Floors');
  const [sessionName, setSessionName] = useState('Night Attendance');
  const [submitting, setSubmitting] = useState(false);
  const [requestingHostel, setRequestingHostel] = useState(false);

  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const fetchHostels = async () => {
    try {
      const res = await api.get('/attendance/hostels');
      let loadedHostels = [];
      if (res.data?.success && res.data.hostels?.length > 0) {
        loadedHostels = res.data.hostels.filter(
          (h) => !h.hostel.toLowerCase().startsWith('test')
        );
      }

      // Map legacy GH to GH1
      loadedHostels = loadedHostels.map((h) => {
        if (h.hostel === 'GH') {
          return { ...h, hostel: 'GH1', name: "Girls' Hostel 1 (Indrayani)" };
        }
        return h;
      });

      const merged = DEFAULT_HOSTELS.map((st) => {
        const found = loadedHostels.find((lh) => lh.hostel === st.hostel);
        if (!found) return st;
        const combinedFloors = Array.from(
          new Set(['All Floors', ...(st.floors || []), ...(found.floors || [])])
        );
        return {
          ...st,
          ...found,
          floors: combinedFloors,
          studentCount: found.studentCount || st.studentCount,
        };
      });

      setHostels(merged);

      // Select user's assigned hostel or default to BH2
      const matched = merged.find(
        (h) => h.hostel === user?.hostel || h.hostel === selectedHostel
      ) || merged[1];

      if (matched && !selectedHostel) {
        setSelectedHostel(matched.hostel);
        if (matched.floors?.length > 0) setSelectedFloor(matched.floors[0]);
      }
    } catch {
      // Fallback stays seamlessly on DEFAULT_HOSTELS
    }
  };

  useEffect(() => {
    fetchHostels();
  }, []);

  const currentHostelObj = hostels.find((h) => h.hostel === selectedHostel) || hostels[0];
  const availableFloors = currentHostelObj?.floors || ['All Floors', 'Basement / Wing B', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'];

  // Ensure selected floor is valid for current hostel
  useEffect(() => {
    if (availableFloors.length > 0 && !availableFloors.includes(selectedFloor)) {
      setSelectedFloor(availableFloors[0]);
    }
  }, [selectedHostel]);

  // 1-Click Request All for Selected Floor
  const handleQuickRequestAllFloor = async () => {
    if (!selectedHostel || !selectedFloor) {
      toast.error('Please select both a hostel and a floor');
      return;
    }
    try {
      setSubmitting(true);
      const res = await api.post('/attendance/rounds/quick-request-all', {
        hostel: selectedHostel,
        floor: selectedFloor,
        session_name: sessionName,
      });

      if (res.data?.success) {
        const floorLabel = selectedFloor.toLowerCase().includes('all') ? 'All Floors' : `Floor ${selectedFloor}`;
        toast.success(
          `⚡ Attendance requested for ${res.data.requestedRoomsCount} rooms on ${floorLabel} (${res.data.totalStudentsNotified} students)!`,
          { duration: 6000 }
        );
        navigate(`/attendance/round/${res.data.round._id}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to request floor attendance');
    } finally {
      setSubmitting(false);
    }
  };

  // 1-Click Request for ENTIRE Hostel (All Floors)
  const handleRequestEntireHostel = async () => {
    if (!selectedHostel) {
      toast.error('Please select a hostel');
      return;
    }
    const confirmMsg = `Send 1-Click Attendance Request to ALL students in ${currentHostelObj.name} (${selectedHostel}) across ALL floors?\n\nStudents will immediately receive an attendance prompt on their app to verify physical location inside the building (30m geofence).`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setRequestingHostel(true);
      const res = await api.post(`/attendance/hostels/${selectedHostel}/request-all`, {
        session_name: sessionName,
      });

      if (res.data?.success) {
        toast.success(
          `🏢 1-Click Broadcast Sent! ${res.data.totalRoomsRequested} rooms (${res.data.totalStudentsNotified} students) requested across ${selectedHostel}!`,
          { duration: 7000, icon: '⚡' }
        );
        // Automatically start the floor round so staff can monitor progress
        handleStartRound();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to request entire hostel attendance');
    } finally {
      setRequestingHostel(false);
    }
  };

  // Standard Manual Walkthrough Start Round
  const handleStartRound = async () => {
    if (!selectedHostel || !selectedFloor) {
      toast.error('Please select both a hostel and a floor');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.post('/attendance/rounds', {
        hostel: selectedHostel,
        floor: selectedFloor,
        session_name: sessionName,
      });

      if (res.data?.success) {
        const roundId = res.data.round._id;
        if (res.data.resumed) {
          toast.success(
            selectedFloor.toLowerCase().includes('all')
              ? 'Resumed existing active round for All Floors'
              : 'Resumed existing active round for this floor'
          );
        } else {
          toast.success(
            selectedFloor.toLowerCase().includes('all')
              ? 'Started attendance round for All Floors'
              : 'Started attendance round'
          );
        }
        navigate(`/attendance/round/${roundId}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to start round');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in">
      <Navbar title="Room-by-Room Attendance" />
      <div className="page-area">
        <div style={{ maxWidth: 860, margin: '0 auto', paddingBottom: 40 }}>
          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 24,
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                }}
              >
                <MdMeetingRoom />
              </div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Room-by-Room Attendance
                </h1>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  1-Click Student Geofence Verification & Floor Rounds
                </span>
              </div>
            </div>
          </div>

          {/* Main Setup Card */}
          <div
            className="card"
            style={{
              padding: 24,
              borderRadius: 'var(--radius-lg)',
              marginBottom: 20,
              background: 'var(--bg-card, #ffffff)',
              border: '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)',
            }}
          >
            {/* Step 1: Select Hostel (All 4 Options Instant & Visible) */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  <MdApartment style={{ color: 'var(--primary, #6366f1)', fontSize: 18 }} />
                  Select Hostel (All 4 Campus Buildings)
                </label>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>30m Strict Building Geofence</span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                {hostels.map((h) => {
                  const isSelected = selectedHostel === h.hostel;
                  return (
                    <div
                      key={h.hostel}
                      onClick={() => setSelectedHostel(h.hostel)}
                      style={{
                        padding: '16px 14px',
                        borderRadius: 14,
                        border: isSelected
                          ? '2px solid var(--primary, #6366f1)'
                          : '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
                        background: isSelected
                          ? 'rgba(99, 102, 241, 0.08)'
                          : 'var(--bg-card, #ffffff)',
                        boxShadow: isSelected
                          ? '0 4px 16px rgba(99, 102, 241, 0.18)'
                          : '0 2px 6px rgba(0,0,0,0.03)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: 18,
                            color: isSelected ? 'var(--primary, #6366f1)' : 'var(--text-primary)',
                          }}
                        >
                          {h.hostel}
                        </span>
                        {isSelected ? (
                          <MdCheckCircle style={{ color: 'var(--primary, #6366f1)', fontSize: 20 }} />
                        ) : (
                          <span
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: '50%',
                              border: '2px solid var(--border-color, #cbd5e1)',
                            }}
                          />
                        )}
                      </div>

                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>
                        {h.subtitle || h.name}
                      </div>

                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          marginTop: 6,
                          fontFamily: 'monospace',
                        }}
                      >
                        <MdLocationOn size={12} style={{ color: 'var(--primary, #6366f1)', flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.coords}
                        </span>
                      </div>

                      {h.studentCount > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            marginTop: 6,
                            paddingTop: 6,
                            borderTop: '1px dashed var(--border-color, rgba(148,163,184,0.2))',
                          }}
                        >
                          {h.studentCount} students
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Select Floor */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  <MdLayers style={{ color: '#06b6d4', fontSize: 18 }} /> Select Floor for Round
                </label>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Choose a single floor or &quot;All Floors&quot;
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {availableFloors.map((fl) => {
                  const isSelected = selectedFloor === fl;
                  const isAll = fl.toLowerCase().includes('all');
                  return (
                    <button
                      key={fl}
                      type="button"
                      onClick={() => setSelectedFloor(fl)}
                      style={{
                        padding: '10px 18px',
                        borderRadius: 10,
                        border: isSelected
                          ? (isAll ? '2px solid #8b5cf6' : '2px solid #06b6d4')
                          : '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
                        background: isSelected
                          ? (isAll ? 'rgba(139, 92, 246, 0.15)' : 'rgba(6, 182, 212, 0.14)')
                          : 'var(--bg-input, rgba(255, 255, 255, 0.7))',
                        color: isSelected
                          ? (isAll ? '#7c3aed' : '#0891b2')
                          : 'var(--text-primary)',
                        fontWeight: 700,
                        fontSize: 13.5,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: isSelected
                          ? (isAll ? '0 3px 12px rgba(139, 92, 246, 0.25)' : '0 3px 12px rgba(6, 182, 212, 0.2)')
                          : 'none',
                      }}
                    >
                      {isAll && <span>🏢</span>}
                      {fl}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Session Details */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 28 }}>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  <MdCalendarToday size={15} /> Session Date
                </label>
                <div
                  style={{
                    padding: '12px 14px',
                    background: 'var(--bg-input, rgba(0,0,0,0.03))',
                    borderRadius: 10,
                    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
                    color: 'var(--text-primary)',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {todayStr} (Today)
                </div>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Session Name (Permanent)
                </label>
                <div
                  style={{
                    padding: '12px 14px',
                    background: 'var(--bg-input, rgba(0,0,0,0.03))',
                    borderRadius: 10,
                    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>🌙</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Night Attendance</span>
                  </div>
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: 'var(--primary, #6366f1)',
                      textTransform: 'uppercase',
                      fontWeight: 800,
                      letterSpacing: 0.5,
                    }}
                  >
                    Permanent Standard
                  </span>
                </div>
              </div>
            </div>

            {/* 1-Click Action Buttons Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* PRIMARY HERO: 1-Click Request All for Floor */}
              <button
                type="button"
                onClick={handleQuickRequestAllFloor}
                disabled={submitting || requestingHostel}
                style={{
                  width: '100%',
                  padding: '16px 24px',
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 16,
                  border: 'none',
                  cursor: submitting ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  boxShadow: '0 6px 20px rgba(99, 102, 241, 0.4)',
                  transition: 'all 0.2s ease',
                }}
              >
                <MdBolt size={24} />
                {submitting ? (
                  'Requesting All Rooms…'
                ) : (
                  <>1-Click Request All Attendance ({selectedHostel} · {selectedFloor.toLowerCase().includes('all') ? 'All Floors' : selectedFloor})</>
                )}
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {/* 1-Click Request for ENTIRE HOSTEL */}
                <button
                  type="button"
                  onClick={handleRequestEntireHostel}
                  disabled={submitting || requestingHostel}
                  style={{
                    padding: '13px 18px',
                    borderRadius: 12,
                    background: 'rgba(99, 102, 241, 0.1)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    color: 'var(--primary, #6366f1)',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: requestingHostel ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <MdApartment size={18} />
                  {requestingHostel ? 'Broadcasting Entire Hostel…' : `1-Click Request Entire Hostel (${selectedHostel})`}
                </button>

                {/* Manual Walkthrough Start */}
                <button
                  type="button"
                  onClick={handleStartRound}
                  disabled={submitting || requestingHostel}
                  style={{
                    padding: '13px 18px',
                    borderRadius: 12,
                    background: 'var(--bg-input, rgba(0,0,0,0.03))',
                    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.3))',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: submitting ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <MdPlayArrow size={20} />
                  Start Manual Walkthrough Round
                </button>
              </div>
            </div>
          </div>

          {/* How it works info card */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'rgba(99, 102, 241, 0.05)',
              border: '1px solid rgba(99, 102, 241, 0.18)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}
          >
            ⚡ <strong>1-Click Instant Attendance:</strong> Click <em>"1-Click Request All Attendance"</em> to broadcast an active attendance request to all student rooms at once. Students open their portal or phone, tap to verify location, and their GPS is checked against the authoritative building coordinates (BH1, BH2, GH1, GH2 with a strict 30m building boundary). If inside the building, attendance is recorded as <strong>PRESENT</strong>; otherwise <strong>ABSENT</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}
