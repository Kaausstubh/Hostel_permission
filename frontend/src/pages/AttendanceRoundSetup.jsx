/**
 * Attendance Screen 1: Select Hostel, Floor & Session
 * Starts a new room round or resumes an active round.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdMeetingRoom,
  MdPlayArrow,
  MdRefresh,
  MdCalendarToday,
  MdLayers,
  MdApartment,
  MdCheckCircle,
} from 'react-icons/md';
import Navbar from '../components/Navbar';

export default function AttendanceRoundSetup() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [hostels, setHostels] = useState([]);
  const [selectedHostel, setSelectedHostel] = useState('BH1');
  const [selectedFloor, setSelectedFloor] = useState('1');
  const [sessionName, setSessionName] = useState('Night Attendance');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const fetchHostels = async () => {
    try {
      setLoading(true);
      const res = await api.get('/attendance/hostels');
      if (res.data?.success && res.data.hostels?.length > 0) {
        const validHostels = res.data.hostels.filter(
          (h) => !h.hostel.toLowerCase().startsWith('test')
        );
        setHostels(validHostels);
        // Default to user's assigned hostel if available
        const defaultH = validHostels.find(
          (h) => h.hostel === user?.hostel || h.hostel === 'BH1'
        ) || validHostels[0];
        if (defaultH) {
          setSelectedHostel(defaultH.hostel);
          if (defaultH.floors?.length > 0) setSelectedFloor(defaultH.floors[0]);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load hostels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHostels();
  }, []);

  const currentHostelObj = hostels.find((h) => h.hostel === selectedHostel);
  const availableFloors = currentHostelObj?.floors || ['1', '2', '3', '4'];

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
          toast.success('Resumed existing active round for this floor');
        } else {
          toast.success('Started new attendance round');
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
        <div style={{ maxWidth: 840, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 22,
            }}
          >
            <MdMeetingRoom />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Room-by-Room Attendance
            </h1>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Hostel Staff Digitized Round Verification
            </span>
          </div>
        </div>
      </div>

      {/* Main Setup Card */}
      <div className="card" style={{ padding: 24, borderRadius: 'var(--radius-lg)', marginBottom: 20 }}>
        {/* Step 1: Select Hostel */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
            <MdApartment style={{ color: 'var(--primary)' }} /> Select Hostel
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {hostels.map((h) => {
              const isSelected = selectedHostel === h.hostel;
              return (
                <div
                  key={h.hostel}
                  onClick={() => {
                    setSelectedHostel(h.hostel);
                    if (h.floors?.length > 0 && !h.floors.includes(selectedFloor)) {
                      setSelectedFloor(h.floors[0]);
                    }
                  }}
                  style={{
                    padding: '16px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                    background: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 16, color: isSelected ? 'var(--primary-light)' : 'var(--text-primary)' }}>
                      {h.hostel}
                    </span>
                    {isSelected && <MdCheckCircle style={{ color: 'var(--primary)', fontSize: 18 }} />}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                    {h.studentCount} students enrolled
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 2: Select Floor */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
            <MdLayers style={{ color: 'var(--accent)' }} /> Select Floor
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {availableFloors.map((fl) => {
              const isSelected = selectedFloor === fl;
              return (
                <button
                  key={fl}
                  type="button"
                  onClick={() => setSelectedFloor(fl)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 'var(--radius-md)',
                    border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                    background: isSelected ? 'rgba(34,211,238,0.15)' : 'var(--bg-input)',
                    color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                    minWidth: 80,
                  }}
                >
                  {fl.toLowerCase().includes('floor') || fl.toLowerCase().includes('base') ? fl : `Floor ${fl}`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 3: Session and Date */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 28 }}>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              <MdCalendarToday size={15} /> Session Date
            </label>
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius-md)',
                border: 'var(--border)',
                color: 'var(--text-primary)',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 13,
              }}
            >
              {todayStr} (Today)
            </div>
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Session Name
            </label>
            <select
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 14px',
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius-md)',
                border: 'var(--border)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            >
              <option value="Night Attendance">Night Attendance (Standard)</option>
              <option value="Evening Attendance">Evening Attendance</option>
              <option value="Emergency Roll Call">Emergency Roll Call</option>
            </select>
          </div>
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={handleStartRound}
          disabled={submitting || loading}
          style={{
            width: '100%',
            padding: '14px 24px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--gradient-primary)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            border: 'none',
            cursor: submitting ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            boxShadow: 'var(--shadow-md)',
            transition: 'var(--transition)',
          }}
        >
          {submitting ? (
            'Initializing Round…'
          ) : (
            <>
              <MdPlayArrow size={22} /> Start Round ({selectedFloor.toLowerCase().includes('floor') || selectedFloor.toLowerCase().includes('base') ? selectedFloor : `Floor ${selectedFloor}`})
            </>
          )}
        </button>
      </div>

      {/* Helpful Hint Card */}
      <div
        style={{
          padding: 16,
          borderRadius: 'var(--radius-md)',
          background: 'rgba(139,92,246,0.06)',
          border: '1px solid rgba(139,92,246,0.18)',
          fontSize: 12.5,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}
      >
        💡 <strong>How it works:</strong> Walk to each room on this floor. Tap <em>Request Attendance</em> when standing outside the room. Students verify from their phones with biometrics &amp; indoor hostel GPS. If a student is absent, on approved leave, or has a dead battery, record manual marks with mandatory remarks.
        </div>
      </div>
    </div>
  </div>
  );
}
