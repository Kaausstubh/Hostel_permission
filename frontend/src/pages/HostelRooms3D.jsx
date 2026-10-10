import { useState, useEffect, useMemo, useCallback } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdMeetingRoom,
  MdHotel,
  MdBed,
  MdSearch,
  MdRefresh,
  MdAdd,
  MdClose,
  MdDeleteOutline,
  MdSwapHoriz,
  MdLayers,
  MdViewInAr,
  MdCheckCircle,
  MdWarning,
  MdPerson,
  MdPhone,
  MdEmail,
} from 'react-icons/md';
import { useTheme } from '../context/ThemeContext';
import StudentAvatar from '../components/StudentAvatar';

export default function HostelRooms3D({ embedded = false }) {
  const { theme } = useTheme();
  const [hostel, setHostel] = useState('BH2');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingPdf, setSyncingPdf] = useState(false);

  // Filters
  const [selectedFloor, setSelectedFloor] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'vacant', 'full', 'empty'
  const [searchTerm, setSearchTerm] = useState('');
  const [view3D, setView3D] = useState(true);

  // Selected Room for 3D Inspection Modal
  const [activeRoom, setActiveRoom] = useState(null);

  // Modals for Adding / Transferring Student
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    rollNo: '',
    email: '',
    phone: '',
    existingStudentId: '',
  });
  const [addingLoading, setAddingLoading] = useState(false);

  // Transfer Student Modal
  const [transferringStudent, setTransferringStudent] = useState(null);
  const [targetRoomInput, setTargetRoomInput] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);

  // Fetch rooms data from backend
  const fetchRooms = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);

      const res = await api.get(`/rooms?hostel=${hostel}`);
      if (res.data?.success) {
        setData(res.data);
        // If an active room modal is open, refresh its data from the latest rooms list
        if (activeRoom) {
          const updated = res.data.rooms.find((r) => r.roomNumber === activeRoom.roomNumber);
          if (updated) setActiveRoom(updated);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to fetch room occupancy');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hostel, activeRoom]);

  useEffect(() => {
    fetchRooms();
  }, [hostel]);

  // Sync / Re-load all 394 students from the uploaded PDF
  const handleSyncPdf = async () => {
    if (!window.confirm('Sync and upload all 394 BH-2 students from the PDF into their respective rooms?')) {
      return;
    }
    setSyncingPdf(true);
    const toastId = toast.loading('Syncing all BH-2 students and room allocations from PDF...');
    try {
      const res = await api.post('/rooms/sync-pdf');
      if (res.data?.success) {
        toast.success(res.data.message || 'All students from PDF synced successfully!', { id: toastId });
        await fetchRooms(true);
      } else {
        toast.error(res.data?.message || 'Sync failed', { id: toastId });
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to sync PDF data', { id: toastId });
    } finally {
      setSyncingPdf(false);
    }
  };

  // Remove a student from a room (freeing up 1 vacancy)
  const handleRemoveStudent = async (roomNumber, student) => {
    if (!window.confirm(`Remove ${student.name} (${student.rollNo || 'No MIS'}) from Room ${roomNumber}? This will immediately create 1 vacancy in this room.`)) {
      return;
    }
    const toastId = toast.loading(`Removing ${student.name} from Room ${roomNumber}...`);
    try {
      const res = await api.post(`/rooms/${encodeURIComponent(roomNumber)}/remove-student`, {
        studentId: student._id,
        rollNo: student.rollNo,
      });
      if (res.data?.success) {
        toast.success(res.data.message || 'Student removed from room', { id: toastId });
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove student', { id: toastId });
    }
  };

  // Add / Allocate a student into active room
  const handleAddStudentSubmit = async (e) => {
    e.preventDefault();
    if (!activeRoom) return;
    setAddingLoading(true);
    try {
      const payload = {
        hostel,
        name: addForm.name,
        rollNo: addForm.rollNo,
        email: addForm.email,
        phone: addForm.phone,
        studentId: addForm.existingStudentId || undefined,
      };
      const res = await api.post(`/rooms/${encodeURIComponent(activeRoom.roomNumber)}/add-student`, payload);
      if (res.data?.success) {
        toast.success(res.data.message || 'Student allocated to room!');
        setShowAddModal(false);
        setAddForm({ name: '', rollNo: '', email: '', phone: '', existingStudentId: '' });
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add student');
    } finally {
      setAddingLoading(false);
    }
  };

  // Transfer student to another room
  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    if (!transferringStudent || !targetRoomInput) return;
    setTransferLoading(true);
    try {
      const res = await api.post('/rooms/transfer-student', {
        studentId: transferringStudent._id,
        targetRoomNumber: targetRoomInput.trim(),
        hostel,
      });
      if (res.data?.success) {
        toast.success(res.data.message || 'Student transferred successfully!');
        setTransferringStudent(null);
        setTargetRoomInput('');
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to transfer student');
    } finally {
      setTransferLoading(false);
    }
  };

  // Client-side filtered rooms
  const filteredRooms = useMemo(() => {
    if (!data?.rooms) return [];
    let list = data.rooms;

    if (selectedFloor !== 'All') {
      list = list.filter((r) => r.floor === selectedFloor);
    }

    if (statusFilter === 'vacant') {
      list = list.filter((r) => r.vacancies > 0);
    } else if (statusFilter === 'full') {
      list = list.filter((r) => r.isFull);
    } else if (statusFilter === 'empty') {
      list = list.filter((r) => r.occupancy === 0);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.roomNumber.toLowerCase().includes(q) ||
          r.floor.toLowerCase().includes(q) ||
          r.students.some(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              s.rollNo.toLowerCase().includes(q) ||
              s.email.toLowerCase().includes(q)
          )
      );
    }

    return list;
  }, [data?.rooms, selectedFloor, statusFilter, searchTerm]);

  // Overall Stats
  const stats = data?.stats || {
    totalRooms: 0,
    totalCapacity: 0,
    totalOccupied: 0,
    totalVacancies: 0,
    fullRooms: 0,
    availableRooms: 0,
    emptyRooms: 0,
    unassignedCount: 0,
  };

  return (
    <div className={`hostel-rooms-3d-page ${embedded ? 'embedded' : ''}`}>
      {!embedded && <Navbar title="Hostel BH-2 • 3D Room Allocation Matrix" />}

      <div className="page-area" style={{ padding: embedded ? '0' : '20px 28px 40px' }}>
        {/* ── Top Header Bar ── */}
        <div
          style={{
            background: theme === 'light' ? '#ffffff' : 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(16px)',
            border: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 20,
            padding: '20px 24px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.06)',
            marginBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                  }}
                >
                  HOSTEL BH-2 (KRISHNA)
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Standard Capacity: <strong>4 Students / Room</strong>
                </span>
              </div>
              <h1
                style={{
                  margin: '8px 0 0',
                  fontSize: 24,
                  fontWeight: 900,
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>🏢 3D Room Occupancy & Vacancy Matrix</span>
              </h1>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleSyncPdf}
                disabled={syncingPdf}
                style={{
                  padding: '9px 16px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: syncingPdf ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                }}
                title="Sync / Upload all students from the official PDF list into BH-2"
              >
                <span>📥</span>
                <span>{syncingPdf ? 'Syncing PDF...' : 'Sync All PDF Students (394)'}</span>
              </button>

              <button
                type="button"
                onClick={() => fetchRooms(true)}
                disabled={refreshing}
                style={{
                  padding: '9px 14px',
                  borderRadius: 12,
                  border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.15)',
                  background: theme === 'light' ? '#f8fafc' : 'rgba(255, 255, 255, 0.06)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: refreshing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <MdRefresh size={18} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                <span>Refresh</span>
              </button>

              <button
                type="button"
                onClick={() => setView3D(!view3D)}
                style={{
                  padding: '9px 14px',
                  borderRadius: 12,
                  border: view3D ? '1.5px solid #6366f1' : '1px solid var(--border-color)',
                  background: view3D ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  color: view3D ? 'var(--primary-light)' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <MdViewInAr size={18} />
                <span>{view3D ? '3D Isometric View' : 'Flat Grid View'}</span>
              </button>
            </div>
          </div>

          {/* ── Summary Stats Grid ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              paddingTop: 14,
              borderTop: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div className="stat-pill" style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', padding: '10px 14px', borderRadius: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase' }}>Total Rooms</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{stats.totalRooms}</div>
            </div>

            <div className="stat-pill" style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', padding: '10px 14px', borderRadius: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase' }}>Total Capacity</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{stats.totalCapacity} <span style={{ fontSize: 12, fontWeight: 500 }}>Beds</span></div>
            </div>

            <div className="stat-pill" style={{ background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.25)', padding: '10px 14px', borderRadius: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#c084fc', textTransform: 'uppercase' }}>Residing Students</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{stats.totalOccupied}</div>
            </div>

            <div className="stat-pill" style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1.5px solid rgba(16, 185, 129, 0.4)', padding: '10px 14px', borderRadius: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#34d399', textTransform: 'uppercase' }}>Available Vacancies</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#10b981', marginTop: 2 }}>
                {stats.totalVacancies} <span style={{ fontSize: 12, fontWeight: 700 }}>Open Beds</span>
              </div>
            </div>

            <div className="stat-pill" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', padding: '10px 14px', borderRadius: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#f87171', textTransform: 'uppercase' }}>Full Rooms (4/4)</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{stats.fullRooms}</div>
            </div>

            <div className="stat-pill" style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', padding: '10px 14px', borderRadius: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase' }}>Rooms w/ Vacancy</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{stats.availableRooms}</div>
            </div>
          </div>
        </div>

        {/* ── Floor Navigation Elevation Pills ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 16 }}>
          {[
            { label: 'All Floors', value: 'All', icon: '🏢' },
            { label: 'Basement (B01-B13)', value: 'Basement', icon: '🔻' },
            { label: 'Ground Floor (2-30)', value: 'Ground Floor', icon: '🚪' },
            { label: '1st Floor (101-132)', value: '1st Floor', icon: '1️⃣' },
            { label: '2nd Floor (201-234)', value: '2nd Floor', icon: '2️⃣' },
            { label: '3rd Floor (301-321)', value: '3rd Floor', icon: '3️⃣' },
          ].map((fl) => (
            <button
              key={fl.value}
              type="button"
              onClick={() => setSelectedFloor(fl.value)}
              style={{
                padding: '9px 18px',
                borderRadius: 14,
                border: selectedFloor === fl.value ? '1.5px solid #6366f1' : '1px solid var(--border-color)',
                background: selectedFloor === fl.value ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : (theme === 'light' ? '#ffffff' : 'rgba(255, 255, 255, 0.05)'),
                color: selectedFloor === fl.value ? '#ffffff' : 'var(--text-primary)',
                fontWeight: selectedFloor === fl.value ? 800 : 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                whiteSpace: 'nowrap',
                boxShadow: selectedFloor === fl.value ? '0 4px 14px rgba(99, 102, 241, 0.35)' : 'none',
                transition: 'all 0.18s ease',
              }}
            >
              <span>{fl.icon}</span>
              <span>{fl.label}</span>
            </button>
          ))}
        </div>

        {/* ── Search & Occupancy Status Filter Bar ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 20,
          }}
        >
          {/* Search Box */}
          <div
            style={{
              position: 'relative',
              flex: '1 1 280px',
              maxWidth: 420,
            }}
          >
            <MdSearch
              size={20}
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Search Room (e.g. 305, B12), Student Name, or MIS..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '11px 14px 11px 42px',
                borderRadius: 14,
                border: theme === 'light' ? '1.5px solid #cbd5e1' : '1.5px solid rgba(255, 255, 255, 0.15)',
                background: theme === 'light' ? '#ffffff' : 'rgba(15, 23, 42, 0.8)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Status Filter Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'All Rooms', value: 'all', count: data?.rooms?.length || 0 },
              { label: '🟢 Has Vacancies', value: 'vacant', count: stats.availableRooms },
              { label: '🔴 Full (4/4)', value: 'full', count: stats.fullRooms },
              { label: '⚪ Empty', value: 'empty', count: stats.emptyRooms },
            ].map((st) => (
              <button
                key={st.value}
                type="button"
                onClick={() => setStatusFilter(st.value)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 10,
                  border: statusFilter === st.value ? '1.5px solid #6366f1' : '1px solid var(--border-color)',
                  background: statusFilter === st.value ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  color: statusFilter === st.value ? 'var(--primary-light)' : 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span>{st.label}</span>
                <span style={{ opacity: 0.7 }}>({st.count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 3D ROOM GRID (Row-wise & Column-wise) ── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <div className="loading-spinner" style={{ width: 44, height: 44, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 15, fontWeight: 700 }}>Rendering 3D BH-2 Room Matrix...</div>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '60px 20px',
              background: theme === 'light' ? '#ffffff' : 'rgba(255, 255, 255, 0.02)',
              borderRadius: 20,
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>No rooms matched your criteria</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              Try adjusting your search query or floor selection.
            </p>
          </div>
        ) : (
          <div
            className={`rooms-matrix-grid ${view3D ? 'view-3d-active' : ''}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
              gap: 20,
              perspective: view3D ? '1200px' : 'none',
            }}
          >
            {filteredRooms.map((room) => {
              const isFull = room.occupancy >= room.capacity;
              const hasVacancy = room.vacancies > 0;
              const vacancyColor = isFull
                ? '#ef4444'
                : room.vacancies === 1
                ? '#f59e0b'
                : room.vacancies === 2
                ? '#38bdf8'
                : '#10b981';

              return (
                <div
                  key={room.roomNumber}
                  onClick={() => setActiveRoom(room)}
                  className="room-card-3d"
                  style={{
                    background: theme === 'light' ? '#ffffff' : 'rgba(30, 41, 59, 0.75)',
                    border: isFull
                      ? (theme === 'light' ? '1.5px solid #fecaca' : '1px solid rgba(239, 68, 68, 0.35)')
                      : hasVacancy
                      ? (theme === 'light' ? '1.5px solid #bbf7d0' : '1.5px solid rgba(16, 185, 129, 0.4)')
                      : '1px solid var(--border-color)',
                    borderRadius: 20,
                    padding: 18,
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                    boxShadow: view3D
                      ? (theme === 'light'
                        ? '0 12px 24px -6px rgba(0,0,0,0.08), 0 4px 8px -2px rgba(0,0,0,0.04)'
                        : '0 14px 28px -6px rgba(0,0,0,0.5), 0 0 16px rgba(99, 102, 241, 0.08)')
                      : 'none',
                    transform: view3D ? 'translateZ(0) rotateX(1.5deg)' : 'none',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={(e) => {
                    if (view3D) {
                      e.currentTarget.style.transform = 'translateY(-6px) scale(1.015) rotateX(4deg)';
                      e.currentTarget.style.boxShadow = isFull
                        ? '0 20px 35px -8px rgba(239, 68, 68, 0.25)'
                        : '0 20px 35px -8px rgba(16, 185, 129, 0.25)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (view3D) {
                      e.currentTarget.style.transform = 'translateZ(0) rotateX(1.5deg)';
                      e.currentTarget.style.boxShadow = theme === 'light'
                        ? '0 12px 24px -6px rgba(0,0,0,0.08)'
                        : '0 14px 28px -6px rgba(0,0,0,0.5)';
                    }
                  }}
                >
                  {/* Top Header of Room Card */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 14,
                          background: isFull
                            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                            : 'linear-gradient(135deg, #6366f1, #3b82f6)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 16,
                          fontWeight: 900,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                        }}
                      >
                        {room.roomNumber}
                      </div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary)' }}>
                          Room {room.roomNumber}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                          🏢 {room.floor}
                        </div>
                      </div>
                    </div>

                    {/* Vacancy Badge */}
                    <div
                      style={{
                        padding: '4px 10px',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 900,
                        letterSpacing: '0.02em',
                        background: isFull
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(16, 185, 129, 0.15)',
                        color: vacancyColor,
                        border: `1px solid ${vacancyColor}40`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <span>{isFull ? '🔴' : '🟢'}</span>
                      <span>
                        {isFull
                          ? 'FULL (4/4)'
                          : `${room.vacancies} ${room.vacancies === 1 ? 'VACANCY' : 'VACANCIES'}`}
                      </span>
                    </div>
                  </div>

                  {/* ── 4 Beds Visualizer Inside Room (Beds 1 to 4) ── */}
                  <div
                    style={{
                      background: theme === 'light' ? '#f8fafc' : 'rgba(15, 23, 42, 0.55)',
                      borderRadius: 14,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                      border: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <span>Bed Allocation</span>
                      <span>{room.occupancy}/{room.capacity} Occupied</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      {Array.from({ length: room.capacity }).map((_, idx) => {
                        const student = room.students[idx];
                        const bedNumber = idx + 1;

                        if (student) {
                          return (
                            <div
                              key={student._id || idx}
                              style={{
                                background: theme === 'light' ? '#ffffff' : 'rgba(30, 41, 59, 0.85)',
                                border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.12)',
                                borderRadius: 10,
                                padding: '6px 8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                overflow: 'hidden',
                              }}
                              title={`${student.name} (${student.rollNo || 'MIS N/A'})`}
                            >
                              <div
                                style={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: '50%',
                                  background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                                  color: '#fff',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                {bedNumber}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {student.name}
                                </div>
                                <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                  {student.rollNo || 'MIS'}
                                </div>
                              </div>
                            </div>
                          );
                        } else {
                          return (
                            <div
                              key={`empty-${idx}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveRoom(room);
                                setShowAddModal(true);
                              }}
                              style={{
                                background: theme === 'light' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.06)',
                                border: '1.5px dashed rgba(16, 185, 129, 0.45)',
                                borderRadius: 10,
                                padding: '6px 8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                              title="Vacant bed — Click to allocate student"
                            >
                              <div
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: '50%',
                                  background: 'rgba(16, 185, 129, 0.2)',
                                  color: '#10b981',
                                  fontSize: 11,
                                  fontWeight: 900,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                +
                              </div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>
                                Bed {bedNumber} Vacant
                              </div>
                            </div>
                          );
                        }
                      })}
                    </div>
                  </div>

                  {/* Card Bottom Strip */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 12,
                      paddingTop: 10,
                      borderTop: theme === 'light' ? '1px solid #f1f5f9' : '1px solid rgba(255, 255, 255, 0.05)',
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--primary-light)',
                    }}
                  >
                    <span>Inspect Room & Residing Students →</span>
                    {hasVacancy && (
                      <span style={{ color: '#10b981', fontSize: 11, fontWeight: 800 }}>
                        + Add Student
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 3D ROOM INSPECTOR & MANAGEMENT MODAL ── */}
      {activeRoom && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            animation: 'fadeInModal 0.2s ease-out',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveRoom(null);
          }}
        >
          <div
            style={{
              backgroundColor: theme === 'light' ? '#ffffff' : '#0f172a',
              borderRadius: 24,
              border: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.65)',
              maxWidth: 620,
              width: '100%',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              animation: 'scaleUpModal 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '20px 24px 16px',
                borderBottom: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
                background: theme === 'light' ? 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)' : 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 16,
                    background: activeRoom.isFull
                      ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                      : 'linear-gradient(135deg, #6366f1, #3b82f6)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    fontWeight: 900,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                  }}
                >
                  {activeRoom.roomNumber}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: 'var(--text-primary)' }}>
                    Hostel BH-2 • Room {activeRoom.roomNumber}
                  </h3>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    🏢 {activeRoom.floor} • Capacity: <strong>{activeRoom.capacity} Students</strong>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveRoom(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 22,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 6,
                  borderRadius: 8,
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Occupancy Status Strip */}
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: 16,
                  background: activeRoom.isFull
                    ? (theme === 'light' ? '#fef2f2' : 'rgba(239, 68, 68, 0.12)')
                    : (theme === 'light' ? '#f0fdf4' : 'rgba(16, 185, 129, 0.12)'),
                  border: activeRoom.isFull
                    ? '1.5px solid rgba(239, 68, 68, 0.35)'
                    : '1.5px solid rgba(16, 185, 129, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: activeRoom.isFull ? '#ef4444' : '#10b981' }}>
                    {activeRoom.isFull
                      ? '🔴 Room is Fully Occupied (4/4)'
                      : `🟢 ${activeRoom.vacancies} ${activeRoom.vacancies === 1 ? 'Bed Vacancy Available' : 'Bed Vacancies Available'}`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Currently {activeRoom.occupancy} of {activeRoom.capacity} beds are occupied.
                  </div>
                </div>

                {activeRoom.vacancies > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAddModal(true)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 12,
                      border: 'none',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#fff',
                      fontSize: 12.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)',
                    }}
                  >
                    <MdAdd size={16} />
                    <span>Allocate Student</span>
                  </button>
                )}
              </div>

              {/* ── Residing Students List ── */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  Residing Students in this Room ({activeRoom.students.length})
                </div>

                {activeRoom.students.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px', background: 'rgba(255,255,255,0.02)', borderRadius: 14, color: 'var(--text-muted)' }}>
                    No students currently allocated to this room.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activeRoom.students.map((student, idx) => (
                      <div
                        key={student._id || idx}
                        style={{
                          padding: '12px 16px',
                          borderRadius: 16,
                          background: theme === 'light' ? '#f8fafc' : 'rgba(255, 255, 255, 0.04)',
                          border: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 10,
                              background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 900,
                              fontSize: 13,
                              flexShrink: 0,
                            }}
                          >
                            B{idx + 1}
                          </div>

                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>{student.name}</span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                              <span>MIS: <strong>{student.rollNo || 'N/A'}</strong></span>
                              <span>✉️ {student.email || 'N/A'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Actions for this student */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setTransferringStudent(student);
                              setTargetRoomInput('');
                            }}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.15)',
                              background: 'transparent',
                              color: 'var(--text-secondary)',
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="Transfer student to another room"
                          >
                            <MdSwapHoriz size={16} />
                            <span>Transfer</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveStudent(activeRoom.roomNumber, student)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid rgba(239, 68, 68, 0.35)',
                              background: 'rgba(239, 68, 68, 0.08)',
                              color: '#ef4444',
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="Remove student from room"
                          >
                            <MdDeleteOutline size={16} />
                            <span>Remove</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Vacant Beds Allocation Slot ── */}
              {activeRoom.vacancies > 0 && (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 16,
                    border: '1.5px dashed rgba(16, 185, 129, 0.45)',
                    background: 'rgba(16, 185, 129, 0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: '#10b981', fontSize: 13.5 }}>
                      + {activeRoom.vacancies} Vacant Bed(s) Available in Room {activeRoom.roomNumber}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      Hostel staff can assign an unallocated student or add a new student directly into this room.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(true)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 10,
                      background: '#10b981',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 800,
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    + Add Student
                  </button>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '14px 24px',
                borderTop: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={() => setActiveRoom(null)}
                style={{
                  padding: '9px 20px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'var(--primary)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD / ALLOCATE STUDENT MODAL ── */}
      {showAddModal && activeRoom && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false);
          }}
        >
          <div
            style={{
              backgroundColor: theme === 'light' ? '#ffffff' : '#0f172a',
              borderRadius: 20,
              border: '1px solid var(--border-color)',
              maxWidth: 480,
              width: '100%',
              overflow: 'hidden',
              boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div
              style={{
                padding: '18px 22px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>
                  Add Student to Room {activeRoom.roomNumber}
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Hostel BH-2 • Available Vacancies: {activeRoom.vacancies}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: 'transparent', border: 'none', fontSize: 20, color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddStudentSubmit} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Pick from unassigned if any exist */}
              {data?.unassigned?.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 800, marginBottom: 6, color: 'var(--text-primary)' }}>
                    Quick Select Unassigned Student:
                  </label>
                  <select
                    value={addForm.existingStudentId}
                    onChange={(e) => {
                      const selId = e.target.value;
                      if (!selId) {
                        setAddForm((prev) => ({ ...prev, existingStudentId: '' }));
                        return;
                      }
                      const found = data.unassigned.find((u) => u._id === selId);
                      if (found) {
                        setAddForm({
                          existingStudentId: found._id,
                          name: found.name,
                          rollNo: found.rollNo,
                          email: found.email,
                          phone: found.phone || '',
                        });
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1.5px solid var(--border-color)',
                      background: theme === 'light' ? '#fff' : 'rgba(15, 23, 42, 0.8)',
                      color: 'var(--text-primary)',
                      fontSize: 13,
                    }}
                  >
                    <option value="">-- Choose unassigned student (or enter manually below) --</option>
                    {data.unassigned.map((st) => (
                      <option key={st._id} value={st._id}>
                        {st.name} ({st.rollNo || 'No MIS'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800, marginBottom: 6, color: 'var(--text-primary)' }}>
                  Student Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Atharva Verma"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1.5px solid var(--border-color)',
                    background: theme === 'light' ? '#fff' : 'rgba(15, 23, 42, 0.8)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800, marginBottom: 6, color: 'var(--text-primary)' }}>
                  MIS / Roll Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 112516018"
                  value={addForm.rollNo}
                  onChange={(e) => setAddForm({ ...addForm, rollNo: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1.5px solid var(--border-color)',
                    background: theme === 'light' ? '#fff' : 'rgba(15, 23, 42, 0.8)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800, marginBottom: 6, color: 'var(--text-primary)' }}>
                  College Email (Optional)
                </label>
                <input
                  type="email"
                  placeholder="e.g. 112516018@cse.iiitp.ac.in"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1.5px solid var(--border-color)',
                    background: theme === 'light' ? '#fff' : 'rgba(15, 23, 42, 0.8)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: 10,
                    border: '1px solid var(--border-color)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingLoading}
                  style={{
                    padding: '9px 20px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: addingLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {addingLoading ? 'Adding...' : 'Allocate Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── TRANSFER STUDENT MODAL ── */}
      {transferringStudent && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setTransferringStudent(null);
          }}
        >
          <div
            style={{
              backgroundColor: theme === 'light' ? '#ffffff' : '#0f172a',
              borderRadius: 20,
              border: '1px solid var(--border-color)',
              maxWidth: 440,
              width: '100%',
              overflow: 'hidden',
              boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>
                  Transfer Student
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Move <strong>{transferringStudent.name}</strong> to a different room
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTransferringStudent(null)}
                style={{ background: 'transparent', border: 'none', fontSize: 20, color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleTransferSubmit} style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800, marginBottom: 6, color: 'var(--text-primary)' }}>
                  Target Room Number in BH-2:
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 219, B08, 125..."
                  value={targetRoomInput}
                  onChange={(e) => setTargetRoomInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1.5px solid var(--border-color)',
                    background: theme === 'light' ? '#fff' : 'rgba(15, 23, 42, 0.8)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setTransferringStudent(null)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: 10,
                    border: '1px solid var(--border-color)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferLoading}
                  style={{
                    padding: '9px 20px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: transferLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {transferLoading ? 'Transferring...' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CSS Animations & Styles ── */}
      <style>{`
        @keyframes fadeInModal {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUpModal {
          from { opacity: 0; transform: scale(0.93); }
          to { opacity: 1; transform: scale(1); }
        }
        .room-card-3d:hover {
          z-index: 10;
        }
      `}</style>
    </div>
  );
}
