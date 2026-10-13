/**
 * RoomAllocation Component
 * Clean, practical, modern Room Allocation Management Dashboard.
 * Replaces the old 3D room visualization with a high-utility room grid,
 * vacancy trackers, resident student rosters, capacity validations,
 * student assignment, transfer, and deallocation controls.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useTheme } from '../context/ThemeContext';
import * as XLSX from 'xlsx';
import {
  MdMeetingRoom,
  MdSearch,
  MdRefresh,
  MdFilterList,
  MdAdd,
  MdPersonAdd,
  MdSwapHoriz,
  MdDeleteOutline,
  MdDownload,
  MdClose,
  MdCheckCircle,
  MdErrorOutline,
  MdWarning,
  MdBed,
  MdPeople,
  MdSchool,
  MdPhone,
  MdEmail,
  MdViewModule,
  MdViewList,
  MdCloudSync,
  MdContentCopy,
  MdArrowForward,
} from 'react-icons/md';

// Hostel Configuration
const HOSTEL_OPTIONS = [
  { id: 'BH2', code: 'BH2', name: 'BH-2 (Krishna Hostel)', block: 'BH-2', tag: 'Boys Hostel' },
  { id: 'BH1', code: 'BH1', name: 'BH-1 (Boys Hostel 1)', block: 'BH-1', tag: 'Boys Hostel' },
  { id: 'GH1', code: 'GH1', name: 'GH-1 (Girls Hostel 1)', block: 'GH-1', tag: 'Girls Hostel' },
  { id: 'GH2', code: 'GH2', name: 'GH-2 (Girls Hostel 2)', block: 'GH-2', tag: 'Girls Hostel' },
];

export default function RoomAllocation({ embedded = false }) {
  const { theme } = useTheme();

  // State
  const [selectedHostel, setSelectedHostel] = useState('BH2');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingPdf, setSyncingPdf] = useState(false);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFloor, setSelectedFloor] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'available', 'partial', 'full'
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'
  const [sortBy, setSortBy] = useState('default'); // 'default', 'vacancies_desc', 'occupancy_desc', 'room_asc'

  // Modals & Drawers
  const [activeRoomModal, setActiveRoomModal] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [targetRoomForAdd, setTargetRoomForAdd] = useState(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [studentToTransfer, setStudentToTransfer] = useState(null);
  const [showUnassignedDrawer, setShowUnassignedDrawer] = useState(false);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [showCapacityModal, setShowCapacityModal] = useState(false);

  // Form States
  const [addFormMode, setAddFormMode] = useState('unassigned'); // 'unassigned' | 'manual'
  const [selectedUnassignedId, setSelectedUnassignedId] = useState('');
  const [manualStudentForm, setManualStudentForm] = useState({
    name: '',
    rollNo: '',
    email: '',
    phone: '',
  });
  const [addLoading, setAddLoading] = useState(false);

  const [transferTargetRoom, setTransferTargetRoom] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);

  const [newRoomForm, setNewRoomForm] = useState({
    roomNumber: '',
    floor: '1st Floor',
    capacity: 4,
  });
  const [createRoomLoading, setCreateRoomLoading] = useState(false);

  const [capacityInput, setCapacityInput] = useState(4);
  const [capacityLoading, setCapacityLoading] = useState(false);

  const currentHostelInfo = useMemo(
    () => HOSTEL_OPTIONS.find((h) => h.id === selectedHostel) || HOSTEL_OPTIONS[0],
    [selectedHostel]
  );

  // Fetch Rooms Data
  const fetchRooms = useCallback(
    async (isSilent = false) => {
      try {
        if (!isSilent) setLoading(true);
        else setRefreshing(true);

        const res = await api.get(`/rooms?hostel=${selectedHostel}`);
        if (res.data?.success) {
          setData(res.data);
          // If a room detail modal is currently open, refresh it with updated room data
          if (activeRoomModal) {
            const updated = res.data.rooms.find((r) => r.roomNumber === activeRoomModal.roomNumber);
            if (updated) setActiveRoomModal(updated);
          }
        }
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to fetch room allocations');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedHostel, activeRoomModal]
  );

  useEffect(() => {
    setSelectedFloor('All');
    setStatusFilter('all');
    setSearchTerm('');
    setActiveRoomModal(null);
    fetchRooms();
  }, [selectedHostel]);

  // Derived Filtered & Sorted Rooms List
  const filteredRooms = useMemo(() => {
    if (!data?.rooms) return [];
    let list = [...data.rooms];

    // Floor filter
    if (selectedFloor !== 'All') {
      list = list.filter((r) => r.floor === selectedFloor);
    }

    // Status filter
    if (statusFilter === 'available') {
      list = list.filter((r) => r.vacancies > 0);
    } else if (statusFilter === 'partial') {
      list = list.filter((r) => r.occupancy > 0 && r.occupancy < r.capacity);
    } else if (statusFilter === 'full') {
      list = list.filter((r) => r.occupancy >= r.capacity);
    }

    // Search query
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.roomNumber.toLowerCase().includes(q) ||
          r.floor.toLowerCase().includes(q) ||
          r.students?.some(
            (s) =>
              (s.name && s.name.toLowerCase().includes(q)) ||
              (s.rollNo && s.rollNo.toLowerCase().includes(q)) ||
              (s.email && s.email.toLowerCase().includes(q)) ||
              (s.department && s.department.toLowerCase().includes(q))
          )
      );
    }

    // Sorting
    if (sortBy === 'vacancies_desc') {
      list.sort((a, b) => b.vacancies - a.vacancies);
    } else if (sortBy === 'occupancy_desc') {
      list.sort((a, b) => b.occupancy - a.occupancy);
    } else if (sortBy === 'room_asc') {
      list.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
    }

    return list;
  }, [data?.rooms, selectedFloor, statusFilter, searchTerm, sortBy]);

  // Statistics Calculation
  const stats = useMemo(() => {
    const defaultStats = {
      totalRooms: 0,
      totalCapacity: 0,
      totalOccupied: 0,
      totalVacancies: 0,
      fullRooms: 0,
      partialRooms: 0,
      availableRooms: 0,
      emptyRooms: 0,
      unassignedCount: 0,
      occupancyRate: 0,
    };
    if (!data?.rooms) return defaultStats;

    const list = data.rooms;
    let cap = 0;
    let occ = 0;
    let full = 0;
    let partial = 0;
    let empty = 0;
    let avail = 0;

    list.forEach((r) => {
      cap += r.capacity;
      occ += r.occupancy;
      if (r.occupancy >= r.capacity) {
        full++;
      } else if (r.occupancy === 0) {
        empty++;
        avail++;
      } else {
        partial++;
        avail++;
      }
    });

    const unassignedCount = data.unassigned?.length || 0;
    const occupancyRate = cap > 0 ? Math.round((occ / cap) * 100) : 0;

    return {
      totalRooms: list.length,
      totalCapacity: cap,
      totalOccupied: occ,
      totalVacancies: Math.max(0, cap - occ),
      fullRooms: full,
      partialRooms: partial,
      availableRooms: avail,
      emptyRooms: empty,
      unassignedCount,
      occupancyRate,
    };
  }, [data]);

  // Status Filter Counts
  const filterCounts = useMemo(() => {
    const list = data?.rooms || [];
    return {
      all: list.length,
      available: list.filter((r) => r.vacancies > 0).length,
      partial: list.filter((r) => r.occupancy > 0 && r.occupancy < r.capacity).length,
      full: list.filter((r) => r.occupancy >= r.capacity).length,
    };
  }, [data?.rooms]);

  // Candidate Rooms with Vacancies for Transfer Target Selection
  const roomsWithVacancies = useMemo(() => {
    if (!data?.rooms) return [];
    return data.rooms.filter((r) => r.vacancies > 0);
  }, [data?.rooms]);

  // Handlers: Remove Student from Room
  const handleRemoveStudent = async (roomNumber, student) => {
    if (
      !window.confirm(
        `Are you sure you want to remove ${student.name} (${student.rollNo || 'MIS unassigned'}) from Room ${roomNumber}?\n\nThis will immediately free up 1 bed vacancy in this room.`
      )
    ) {
      return;
    }
    const toastId = toast.loading(`Removing ${student.name} from Room ${roomNumber}...`);
    try {
      const res = await api.post(`/rooms/${encodeURIComponent(roomNumber)}/remove-student`, {
        studentId: student._id,
        rollNo: student.rollNo,
      });
      if (res.data?.success) {
        toast.success(res.data.message || 'Student removed from room successfully', { id: toastId });
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove student', { id: toastId });
    }
  };

  // Handlers: Add Student Submit
  const handleAddStudentSubmit = async (e) => {
    e.preventDefault();
    const targetRoom = targetRoomForAdd || activeRoomModal;
    if (!targetRoom) return;

    if (targetRoom.occupancy >= targetRoom.capacity) {
      toast.error(`Room ${targetRoom.roomNumber} is already full (${targetRoom.capacity}/${targetRoom.capacity} beds occupied)!`);
      return;
    }

    setAddLoading(true);
    try {
      let payload = {
        hostel: selectedHostel,
      };

      if (addFormMode === 'unassigned') {
        if (!selectedUnassignedId) {
          toast.error('Please select an unassigned student from the list');
          setAddLoading(false);
          return;
        }
        payload.studentId = selectedUnassignedId;
      } else {
        if (!manualStudentForm.name.trim()) {
          toast.error('Student name is required');
          setAddLoading(false);
          return;
        }
        payload.name = manualStudentForm.name.trim();
        payload.rollNo = manualStudentForm.rollNo.trim();
        payload.email = manualStudentForm.email.trim();
        payload.phone = manualStudentForm.phone.trim();
      }

      const res = await api.post(`/rooms/${encodeURIComponent(targetRoom.roomNumber)}/add-student`, payload);
      if (res.data?.success) {
        toast.success(res.data.message || 'Student assigned to room successfully!');
        setShowAddModal(false);
        setManualStudentForm({ name: '', rollNo: '', email: '', phone: '' });
        setSelectedUnassignedId('');
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to allocate student');
    } finally {
      setAddLoading(false);
    }
  };

  // Handlers: Transfer Student Submit
  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    if (!studentToTransfer || !transferTargetRoom) {
      toast.error('Please select a target room with vacancies');
      return;
    }

    setTransferLoading(true);
    try {
      const res = await api.post('/rooms/transfer-student', {
        studentId: studentToTransfer._id,
        targetRoomNumber: transferTargetRoom.trim(),
        hostel: selectedHostel,
      });

      if (res.data?.success) {
        toast.success(res.data.message || 'Student transferred successfully!');
        setShowTransferModal(false);
        setStudentToTransfer(null);
        setTransferTargetRoom('');
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to transfer student');
    } finally {
      setTransferLoading(false);
    }
  };

  // Handlers: Create New Room
  const handleCreateRoomSubmit = async (e) => {
    e.preventDefault();
    if (!newRoomForm.roomNumber.trim()) {
      toast.error('Room number is required');
      return;
    }

    setCreateRoomLoading(true);
    try {
      const res = await api.post('/rooms/create-room', {
        hostel: selectedHostel,
        roomNumber: newRoomForm.roomNumber.trim(),
        floor: newRoomForm.floor,
        capacity: Number(newRoomForm.capacity) || 4,
      });

      if (res.data?.success) {
        toast.success(res.data.message || 'Room created successfully!');
        setShowCreateRoomModal(false);
        setNewRoomForm({ roomNumber: '', floor: '1st Floor', capacity: 4 });
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create room');
    } finally {
      setCreateRoomLoading(false);
    }
  };

  // Handlers: Update Room Capacity
  const handleUpdateCapacitySubmit = async (e) => {
    e.preventDefault();
    if (!activeRoomModal) return;

    setCapacityLoading(true);
    try {
      const res = await api.put(`/rooms/${encodeURIComponent(activeRoomModal.roomNumber)}/capacity`, {
        hostel: selectedHostel,
        capacity: Number(capacityInput),
      });

      if (res.data?.success) {
        toast.success(res.data.message || 'Room capacity updated!');
        setShowCapacityModal(false);
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update capacity');
    } finally {
      setCapacityLoading(false);
    }
  };

  // Handlers: Sync Official PDF Data for BH-2
  const handleSyncPdf = async () => {
    if (selectedHostel !== 'BH2') {
      toast.error('Official PDF roster is strictly for BH-2 (Krishna Hostel).');
      return;
    }
    if (
      !window.confirm(
        'Sync all 394 students from the official BH-2 PDF roster?\n\nThis will re-verify room allocations across all 104 BH-2 rooms according to the university allotment sheet.'
      )
    ) {
      return;
    }

    setSyncingPdf(true);
    const toastId = toast.loading('Syncing BH-2 students and room allocations from PDF...');
    try {
      const res = await api.post('/rooms/sync-pdf', { hostel: 'BH2' });
      if (res.data?.success) {
        toast.success(res.data.message || 'BH-2 roster synced successfully!', { id: toastId });
        await fetchRooms(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to sync PDF data', { id: toastId });
    } finally {
      setSyncingPdf(false);
    }
  };

  // Export to Excel Roster
  const handleExportExcel = () => {
    if (!data?.rooms || data.rooms.length === 0) {
      toast.error('No room data available to export');
      return;
    }

    const rows = [];
    data.rooms.forEach((r) => {
      if (r.students && r.students.length > 0) {
        r.students.forEach((s) => {
          rows.push({
            'Hostel': currentHostelInfo.name,
            'Room Number': r.roomNumber,
            'Floor': r.floor,
            'Bed Number': s.bedIndex || '-',
            'Room Status': r.status === 'FULL' ? 'Full' : r.status === 'PARTIAL' ? 'Partially Occupied' : 'Available',
            'Room Capacity': r.capacity,
            'Occupancy': `${r.occupancy} / ${r.capacity}`,
            'Available Beds': r.vacancies,
            'Student Name': s.name,
            'Roll Number (MIS)': s.rollNo || '-',
            'Department': s.department || 'CSE',
            'Year': s.year || 'B.Tech',
            'Email': s.email || '-',
            'Phone': s.phone || '-',
          });
        });
      } else {
        rows.push({
          'Hostel': currentHostelInfo.name,
          'Room Number': r.roomNumber,
          'Floor': r.floor,
          'Bed Number': '-',
          'Room Status': 'Available (Empty)',
          'Room Capacity': r.capacity,
          'Occupancy': `0 / ${r.capacity}`,
          'Available Beds': r.capacity,
          'Student Name': '(Vacant Room)',
          'Roll Number (MIS)': '-',
          'Department': '-',
          'Year': '-',
          'Email': '-',
          'Phone': '-',
        });
      }
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `${selectedHostel} Roster`);

    // Auto column widths
    worksheet['!cols'] = [
      { wch: 22 }, // Hostel
      { wch: 14 }, // Room Number
      { wch: 16 }, // Floor
      { wch: 12 }, // Bed Number
      { wch: 18 }, // Room Status
      { wch: 14 }, // Capacity
      { wch: 14 }, // Occupancy
      { wch: 14 }, // Available Beds
      { wch: 26 }, // Student Name
      { wch: 18 }, // Roll Number
      { wch: 32 }, // Department
      { wch: 14 }, // Year
      { wch: 28 }, // Email
      { wch: 16 }, // Phone
    ];

    const fileName = `${selectedHostel}_Room_Allocation_Roster_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    toast.success(`Exported ${rows.length} allocation records to ${fileName}!`);
  };

  return (
    <div
      className={`room-allocation-page ${embedded ? 'embedded' : ''}`}
      style={{
        padding: embedded ? '0' : '24px 28px',
        maxWidth: 1600,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}
    >
      {/* ── Page Header & Hostel Selector ── */}
      <div
        className="card"
        style={{
          padding: '20px 24px',
          background: 'var(--bg-card)',
          borderRadius: 18,
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)',
              }}
            >
              <MdMeetingRoom />
            </div>
            <div>
              <h1
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  margin: 0,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.01em',
                }}
              >
                Room Allocation Management
              </h1>
              <p
                style={{
                  fontSize: 13,
                  margin: '3px 0 0',
                  color: 'var(--text-secondary)',
                }}
              >
                Inspect physical room capacity, track live bed vacancies, and manage student assignments.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {selectedHostel === 'BH2' && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={handleSyncPdf}
                disabled={syncingPdf || loading}
                title="Sync and re-verify all 394 students from the official BH-2 PDF allotment sheet"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
              >
                <MdCloudSync size={17} style={{ animation: syncingPdf ? 'spin 1s linear infinite' : 'none' }} />
                <span>Sync Official PDF Roster</span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={handleExportExcel}
              disabled={loading || !data?.rooms?.length}
              title="Download full room allocation data as Excel spreadsheet"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
            >
              <MdDownload size={17} />
              <span>Export Roster (.xlsx)</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setShowCreateRoomModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}
            >
              <MdAdd size={18} />
              <span>Add New Room</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => fetchRooms(true)}
              disabled={refreshing || loading}
              title="Refresh live occupancy data from database"
              style={{ padding: '8px 12px' }}
            >
              <MdRefresh size={18} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>
        </div>

        {/* Hostel Selector Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 4,
          }}
        >
          {HOSTEL_OPTIONS.map((h) => {
            const isSelected = selectedHostel === h.id;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => setSelectedHostel(h.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 18px',
                  borderRadius: 12,
                  border: isSelected
                    ? '2px solid #4f46e5'
                    : '1px solid var(--border-color, rgba(255,255,255,0.12))',
                  background: isSelected
                    ? 'linear-gradient(135deg, rgba(79, 70, 229, 0.15) 0%, rgba(6, 182, 212, 0.12) 100%)'
                    : 'var(--bg-input, rgba(255, 255, 255, 0.04))',
                  color: isSelected ? '#4f46e5' : 'var(--text-primary)',
                  fontWeight: isSelected ? 800 : 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>🏢</span>
                <span>{h.name}</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 99,
                    background: isSelected ? '#4f46e5' : 'rgba(255,255,255,0.1)',
                    color: isSelected ? '#ffffff' : 'var(--text-muted)',
                    fontWeight: 700,
                  }}
                >
                  {h.tag}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Summary KPI Cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
        }}
      >
        {/* Total Rooms */}
        <div
          className="card"
          style={{
            padding: '16px 18px',
            borderRadius: 16,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🏢</span> Total Rooms
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)' }}>
            {stats.totalRooms}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Total Capacity: {stats.totalCapacity} Beds
          </div>
        </div>

        {/* Assigned Students */}
        <div
          className="card"
          style={{
            padding: '16px 18px',
            borderRadius: 16,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>👥</span> Assigned Students
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#6366f1' }}>
            {stats.totalOccupied}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Occupancy Rate: {stats.occupancyRate}%
          </div>
        </div>

        {/* Available Beds */}
        <div
          className="card"
          style={{
            padding: '16px 18px',
            borderRadius: 16,
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.28)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🛏️</span> Available Beds
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#10b981' }}>
            {stats.totalVacancies}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Vacant beds ready for allocation
          </div>
        </div>

        {/* Available Rooms */}
        <div
          className="card"
          style={{
            padding: '16px 18px',
            borderRadius: 16,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#10b981' }}>🟢</span> Available Rooms
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#10b981' }}>
            {stats.availableRooms}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Rooms with at least 1 free bed
          </div>
        </div>

        {/* Partially Occupied */}
        <div
          className="card"
          style={{
            padding: '16px 18px',
            borderRadius: 16,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#f59e0b' }}>🟠</span> Partially Occupied
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#f59e0b' }}>
            {stats.partialRooms}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            1 to 3 students assigned
          </div>
        </div>

        {/* Full Rooms */}
        <div
          className="card"
          style={{
            padding: '16px 18px',
            borderRadius: 16,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#ef4444' }}>🔴</span> Full Rooms
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#ef4444' }}>
            {stats.fullRooms}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            All 4 beds filled
          </div>
        </div>

        {/* Unassigned Students */}
        <div
          className="card"
          onClick={() => setShowUnassignedDrawer(true)}
          style={{
            padding: '16px 18px',
            borderRadius: 16,
            background: stats.unassignedCount > 0 ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-card)',
            border: stats.unassignedCount > 0 ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            cursor: 'pointer',
            transition: 'all 0.18s ease',
          }}
          title="Click to view and allocate students currently without a room"
        >
          <div style={{ fontSize: 12, color: stats.unassignedCount > 0 ? '#ef4444' : 'var(--text-secondary)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📋</span> Unassigned Pool
            </div>
            <MdArrowForward size={16} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: stats.unassignedCount > 0 ? '#ef4444' : 'var(--text-primary)' }}>
            {stats.unassignedCount}
          </div>
          <div style={{ fontSize: 11.5, color: stats.unassignedCount > 0 ? '#ef4444' : 'var(--text-muted)', fontWeight: 600 }}>
            {stats.unassignedCount > 0 ? 'Needs Room Assignment' : 'All Students Allocated'}
          </div>
        </div>
      </div>

      {/* ── Search, Filters, and View Controls ── */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          background: 'var(--bg-card)',
          borderRadius: 16,
          border: '1px solid var(--glass-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          {/* Search Box */}
          <div style={{ position: 'relative', flex: 1, minWidth: 260, maxWidth: 440 }}>
            <MdSearch
              size={20}
              style={{
                position: 'absolute',
                left: 12,
                top: 11,
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              className="form-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by room number (e.g. 101, B13) or student name/MIS..."
              style={{ paddingLeft: 40, height: 42, borderRadius: 12, fontSize: 13 }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: 11,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <MdClose size={18} />
              </button>
            )}
          </div>

          {/* Floor Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Floor:</span>
            <select
              className="form-select"
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
              style={{ height: 40, borderRadius: 10, fontSize: 12.5, minWidth: 140 }}
            >
              {(data?.floors || ['All', 'Basement', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor']).map((fl) => (
                <option key={fl} value={fl}>
                  {fl}
                </option>
              ))}
            </select>
          </div>

          {/* Sorting */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Sort:</span>
            <select
              className="form-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ height: 40, borderRadius: 10, fontSize: 12.5, minWidth: 160 }}
            >
              <option value="default">Floor &amp; Room Number</option>
              <option value="vacancies_desc">Most Vacancies First</option>
              <option value="occupancy_desc">Most Occupied First</option>
              <option value="room_asc">Room Number (A-Z)</option>
            </select>
          </div>

          {/* Grid vs Table View Mode */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-input, rgba(255,255,255,0.06))',
              borderRadius: 10,
              padding: 3,
              border: '1px solid var(--border-color)',
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: viewMode === 'grid' ? '#4f46e5' : 'transparent',
                color: viewMode === 'grid' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <MdViewModule size={16} />
              <span>Room Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: viewMode === 'table' ? '#4f46e5' : 'transparent',
                color: viewMode === 'table' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <MdViewList size={16} />
              <span>Directory Table</span>
            </button>
          </div>
        </div>

        {/* Room Status Filter Pills */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
            paddingTop: 4,
            borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, marginRight: 4 }}>
            Status Filter:
          </span>

          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            style={{
              padding: '5px 12px',
              borderRadius: 99,
              border: statusFilter === 'all' ? '1.5px solid #4f46e5' : '1px solid var(--border-color)',
              background: statusFilter === 'all' ? 'rgba(79, 70, 229, 0.15)' : 'transparent',
              color: statusFilter === 'all' ? '#4f46e5' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            All Rooms ({filterCounts.all})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('available')}
            style={{
              padding: '5px 12px',
              borderRadius: 99,
              border: statusFilter === 'available' ? '1.5px solid #10b981' : '1px solid var(--border-color)',
              background: statusFilter === 'available' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
              color: statusFilter === 'available' ? '#10b981' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
            <span>Available ({filterCounts.available})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('partial')}
            style={{
              padding: '5px 12px',
              borderRadius: 99,
              border: statusFilter === 'partial' ? '1.5px solid #f59e0b' : '1px solid var(--border-color)',
              background: statusFilter === 'partial' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
              color: statusFilter === 'partial' ? '#f59e0b' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
            <span>Partially Occupied ({filterCounts.partial})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('full')}
            style={{
              padding: '5px 12px',
              borderRadius: 99,
              border: statusFilter === 'full' ? '1.5px solid #ef4444' : '1px solid var(--border-color)',
              background: statusFilter === 'full' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
              color: statusFilter === 'full' ? '#ef4444' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
            <span>Full ({filterCounts.full})</span>
          </button>
        </div>
      </div>

      {/* ── Main Rooms Section ── */}
      {loading ? (
        <div
          className="card"
          style={{
            padding: 60,
            textAlign: 'center',
            color: 'var(--text-secondary)',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              margin: '0 auto 16px',
              borderRadius: '50%',
              border: '4px solid rgba(99, 102, 241, 0.2)',
              borderTopColor: '#6366f1',
              animation: 'spin 1s linear infinite',
            }}
          />
          <div style={{ fontSize: 16, fontWeight: 800 }}>Loading Room Allocations...</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Fetching physical room records and student rosters for {currentHostelInfo.name}
          </div>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 48,
            textAlign: 'center',
            color: 'var(--text-secondary)',
            background: 'var(--bg-card)',
            borderRadius: 18,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary)' }}>
            No Matching Rooms Found
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 450, margin: '0 auto 18px' }}>
            No rooms match your filter criteria (Search: "{searchTerm}", Floor: {selectedFloor}, Status: {statusFilter}).
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setSearchTerm('');
              setSelectedFloor('All');
              setStatusFilter('all');
            }}
          >
            Clear All Filters
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* ── Modern Grid Layout of Room Cards ── */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 18,
          }}
        >
          {filteredRooms.map((room) => {
            const isFull = room.occupancy >= room.capacity;
            const isPartial = room.occupancy > 0 && room.occupancy < room.capacity;
            const isAvailable = room.vacancies > 0;

            // Status Styling Tokens
            const statusConfig = isFull
              ? {
                  label: 'Full',
                  color: '#ef4444',
                  bg: 'rgba(239, 68, 68, 0.12)',
                  border: 'rgba(239, 68, 68, 0.35)',
                }
              : isPartial
              ? {
                  label: 'Partially Occupied',
                  color: '#f59e0b',
                  bg: 'rgba(245, 158, 11, 0.12)',
                  border: 'rgba(245, 158, 11, 0.35)',
                }
              : {
                  label: 'Available',
                  color: '#10b981',
                  bg: 'rgba(16, 185, 129, 0.12)',
                  border: 'rgba(16, 185, 129, 0.35)',
                };

            const percentage = Math.min(100, Math.round((room.occupancy / room.capacity) * 100));

            return (
              <div
                key={room.roomNumber}
                className="room-card"
                onClick={() => setActiveRoomModal(room)}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 18,
                  border: `1.5px solid ${statusConfig.border}`,
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Top Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>🚪</span>
                      <h3
                        style={{
                          fontSize: 18,
                          fontWeight: 900,
                          margin: 0,
                          color: 'var(--text-primary)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        Room {room.roomNumber}
                      </h3>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        marginTop: 3,
                        fontWeight: 600,
                      }}
                    >
                      {room.floor} · {currentHostelInfo.code}
                    </div>
                  </div>

                  {/* Status Indicator Badge */}
                  <span
                    style={{
                      background: statusConfig.bg,
                      color: statusConfig.color,
                      border: `1px solid ${statusConfig.border}`,
                      padding: '4px 10px',
                      borderRadius: 99,
                      fontSize: 11.5,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: statusConfig.color,
                      }}
                    />
                    <span>{statusConfig.label}</span>
                  </span>
                </div>

                {/* Capacity & Occupancy Bar */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 6,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span>
                      Occupied: <strong style={{ color: 'var(--text-primary)' }}>{room.occupancy}</strong> / {room.capacity}
                    </span>
                    <span style={{ color: isAvailable ? '#10b981' : 'var(--text-muted)' }}>
                      Available Beds: <strong>{room.vacancies}</strong>
                    </span>
                  </div>
                  <div
                    style={{
                      height: 7,
                      borderRadius: 99,
                      background: 'var(--bg-input, rgba(255,255,255,0.08))',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${percentage}%`,
                        height: '100%',
                        background: statusConfig.color,
                        borderRadius: 99,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>

                {/* Resident Students Chips / Beds Overview */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '8px 10px',
                    borderRadius: 12,
                    background: 'var(--bg-input, rgba(255,255,255,0.03))',
                    border: '1px solid var(--border-color, rgba(255,255,255,0.06))',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Bed Allocations ({room.occupancy}/{room.capacity})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {room.beds?.map((b) => {
                      if (b.status === 'OCCUPIED' && b.student) {
                        return (
                          <div
                            key={b.bedNumber}
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              padding: '3px 8px',
                              borderRadius: 8,
                              background: 'rgba(99, 102, 241, 0.12)',
                              color: 'var(--text-primary)',
                              border: '1px solid rgba(99, 102, 241, 0.25)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={`Bed ${b.bedNumber}: ${b.student.name} (${b.student.rollNo || 'MIS unassigned'})`}
                          >
                            <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 800 }}>B{b.bedNumber}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.student.name}</span>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={b.bedNumber}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 8,
                            background: 'rgba(16, 185, 129, 0.08)',
                            color: '#10b981',
                            border: '1px dashed rgba(16, 185, 129, 0.4)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 800 }}>B{b.bedNumber}</span>
                          <span>Vacant</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginTop: 'auto',
                    paddingTop: 4,
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveRoomModal(room);
                    }}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '6px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>View Room Details</span>
                    <MdArrowForward size={14} />
                  </button>

                  {room.vacancies > 0 ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTargetRoomForAdd(room);
                        setShowAddModal(true);
                      }}
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        padding: '6px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: '#10b981',
                        border: 'none',
                      }}
                    >
                      <MdPersonAdd size={15} />
                      <span>+ Assign</span>
                    </button>
                  ) : (
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                      No Beds Free
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Detailed Table / Directory View ── */
        <div
          className="card"
          style={{
            padding: 0,
            overflow: 'hidden',
            borderRadius: 16,
            border: '1px solid var(--glass-border)',
            background: 'var(--bg-card)',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    background: 'var(--bg-input, rgba(255,255,255,0.04))',
                    borderBottom: '1px solid var(--border-color)',
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Room</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Floor</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Occupancy</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Available Beds</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Resident Students</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRooms.map((room) => {
                  const isFull = room.occupancy >= room.capacity;
                  const isPartial = room.occupancy > 0 && room.occupancy < room.capacity;
                  const statusColor = isFull ? '#ef4444' : isPartial ? '#f59e0b' : '#10b981';
                  const statusLabel = isFull ? 'Full' : isPartial ? 'Partially Occupied' : 'Available';

                  return (
                    <tr
                      key={room.roomNumber}
                      onClick={() => setActiveRoomModal(room)}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                      className="room-table-row"
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 800 }}>
                        🚪 Room {room.roomNumber}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {room.floor}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 99,
                            fontSize: 11.5,
                            fontWeight: 800,
                            background: isFull
                              ? 'rgba(239, 68, 68, 0.12)'
                              : isPartial
                              ? 'rgba(245, 158, 11, 0.12)'
                              : 'rgba(16, 185, 129, 0.12)',
                            color: statusColor,
                          }}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                        {room.occupancy} / {room.capacity}
                      </td>
                      <td style={{ padding: '12px 16px', color: room.vacancies > 0 ? '#10b981' : 'var(--text-muted)', fontWeight: 700 }}>
                        {room.vacancies}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {room.students?.map((s) => (
                            <span
                              key={s._id}
                              style={{
                                fontSize: 11.5,
                                background: 'rgba(99, 102, 241, 0.1)',
                                color: 'var(--text-primary)',
                                padding: '2px 8px',
                                borderRadius: 6,
                              }}
                            >
                              {s.name} ({s.rollNo || 'MIS unassigned'})
                            </span>
                          ))}
                          {(!room.students || room.students.length === 0) && (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>
                              No students assigned
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {room.vacancies > 0 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTargetRoomForAdd(room);
                                setShowAddModal(true);
                              }}
                              style={{ padding: '4px 10px', fontSize: 11.5, background: '#10b981', border: 'none' }}
                            >
                              + Assign
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveRoomModal(room);
                            }}
                            style={{ padding: '4px 10px', fontSize: 11.5 }}
                          >
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 1: ROOM DETAILS & STUDENT MANAGEMENT MODAL
      ────────────────────────────────────────────────────────────────────────── */}
      {activeRoomModal && (
        <div
          className="modal-backdrop show"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setActiveRoomModal(null)}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 720,
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: 22,
              background: 'var(--bg-surface, #ffffff)',
              border: '1px solid var(--border-color)',
              padding: 26,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    background: 'rgba(99, 102, 241, 0.12)',
                    color: '#6366f1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                  }}
                >
                  <MdMeetingRoom />
                </div>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                    Room {activeRoomModal.roomNumber}
                  </h2>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>
                    {activeRoomModal.floor} · {currentHostelInfo.name} ({currentHostelInfo.code})
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setCapacityInput(activeRoomModal.capacity);
                    setShowCapacityModal(true);
                  }}
                  title="Modify total bed capacity for this room"
                  style={{ fontSize: 12, padding: '6px 10px' }}
                >
                  Edit Capacity
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRoomModal(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <MdClose size={24} />
                </button>
              </div>
            </div>

            {/* Room Metrics Banner */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
                padding: '14px 18px',
                borderRadius: 14,
                background: 'var(--bg-input, rgba(255,255,255,0.04))',
                border: '1px solid var(--border-color)',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Total Capacity
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>
                  {activeRoomModal.capacity} Beds
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Occupied
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#6366f1', marginTop: 2 }}>
                  {activeRoomModal.occupancy} Students
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Available Beds
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: activeRoomModal.vacancies > 0 ? '#10b981' : '#ef4444', marginTop: 2 }}>
                  {activeRoomModal.vacancies} Available
                </div>
              </div>
            </div>

            {/* Resident Students List */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Assigned Students ({activeRoomModal.occupancy}/{activeRoomModal.capacity})
                </h3>

                {activeRoomModal.vacancies > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setTargetRoomForAdd(activeRoomModal);
                      setShowAddModal(true);
                    }}
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      background: '#10b981',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <MdPersonAdd size={15} />
                    <span>+ Add Student to Room</span>
                  </button>
                )}
              </div>

              {activeRoomModal.students && activeRoomModal.students.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {activeRoomModal.students.map((student, idx) => (
                    <div
                      key={student._id}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 14,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 14,
                        flexWrap: 'wrap',
                      }}
                    >
                      {/* Left: Avatar + Details */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240, flex: 1 }}>
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 900,
                            fontSize: 16,
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}
                        >
                          {student.studentPhoto ? (
                            <img
                              src={student.studentPhoto}
                              alt={student.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            student.name.charAt(0).toUpperCase()
                          )}
                        </div>

                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                              {student.name}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                padding: '1px 7px',
                                borderRadius: 99,
                                background: 'rgba(99, 102, 241, 0.14)',
                                color: '#6366f1',
                                fontWeight: 700,
                              }}
                            >
                              Bed {student.bedIndex || idx + 1}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span><strong>MIS:</strong> {student.rollNo || 'Not Assigned'}</span>
                            <span>•</span>
                            <span>{student.department || 'CSE'}</span>
                            <span>•</span>
                            <span>{student.year || 'B.Tech'}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 12 }}>
                            {student.email && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <MdEmail size={12} /> {student.email}
                              </span>
                            )}
                            {student.phone && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <MdPhone size={12} /> {student.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setStudentToTransfer(student);
                            setTransferTargetRoom('');
                            setShowTransferModal(true);
                          }}
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '6px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                          title="Move student to another room with available vacancies"
                        >
                          <MdSwapHoriz size={16} />
                          <span>Move Room</span>
                        </button>

                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => handleRemoveStudent(activeRoomModal.roomNumber, student)}
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '6px 10px',
                            color: '#ef4444',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          title="Remove student from room (frees up 1 bed)"
                        >
                          <MdDeleteOutline size={16} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    padding: 30,
                    textAlign: 'center',
                    borderRadius: 14,
                    background: 'var(--bg-input, rgba(255,255,255,0.03))',
                    border: '1px dashed var(--border-color)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <p style={{ margin: '0 0 10px', fontWeight: 700 }}>
                    This room currently has no students assigned (All {activeRoomModal.capacity} beds are vacant).
                  </p>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setTargetRoomForAdd(activeRoomModal);
                      setShowAddModal(true);
                    }}
                    style={{ background: '#10b981', border: 'none', fontWeight: 800 }}
                  >
                    + Assign Student to this Room
                  </button>
                </div>
              )}
            </div>

            {/* Vacant Beds Slots Breakdown */}
            {activeRoomModal.vacancies > 0 && (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: 'rgba(16, 185, 129, 0.06)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#10b981' }}>
                    {activeRoomModal.vacancies} Bed Vacanc{activeRoomModal.vacancies === 1 ? 'y' : 'ies'} Available
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                    You can assign students from the unassigned pool or register a new student directly into this room.
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    setTargetRoomForAdd(activeRoomModal);
                    setShowAddModal(true);
                  }}
                  style={{ background: '#10b981', border: 'none', fontWeight: 800 }}
                >
                  Assign Bed
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 2: ASSIGN STUDENT TO ROOM
      ────────────────────────────────────────────────────────────────────────── */}
      {showAddModal && (
        <div
          className="modal-backdrop show"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 520,
              borderRadius: 20,
              background: 'var(--bg-surface, #ffffff)',
              border: '1px solid var(--border-color)',
              padding: 24,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                  Assign Student to Room {targetRoomForAdd?.roomNumber || activeRoomModal?.roomNumber}
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {currentHostelInfo.name} · Bed capacity: {targetRoomForAdd?.capacity || activeRoomModal?.capacity}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={22} />
              </button>
            </div>

            {/* Mode Selector */}
            <div
              style={{
                display: 'flex',
                background: 'var(--bg-input, rgba(255,255,255,0.06))',
                borderRadius: 12,
                padding: 4,
                marginBottom: 16,
                border: '1px solid var(--border-color)',
              }}
            >
              <button
                type="button"
                onClick={() => setAddFormMode('unassigned')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: addFormMode === 'unassigned' ? '#4f46e5' : 'transparent',
                  color: addFormMode === 'unassigned' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                From Unassigned Pool ({data?.unassigned?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setAddFormMode('manual')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: addFormMode === 'manual' ? '#4f46e5' : 'transparent',
                  color: addFormMode === 'manual' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                Enter Details Manually
              </button>
            </div>

            <form onSubmit={handleAddStudentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {addFormMode === 'unassigned' ? (
                <div>
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'block' }}>
                    Select Student from Unassigned Pool:
                  </label>
                  {data?.unassigned && data.unassigned.length > 0 ? (
                    <select
                      className="form-select"
                      value={selectedUnassignedId}
                      onChange={(e) => setSelectedUnassignedId(e.target.value)}
                      required
                      style={{ width: '100%', height: 42, borderRadius: 10, fontSize: 13 }}
                    >
                      <option value="">-- Choose an unassigned student --</option>
                      {data.unassigned.map((st) => (
                        <option key={st._id} value={st._id}>
                          {st.name} — {st.rollNo ? `MIS: ${st.rollNo}` : 'No MIS'} ({st.department || 'CSE'})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 10,
                        background: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        color: '#10b981',
                        fontSize: 12.5,
                        textAlign: 'center',
                        fontWeight: 600,
                      }}
                    >
                      All students in {currentHostelInfo.code} are currently assigned! Switch to "Enter Details Manually" to register a new student.
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                      Student Full Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={manualStudentForm.name}
                      onChange={(e) => setManualStudentForm({ ...manualStudentForm, name: e.target.value })}
                      placeholder="e.g. John Doe"
                      required
                      style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                      Roll Number (MIS)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={manualStudentForm.rollNo}
                      onChange={(e) => setManualStudentForm({ ...manualStudentForm, rollNo: e.target.value })}
                      placeholder="e.g. 112515231"
                      style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                      College Email
                    </label>
                    <input
                      type="email"
                      className="form-input"
                      value={manualStudentForm.email}
                      onChange={(e) => setManualStudentForm({ ...manualStudentForm, email: e.target.value })}
                      placeholder="e.g. student@cse.iiitp.ac.in"
                      style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      className="form-input"
                      value={manualStudentForm.phone}
                      onChange={(e) => setManualStudentForm({ ...manualStudentForm, phone: e.target.value })}
                      placeholder="e.g. +91 98765 43210"
                      style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 13 }}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={addLoading || (addFormMode === 'unassigned' && !selectedUnassignedId)}
                  style={{ flex: 1, background: '#10b981', border: 'none', fontWeight: 800 }}
                >
                  {addLoading ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 3: TRANSFER / MOVE STUDENT TO ANOTHER ROOM
      ────────────────────────────────────────────────────────────────────────── */}
      {showTransferModal && studentToTransfer && (
        <div
          className="modal-backdrop show"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowTransferModal(false)}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 480,
              borderRadius: 20,
              background: 'var(--bg-surface, #ffffff)',
              border: '1px solid var(--border-color)',
              padding: 24,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                  Move Student Room
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Transferring <strong>{studentToTransfer.name}</strong> ({studentToTransfer.rollNo || 'No MIS'})
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={22} />
              </button>
            </div>

            <form onSubmit={handleTransferSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'block' }}>
                  Target Room with Available Vacancies:
                </label>
                <select
                  className="form-select"
                  value={transferTargetRoom}
                  onChange={(e) => setTransferTargetRoom(e.target.value)}
                  required
                  style={{ width: '100%', height: 42, borderRadius: 10, fontSize: 13 }}
                >
                  <option value="">-- Choose a target room with vacancy --</option>
                  {roomsWithVacancies.map((rm) => (
                    <option key={rm.roomNumber} value={rm.roomNumber}>
                      Room {rm.roomNumber} ({rm.floor}) — {rm.vacancies} bed{rm.vacancies === 1 ? '' : 's'} available ({rm.occupancy}/{rm.capacity})
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                ℹ️ <strong>Capacity Protection:</strong> Only rooms with at least 1 free bed can be selected. The student will be transferred immediately and the previous room's bed will become available.
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowTransferModal(false)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={transferLoading || !transferTargetRoom}
                  style={{ flex: 1, fontWeight: 800 }}
                >
                  {transferLoading ? 'Transferring...' : 'Confirm Move'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 4: UNASSIGNED STUDENTS POOL DRAWER
      ────────────────────────────────────────────────────────────────────────── */}
      {showUnassignedDrawer && (
        <div
          className="modal-backdrop show"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowUnassignedDrawer(false)}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 640,
              maxHeight: '85vh',
              overflowY: 'auto',
              borderRadius: 20,
              background: 'var(--bg-surface, #ffffff)',
              border: '1px solid var(--border-color)',
              padding: 24,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                  Unassigned Student Pool ({data?.unassigned?.length || 0})
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Students residing in {currentHostelInfo.name} who need physical room allocation
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUnassignedDrawer(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={22} />
              </button>
            </div>

            {data?.unassigned && data.unassigned.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.unassigned.map((st) => (
                  <div
                    key={st._id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>
                        {st.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        MIS: <strong>{st.rollNo || 'Not Assigned'}</strong> · {st.department || 'CSE'} ({st.year || 'B.Tech'})
                      </div>
                      {st.email && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {st.email}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        setShowUnassignedDrawer(false);
                        setSelectedUnassignedId(st._id);
                        setAddFormMode('unassigned');
                        setShowAddModal(true);
                      }}
                      style={{ fontSize: 12, fontWeight: 800, background: '#10b981', border: 'none' }}
                    >
                      Assign Room
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
                <div style={{ fontWeight: 800 }}>No unassigned students!</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  All students in {currentHostelInfo.name} are already allocated to physical rooms.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 5: CREATE NEW ROOM
      ────────────────────────────────────────────────────────────────────────── */}
      {showCreateRoomModal && (
        <div
          className="modal-backdrop show"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowCreateRoomModal(false)}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 440,
              borderRadius: 20,
              background: 'var(--bg-surface, #ffffff)',
              border: '1px solid var(--border-color)',
              padding: 24,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                  Add New Hostel Room
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Create a physical room in {currentHostelInfo.name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateRoomModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={22} />
              </button>
            </div>

            <form onSubmit={handleCreateRoomSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                  Room Number <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={newRoomForm.roomNumber}
                  onChange={(e) => setNewRoomForm({ ...newRoomForm, roomNumber: e.target.value })}
                  placeholder="e.g. 101, 204, B14"
                  required
                  style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 13 }}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                  Floor Location
                </label>
                <select
                  className="form-select"
                  value={newRoomForm.floor}
                  onChange={(e) => setNewRoomForm({ ...newRoomForm, floor: e.target.value })}
                  style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 13 }}
                >
                  <option value="Basement">Basement</option>
                  <option value="Ground Floor">Ground Floor</option>
                  <option value="1st Floor">1st Floor</option>
                  <option value="2nd Floor">2nd Floor</option>
                  <option value="3rd Floor">3rd Floor</option>
                  <option value="4th Floor">4th Floor</option>
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                  Total Bed Capacity
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  className="form-input"
                  value={newRoomForm.capacity}
                  onChange={(e) => setNewRoomForm({ ...newRoomForm, capacity: Number(e.target.value) })}
                  style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateRoomModal(false)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createRoomLoading}
                  style={{ flex: 1, fontWeight: 800 }}
                >
                  {createRoomLoading ? 'Creating...' : 'Create Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 6: EDIT ROOM CAPACITY
      ────────────────────────────────────────────────────────────────────────── */}
      {showCapacityModal && activeRoomModal && (
        <div
          className="modal-backdrop show"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 85,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowCapacityModal(false)}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 400,
              borderRadius: 18,
              background: 'var(--bg-surface, #ffffff)',
              border: '1px solid var(--border-color)',
              padding: 22,
            }}
          >
            <h3 style={{ fontSize: 17, fontWeight: 900, margin: '0 0 12px', color: 'var(--text-primary)' }}>
              Edit Capacity for Room {activeRoomModal.roomNumber}
            </h3>
            <form onSubmit={handleUpdateCapacitySubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                  Total Bed Capacity (1–10 Beds)
                </label>
                <input
                  type="number"
                  min={Math.max(1, activeRoomModal.occupancy)}
                  max="10"
                  className="form-input"
                  value={capacityInput}
                  onChange={(e) => setCapacityInput(e.target.value)}
                  style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 14 }}
                />
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  Cannot be lower than currently assigned students ({activeRoomModal.occupancy}).
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCapacityModal(false)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={capacityLoading}
                  style={{ flex: 1, fontWeight: 800 }}
                >
                  {capacityLoading ? 'Updating...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Responsive Styles */}
      <style>{`
        .room-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.12) !important;
        }
        .room-table-row:hover {
          background: rgba(99, 102, 241, 0.05) !important;
        }
        @media (max-width: 640px) {
          .room-allocation-page {
            padding: 14px !important;
          }
        }
      `}</style>
    </div>
  );
}
