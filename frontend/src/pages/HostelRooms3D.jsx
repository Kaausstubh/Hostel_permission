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
  MdFileDownload,
  MdTableChart,
  MdContentCopy,
  MdVisibility,
} from 'react-icons/md';
import { useTheme } from '../context/ThemeContext';
import StudentAvatar from '../components/StudentAvatar';
import { getHostelLabel } from '../utils/hostel';
import { exportHostelStudentsExcel } from '../utils/excelReportGenerator';
import hostelStudentsData from '../data/hostelStudentsData.json';

// Helper: Determine Floor from Room Number
const getFloorForRoom = (roomNumber) => {
  if (!roomNumber) return 'Ground Floor';
  const r = String(roomNumber).trim().toUpperCase();
  if (r.startsWith('B')) return 'Basement';
  const num = parseInt(r.replace(/\D/g, ''), 10);
  if (isNaN(num)) return 'Ground Floor';
  if (num < 100) return 'Ground Floor';
  if (num >= 100 && num < 200) return '1st Floor';
  if (num >= 200 && num < 300) return '2nd Floor';
  if (num >= 300 && num < 400) return '3rd Floor';
  if (num >= 400 && num < 500) return '4th Floor';
  return 'Ground Floor';
};

// Helper: Academic Year from MIS
const getYearFromMis = (mis) => {
  if (!mis) return '—';
  const str = String(mis).trim();
  if (str.startsWith('1125')) return '2nd Year';
  if (str.startsWith('1124')) return '3rd Year';
  if (str.startsWith('1123')) return '4th Year';
  if (str.startsWith('1126')) return '1st Year';
  return 'B.Tech';
};

// Helper: Capitalize Student Name
const formatStudentName = (name) => {
  if (!name) return '—';
  return String(name)
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

// Helper: Natural Room Ordering
const sortRoomsNatural = (a, b) => {
  const roomA = String(a.room || a.roomNumber || '');
  const roomB = String(b.room || b.roomNumber || '');
  const isBaseA = roomA.toUpperCase().startsWith('B');
  const isBaseB = roomB.toUpperCase().startsWith('B');
  if (isBaseA && !isBaseB) return -1;
  if (!isBaseA && isBaseB) return 1;
  const numA = parseInt(roomA.replace(/\D/g, ''), 10) || 0;
  const numB = parseInt(roomB.replace(/\D/g, ''), 10) || 0;
  if (numA !== numB) return numA - numB;
  return roomA.localeCompare(roomB);
};

export const HOSTEL_OPTIONS_CONFIG = [
  { id: 'BH1', name: 'Brahmaputra', code: 'BH-1', type: "Boys' Hostel 1", icon: '🏢', color: '#3b82f6', subtitle: 'Brahmaputra Residence (394 Students)' },
  { id: 'BH2', name: 'Krishna',     code: 'BH-2', type: "Boys' Hostel 2", icon: '🏢', color: '#6366f1', subtitle: 'Krishna Residence (394 Students)' },
  { id: 'GH1', name: 'Indrayani',   code: 'GH-1', type: "Girls' Hostel 1", icon: '🏢', color: '#ec4899', subtitle: 'Indrayani Residence' },
  { id: 'GH2', name: 'Sindhu',      code: 'GH-2', type: "Girls' Hostel 2", icon: '🏢', color: '#f43f5e', subtitle: 'Sindhu Residence' },
];

export default function HostelRooms3D({ embedded = false }) {
  const { theme } = useTheme();
  const [hostel, setHostel] = useState('BH1');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingPdf, setSyncingPdf] = useState(false);
  const [importSummary, setImportSummary] = useState(null);

  // View Mode: '3d-matrix' (Physical 3D Grid) or 'excel-roster' (Spreadsheet View)
  const [viewMode, setViewMode] = useState('3d-matrix');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [rosterYearFilter, setRosterYearFilter] = useState('All');
  const [rosterPageSize, setRosterPageSize] = useState(100);
  const [rosterPage, setRosterPage] = useState(1);

  const currentHostel = useMemo(
    () => HOSTEL_OPTIONS_CONFIG.find((h) => h.id === hostel) || HOSTEL_OPTIONS_CONFIG[0],
    [hostel]
  );

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
    setSelectedFloor('All');
    setSearchTerm('');
    setRosterYearFilter('All');
    setRosterPage(1);
    setActiveRoom(null);
    fetchRooms();
  }, [hostel]);

  // Sync / Re-load all 394 students from the uploaded PDF
  const handleSyncPdf = async () => {
    if (!window.confirm(`Sync and upload all 394 students from the PDF into ${currentHostel.name} (${currentHostel.code})?`)) {
      return;
    }
    setSyncingPdf(true);
    const toastId = toast.loading(`Syncing all students and room allocations from PDF into ${currentHostel.code}...`);
    try {
      const res = await api.post('/rooms/sync-pdf', { hostel });
      if (res.data?.success) {
        toast.success(res.data.message || 'All students from PDF synced successfully!', { id: toastId });
        if (res.data?.summary) {
          setImportSummary(res.data.summary);
        }
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

  // Filter counts
  const filterCounts = useMemo(() => {
    const list = data?.rooms || [];
    return {
      all: list.length,
      vacant: list.filter((r) => r.occupancy > 0 && r.occupancy < r.capacity).length,
      full: list.filter((r) => r.occupancy >= r.capacity).length,
      empty: list.filter((r) => r.occupancy === 0).length,
    };
  }, [data?.rooms]);

  // Client-side filtered rooms
  const filteredRooms = useMemo(() => {
    if (!data?.rooms) return [];
    let list = data.rooms;

    if (selectedFloor !== 'All') {
      list = list.filter((r) => r.floor === selectedFloor);
    }

    if (statusFilter === 'vacant') {
      list = list.filter((r) => r.occupancy > 0 && r.occupancy < r.capacity);
    } else if (statusFilter === 'full') {
      list = list.filter((r) => r.occupancy >= r.capacity);
    } else if (statusFilter === 'empty') {
      list = list.filter((r) => r.occupancy === 0);
    }

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
              (s.email && s.email.toLowerCase().includes(q))
          ) ||
          r.beds?.some(
            (b) =>
              b.student &&
              ((b.student.name && b.student.name.toLowerCase().includes(q)) ||
                (b.student.rollNo && b.student.rollNo.toLowerCase().includes(q)) ||
                (b.student.email && b.student.email.toLowerCase().includes(q)))
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
    roomsWithVacancies: 0,
    emptyRooms: 0,
    unassignedCount: 0,
  };

  // Dynamic Floor Options
  const floorOptions = useMemo(() => {
    const rooms = data?.rooms || [];
    const totalRooms = rooms.length;

    const floorCounts = {};
    rooms.forEach((r) => {
      floorCounts[r.floor] = (floorCounts[r.floor] || 0) + 1;
    });

    if (['BH1', 'BH2'].includes(hostel)) {
      return [
        { label: `All Floors (${totalRooms})`, value: 'All', icon: '🏢' },
        { label: `Basement (B01-B13) (${floorCounts['Basement'] || 0})`, value: 'Basement', icon: '🔻' },
        { label: `Ground Floor (2-30) (${floorCounts['Ground Floor'] || 0})`, value: 'Ground Floor', icon: '🚪' },
        { label: `1st Floor (101-132) (${floorCounts['1st Floor'] || 0})`, value: '1st Floor', icon: '1️⃣' },
        { label: `2nd Floor (201-234) (${floorCounts['2nd Floor'] || 0})`, value: '2nd Floor', icon: '2️⃣' },
        { label: `3rd Floor (301-321) (${floorCounts['3rd Floor'] || 0})`, value: '3rd Floor', icon: '3️⃣' },
      ];
    }

    const order = { 'Basement': 0, 'Ground Floor': 1, '1st Floor': 2, '2nd Floor': 3, '3rd Floor': 4, '4th Floor': 5 };
    const icons = { 'Basement': '🔻', 'Ground Floor': '🚪', '1st Floor': '1️⃣', '2nd Floor': '2️⃣', '3rd Floor': '3️⃣', '4th Floor': '4️⃣' };
    const sortedFloors = Object.keys(floorCounts).sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99));

    return [
      { label: `All Floors (${totalRooms})`, value: 'All', icon: '🏢' },
      ...sortedFloors.map((fl) => ({
        label: `${fl} (${floorCounts[fl] || 0})`,
        value: fl,
        icon: icons[fl] || '🏢',
      })),
    ];
  }, [hostel, data?.rooms]);

  // ── All Residing Students in this Hostel (Live DB + Official PDF list fallback) ──
  const allHostelStudents = useMemo(() => {
    const list = [];
    const seenMis = new Set();
    const bedCountPerRoom = {};

    // 1. Live DB Occupants
    if (data?.rooms && Array.isArray(data.rooms)) {
      data.rooms.forEach((room) => {
        if (Array.isArray(room.beds)) {
          room.beds.forEach((b, idx) => {
            if (b?.student && (b.student.name || b.student.rollNo)) {
              const mis = b.student.rollNo || b.student.mis || '';
              const key = mis ? String(mis).toLowerCase() : `${room.roomNumber}-${idx}`;
              if (!seenMis.has(key)) {
                seenMis.add(key);
                bedCountPerRoom[room.roomNumber] = (bedCountPerRoom[room.roomNumber] || 0) + 1;
                list.push({
                  name: b.student.name,
                  mis: mis || '—',
                  room: room.roomNumber,
                  floor: room.floor || getFloorForRoom(room.roomNumber),
                  bedIndex: b.bedNumber || (idx + 1),
                  year: getYearFromMis(mis),
                  phone: b.student.phone || '—',
                  email: b.student.email || (mis ? `${mis}@cse.iiitp.ac.in` : '—'),
                  _id: b.student._id,
                  hostel: currentHostel.code,
                  source: 'db',
                });
              }
            }
          });
        }
        if (Array.isArray(room.students)) {
          room.students.forEach((st, idx) => {
            const mis = st.rollNo || st.mis || '';
            const key = mis ? String(mis).toLowerCase() : `${room.roomNumber}-st-${idx}`;
            if (!seenMis.has(key)) {
              seenMis.add(key);
              bedCountPerRoom[room.roomNumber] = (bedCountPerRoom[room.roomNumber] || 0) + 1;
              list.push({
                name: st.name,
                mis: mis || '—',
                room: room.roomNumber,
                floor: room.floor || getFloorForRoom(room.roomNumber),
                bedIndex: idx + 1,
                year: getYearFromMis(mis),
                phone: st.phone || '—',
                email: st.email || (mis ? `${mis}@cse.iiitp.ac.in` : '—'),
                _id: st._id,
                hostel: currentHostel.code,
                source: 'db',
              });
            }
          });
        }
      });
    }

    // 2. Official PDF student list fallback for BH1 / BH2 (if DB not fully synced)
    if (['BH1', 'BH2'].includes(hostel)) {
      hostelStudentsData.forEach((pdfSt) => {
        const misKey = pdfSt.mis ? String(pdfSt.mis).toLowerCase() : null;
        if (!misKey || !seenMis.has(misKey)) {
          if (misKey) seenMis.add(misKey);
          bedCountPerRoom[pdfSt.room] = (bedCountPerRoom[pdfSt.room] || 0) + 1;
          list.push({
            name: pdfSt.name,
            mis: pdfSt.mis,
            room: pdfSt.room,
            floor: getFloorForRoom(pdfSt.room),
            bedIndex: bedCountPerRoom[pdfSt.room] <= 4 ? bedCountPerRoom[pdfSt.room] : 1,
            year: pdfSt.year || getYearFromMis(pdfSt.mis),
            phone: '—',
            email: `${pdfSt.mis}@cse.iiitp.ac.in`,
            hostel: currentHostel.code,
            source: 'pdf-official',
          });
        }
      });
    }

    // Sort by natural room order, then bed index
    return list.sort((a, b) => {
      const roomDiff = sortRoomsNatural(a, b);
      if (roomDiff !== 0) return roomDiff;
      return (a.bedIndex || 1) - (b.bedIndex || 1);
    });
  }, [data?.rooms, hostel, currentHostel]);

  // Filtered Roster for Excel View
  const filteredRosterStudents = useMemo(() => {
    let list = allHostelStudents;

    if (selectedFloor !== 'All') {
      list = list.filter((s) => s.floor === selectedFloor);
    }

    if (rosterYearFilter !== 'All') {
      list = list.filter((s) => s.year === rosterYearFilter);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (s) =>
          (s.name && s.name.toLowerCase().includes(q)) ||
          (s.mis && s.mis.toLowerCase().includes(q)) ||
          (s.room && s.room.toLowerCase().includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q))
      );
    }

    return list;
  }, [allHostelStudents, selectedFloor, rosterYearFilter, searchTerm]);

  // Paginated Roster Students
  const paginatedRosterStudents = useMemo(() => {
    if (rosterPageSize === 'All' || rosterPageSize >= filteredRosterStudents.length) {
      return filteredRosterStudents;
    }
    const size = Number(rosterPageSize) || 100;
    const start = (rosterPage - 1) * size;
    return filteredRosterStudents.slice(start, start + size);
  }, [filteredRosterStudents, rosterPage, rosterPageSize]);

  const totalRosterPages = useMemo(() => {
    if (rosterPageSize === 'All') return 1;
    const size = Number(rosterPageSize) || 100;
    return Math.ceil(filteredRosterStudents.length / size) || 1;
  }, [filteredRosterStudents.length, rosterPageSize]);

  // Roster metrics
  const uniqueRoomsCount = useMemo(() => {
    return new Set(allHostelStudents.map((s) => s.room)).size;
  }, [allHostelStudents]);

  const secondYearCount = useMemo(() => {
    return allHostelStudents.filter((s) => s.year === '2nd Year').length;
  }, [allHostelStudents]);

  const thirdYearCount = useMemo(() => {
    return allHostelStudents.filter((s) => s.year === '3rd Year').length;
  }, [allHostelStudents]);

  // Download official Excel sheet (.xlsx)
  const handleDownloadExcel = async () => {
    try {
      setExportingExcel(true);
      const toastId = toast.loading(`Preparing official Excel sheet for ${currentHostel.code} (${currentHostel.name}) students...`);

      await exportHostelStudentsExcel({
        hostelCode: currentHostel.code,
        hostelName: currentHostel.name,
        students: allHostelStudents,
        customFileName: `${currentHostel.code}_${currentHostel.name.replace(/\s+/g, '_')}_Hostel_Students_Roster.xlsx`,
      });

      toast.success(`Excel sheet for ${currentHostel.code} ${currentHostel.name} downloaded!`, { id: toastId });
    } catch (err) {
      toast.error(err.message || 'Failed to download Excel sheet');
    } finally {
      setExportingExcel(false);
    }
  };

  // Inspect student room in 3D modal
  const handleInspectStudentRoom = (student) => {
    const foundRoom = data?.rooms?.find((r) => r.roomNumber === student.room);
    if (foundRoom) {
      setActiveRoom(foundRoom);
    } else {
      const roomOccupants = allHostelStudents.filter((s) => s.room === student.room);
      setActiveRoom({
        roomNumber: student.room,
        floor: student.floor,
        capacity: 4,
        occupancy: roomOccupants.length,
        vacancies: Math.max(0, 4 - roomOccupants.length),
        hostel,
        students: roomOccupants.map((s, idx) => ({
          name: s.name,
          rollNo: s.mis,
          email: s.email,
          phone: s.phone,
          bedNumber: s.bedIndex || (idx + 1),
        })),
        beds: roomOccupants.map((s, idx) => ({
          bedNumber: s.bedIndex || (idx + 1),
          isOccupied: true,
          student: {
            name: s.name,
            rollNo: s.mis,
            email: s.email,
            phone: s.phone,
          },
        })),
      });
    }
  };

  // Copy MIS to clipboard
  const handleCopyMis = (mis) => {
    if (!mis || mis === '—') return;
    navigator.clipboard.writeText(String(mis));
    toast.success(`Copied MIS ${mis} to clipboard!`);
  };

  return (
    <div className={`hostel-rooms-3d-page ${embedded ? 'embedded' : ''}`}>
      {!embedded && (
        <Navbar
          title={`Hostel ${currentHostel.code} (${currentHostel.name}) • 3D Room Allocation Matrix`}
        />
      )}

      <div className="page-area hostel-rooms-page-container" style={{ padding: embedded ? '0' : '20px 28px 40px' }}>
        {/* ── Hostel Selection Switcher (BH-1, BH-2, GH-1, GH-2) ── */}
        <div
          className="hostel-switcher-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          {HOSTEL_OPTIONS_CONFIG.map((h) => {
            const isSelected = hostel === h.id;
            return (
              <div
                key={h.id}
                className={`hostel-switcher-card ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  if (hostel !== h.id) {
                    setHostel(h.id);
                  }
                }}
                role="button"
                tabIndex={0}
                style={{
                  padding: '16px 20px',
                  borderRadius: 18,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  border: isSelected
                    ? `2px solid ${h.color}`
                    : (theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.1)'),
                  background: isSelected
                    ? (theme === 'light' ? '#ffffff' : 'rgba(30, 41, 59, 0.95)')
                    : (theme === 'light' ? '#f8fafc' : 'rgba(15, 23, 42, 0.5)'),
                  boxShadow: isSelected
                    ? `0 10px 28px ${h.color}35`
                    : '0 2px 8px rgba(0,0,0,0.03)',
                  transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: isSelected ? 'translateY(-2px)' : 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 4,
                    background: isSelected ? h.color : 'transparent',
                    transition: 'all 0.2s ease',
                  }}
                />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: isSelected ? `${h.color}20` : (theme === 'light' ? '#e2e8f0' : 'rgba(255,255,255,0.06)'),
                        color: isSelected ? h.color : 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        fontWeight: 900,
                      }}
                    >
                      {h.icon}
                    </div>
                    <div>
                      <div
                        className="hostel-code"
                        style={{
                          fontWeight: 900,
                          fontSize: 16,
                          color: isSelected ? h.color : 'var(--text-primary)',
                          letterSpacing: '-0.02em',
                        }}
                      >
                        {h.code}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {h.name}
                      </div>
                    </div>
                  </div>

                  {isSelected ? (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 900,
                        background: `linear-gradient(135deg, ${h.color}, #4f46e5)`,
                        color: '#fff',
                        padding: '3px 9px',
                        borderRadius: 99,
                        letterSpacing: '0.05em',
                        boxShadow: `0 2px 8px ${h.color}44`,
                      }}
                    >
                      ACTIVE
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                      {h.type}
                    </span>
                  )}
                </div>

                <div className="hostel-subtitle" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  {h.subtitle}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Top Header Bar ── */}
        <div
          className="rooms-top-header-bar"
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
                    background: `linear-gradient(135deg, ${currentHostel.color}, #4f46e5)`,
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                  }}
                >
                  HOSTEL {currentHostel.code} ({currentHostel.name.toUpperCase()})
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Standard Capacity: <strong>4 Students / Room</strong>
                </span>
              </div>
              <h1
                className="rooms-main-title"
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
                <span>🏢 {currentHostel.name} ({currentHostel.code}) • 3D Room Occupancy & Vacancy Matrix</span>
              </h1>
            </div>

            <div className="rooms-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* Excel Download Button */}
              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={exportingExcel}
                style={{
                  padding: '9px 16px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #107c41 0%, #0c5e31 100%)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: exportingExcel ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(16, 124, 65, 0.35)',
                  transition: 'all 0.18s ease',
                }}
                title={`Download official .xlsx Excel sheet of ${currentHostel.code} (${currentHostel.name}) students`}
              >
                <MdFileDownload size={18} />
                <span>{exportingExcel ? 'Exporting...' : `Download Excel Sheet (.xlsx)`}</span>
              </button>

              {['BH1', 'BH2'].includes(hostel) && (
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
                  title={`Sync / Upload all 394 students from the official PDF list into ${currentHostel.code}`}
                >
                  <span>📥</span>
                  <span>{syncingPdf ? 'Syncing PDF...' : `Sync All PDF Students (394)`}</span>
                </button>
              )}

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
            </div>
          </div>

          {/* ── Summary Stats Grid ── */}
          <div
            className="rooms-stats-grid"
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

        {/* ── View Switcher: 3D Rooms Grid vs Excel Students Roster ── */}
        <div
          className="rooms-view-switcher-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div
            className="view-switcher-group"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: theme === 'light' ? '#f1f5f9' : 'rgba(255, 255, 255, 0.05)',
              padding: '4px',
              borderRadius: 14,
              border: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('3d-matrix')}
              style={{
                padding: '8px 18px',
                borderRadius: 10,
                border: 'none',
                background: viewMode === '3d-matrix'
                  ? (theme === 'light' ? '#ffffff' : 'rgba(99, 102, 241, 0.35)')
                  : 'transparent',
                color: viewMode === '3d-matrix'
                  ? (theme === 'light' ? '#1e293b' : '#ffffff')
                  : 'var(--text-muted)',
                fontWeight: viewMode === '3d-matrix' ? 800 : 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: viewMode === '3d-matrix' ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.18s ease',
              }}
            >
              <MdViewInAr size={18} style={{ color: viewMode === '3d-matrix' ? '#6366f1' : 'inherit' }} />
              <span>3D Rooms Grid</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('excel-roster')}
              style={{
                padding: '8px 18px',
                borderRadius: 10,
                border: 'none',
                background: viewMode === 'excel-roster'
                  ? (theme === 'light' ? '#ffffff' : 'rgba(16, 124, 65, 0.35)')
                  : 'transparent',
                color: viewMode === 'excel-roster'
                  ? (theme === 'light' ? '#107c41' : '#34d399')
                  : 'var(--text-muted)',
                fontWeight: viewMode === 'excel-roster' ? 800 : 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: viewMode === 'excel-roster' ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.18s ease',
              }}
            >
              <MdTableChart size={18} style={{ color: '#107c41' }} />
              <span>Students Roster (Excel View)</span>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 99,
                  background: viewMode === 'excel-roster'
                    ? 'rgba(16, 124, 65, 0.15)'
                    : (theme === 'light' ? '#e2e8f0' : 'rgba(255,255,255,0.1)'),
                  fontWeight: 800,
                }}
              >
                {allHostelStudents.length}
              </span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Active View: <strong>{viewMode === '3d-matrix' ? 'Physical 3D Room Grid' : `${currentHostel.code} Excel Students Roster`}</strong>
            </span>
          </div>
        </div>

        {viewMode === '3d-matrix' && (
          <>
            {/* ── Floor Navigation Elevation Pills ── */}
        <div className="floor-pills-scroll" style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 16 }}>
          {floorOptions.map((fl) => (
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
          className="rooms-filter-toolbar"
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
            className="rooms-search-box"
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
          <div className="occupancy-filter-group" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'All Rooms', value: 'all', count: filterCounts.all },
              { label: '🟢 Has Vacancies', value: 'vacant', count: filterCounts.vacant },
              { label: '🔴 Full (4/4)', value: 'full', count: filterCounts.full },
              { label: '⚪ Empty', value: 'empty', count: filterCounts.empty },
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
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              Rendering 3D {currentHostel.code} ({currentHostel.name}) Room Matrix...
            </div>
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
            className="rooms-matrix-grid view-3d-active"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
              gap: 22,
              perspective: '1300px',
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
                      ? (theme === 'light' ? '1.5px solid #fecaca' : '1px solid rgba(239, 68, 68, 0.4)')
                      : hasVacancy
                      ? (theme === 'light' ? '1.5px solid #bbf7d0' : '1.5px solid rgba(16, 185, 129, 0.45)')
                      : '1px solid var(--border-color)',
                    borderBottom: isFull
                      ? '5px solid #ef4444'
                      : hasVacancy
                      ? '5px solid #10b981'
                      : '5px solid #6366f1',
                    borderRadius: 20,
                    padding: 18,
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'all 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
                    boxShadow: theme === 'light'
                      ? '0 6px 0 rgba(0,0,0,0.03), 0 16px 28px -6px rgba(0,0,0,0.09), 0 4px 8px -2px rgba(0,0,0,0.04)'
                      : '0 8px 0 rgba(0,0,0,0.4), 0 18px 32px -6px rgba(0,0,0,0.55), 0 0 20px rgba(99, 102, 241, 0.1)',
                    transform: 'rotateX(3deg) translateZ(0)',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-8px) scale(1.02) rotateX(6deg)';
                    e.currentTarget.style.boxShadow = isFull
                      ? '0 12px 0 rgba(239, 68, 68, 0.2), 0 24px 38px -8px rgba(239, 68, 68, 0.32)'
                      : '0 12px 0 rgba(16, 185, 129, 0.2), 0 24px 38px -8px rgba(16, 185, 129, 0.32)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'rotateX(3deg) translateZ(0)';
                    e.currentTarget.style.boxShadow = theme === 'light'
                      ? '0 6px 0 rgba(0,0,0,0.03), 0 16px 28px -6px rgba(0,0,0,0.09)'
                      : '0 8px 0 rgba(0,0,0,0.4), 0 18px 32px -6px rgba(0,0,0,0.55), 0 0 20px rgba(99, 102, 241, 0.1)';
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
                      {Array.from({ length: 4 }).map((_, idx) => {
                        const student = room.students?.[idx] || (room.beds?.[idx]?.status === 'OCCUPIED' ? room.beds[idx].student : null);
                        const bedNumber = idx + 1;

                        if (student) {
                          return (
                            <div
                              key={student._id || idx}
                              style={{
                                background: theme === 'light' ? '#ffffff' : 'rgba(30, 41, 59, 0.85)',
                                border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.12)',
                                borderRadius: 10,
                                padding: '7px 9px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                overflow: 'hidden',
                              }}
                              title={`Bed ${bedNumber}: ${student.name} (${student.rollNo || 'MIS N/A'})`}
                            >
                              <div
                                style={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: '50%',
                                  background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                                  color: '#fff',
                                  fontSize: 10,
                                  fontWeight: 900,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                {bedNumber}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'capitalize' }}>
                                  {student.name}
                                </div>
                                <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                  MIS: {student.rollNo || 'N/A'}
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
                                padding: '7px 9px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                              title={`Bed ${bedNumber}: EMPTY / VACANT — Click to allocate student`}
                            >
                              <div
                                style={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: '50%',
                                  background: 'rgba(16, 185, 129, 0.2)',
                                  color: '#10b981',
                                  fontSize: 10,
                                  fontWeight: 900,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                {bedNumber}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: '#10b981', letterSpacing: '0.01em' }}>
                                  EMPTY / VACANT
                                </div>
                                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                                  Available Bed
                                </div>
                              </div>
                            </div>
                          );
                        }
                      })}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingTop: 6,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        borderTop: theme === 'light' ? '1px dashed #e2e8f0' : '1px dashed rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      <span>Occupancy: <strong>{room.occupancy}/4</strong></span>
                      <span>Available: <strong>{room.vacancies}</strong></span>
                      <span style={{ color: isFull ? '#ef4444' : room.occupancy === 0 ? 'var(--text-muted)' : '#10b981' }}>
                        {isFull ? 'FULL' : room.occupancy === 0 ? 'EMPTY' : 'PARTIALLY OCCUPIED'}
                      </span>
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
      </>
    )}

    {/* ── EXCEL STUDENTS ROSTER VIEW ── */}
    {viewMode === 'excel-roster' && (
      <div className="excel-roster-view-container">
        {/* 1. Header Card with Title requested by user */}
        <div
          className="excel-roster-header-card"
          style={{
            background: theme === 'light' ? '#ffffff' : 'rgba(15, 23, 42, 0.85)',
            border: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 20,
            padding: '22px 26px',
            marginBottom: 20,
            boxShadow: '0 8px 30px rgba(0,0,0,0.04)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span
                  style={{
                    background: 'linear-gradient(135deg, #107c41, #0c5e31)',
                    color: '#fff',
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <MdTableChart size={14} /> EXCEL SPREADSHEET VIEW
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Official Allocation Register • {currentHostel.code}
                </span>
              </div>

              {/* Title requested by user: e.g. "BH-2 Krishna Hostel Students" */}
              <h2
                style={{
                  margin: 0,
                  fontSize: 24,
                  fontWeight: 900,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.02em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span>{currentHostel.code} {currentHostel.name} Hostel Students</span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    padding: '3px 12px',
                    borderRadius: 99,
                    background: 'rgba(16, 124, 65, 0.12)',
                    color: '#107c41',
                    border: '1px solid rgba(16, 124, 65, 0.3)',
                  }}
                >
                  {filteredRosterStudents.length} Students Listed
                </span>
              </h2>

              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Complete room occupancy directory with student name, MIS number, assigned room, bed number, and academic year.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={exportingExcel}
                style={{
                  padding: '11px 22px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #107c41 0%, #0c5e31 100%)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 13.5,
                  cursor: exportingExcel ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 6px 20px rgba(16, 124, 65, 0.35)',
                  transition: 'all 0.18s ease',
                }}
                title={`Download official .xlsx Excel spreadsheet of ${currentHostel.code} (${currentHostel.name}) students`}
              >
                <MdFileDownload size={20} />
                <span>{exportingExcel ? 'Generating Sheet...' : `Download Excel Sheet (.xlsx)`}</span>
              </button>
            </div>
          </div>

          {/* Roster Metric Badges */}
          <div
            className="excel-roster-metrics-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 12,
              marginTop: 18,
              paddingTop: 16,
              borderTop: theme === 'light' ? '1px solid #f1f5f9' : '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(16, 124, 65, 0.08)', border: '1px solid rgba(16, 124, 65, 0.2)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: '#107c41', textTransform: 'uppercase' }}>Total Students</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{allHostelStudents.length}</div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase' }}>Filtered Results</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{filteredRosterStudents.length}</div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase' }}>Allocated Rooms</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{uniqueRoomsCount}</div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase' }}>2nd Year (1125)</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{secondYearCount}</div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: '#c084fc', textTransform: 'uppercase' }}>3rd Year (1124)</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>{thirdYearCount}</div>
            </div>
          </div>
        </div>

        {/* 2. Roster Filter & Search Bar */}
        <div
          className="roster-toolbar-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {/* Search Box */}
          <div className="roster-search-box" style={{ position: 'relative', flex: '1 1 280px', maxWidth: 440 }}>
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
              placeholder="Search Student Name, MIS, or Room (e.g. B13, 203)..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setRosterPage(1);
              }}
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

          {/* Floor Filter Pills */}
          <div className="roster-toolbar-pills floor-pills" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {floorOptions.map((fl) => (
              <button
                key={fl.value}
                type="button"
                onClick={() => {
                  setSelectedFloor(fl.value);
                  setRosterPage(1);
                }}
                style={{
                  padding: '7px 12px',
                  borderRadius: 10,
                  border: selectedFloor === fl.value ? '1.5px solid #107c41' : '1px solid var(--border-color)',
                  background: selectedFloor === fl.value ? 'rgba(16, 124, 65, 0.15)' : 'transparent',
                  color: selectedFloor === fl.value ? '#107c41' : 'var(--text-secondary)',
                  fontWeight: selectedFloor === fl.value ? 800 : 600,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>{fl.icon}</span>
                <span>{fl.value === 'All' ? 'All Floors' : fl.value}</span>
              </button>
            ))}
          </div>

          {/* Year Filter Pills */}
          <div className="roster-toolbar-pills year-pills" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {['All', '2nd Year', '3rd Year'].map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => {
                  setRosterYearFilter(yr);
                  setRosterPage(1);
                }}
                style={{
                  padding: '7px 12px',
                  borderRadius: 10,
                  border: rosterYearFilter === yr ? '1.5px solid #6366f1' : '1px solid var(--border-color)',
                  background: rosterYearFilter === yr ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  color: rosterYearFilter === yr ? 'var(--primary-light)' : 'var(--text-secondary)',
                  fontWeight: rosterYearFilter === yr ? 800 : 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {yr === 'All' ? 'All Years' : yr}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Excel Spreadsheet Data Table */}
        <div
          className="excel-table-card"
          style={{
            background: theme === 'light' ? '#ffffff' : 'rgba(15, 23, 42, 0.9)',
            border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
          }}
        >
          {/* Spreadsheet Top Green Accent Bar */}
          <div
            style={{
              background: 'linear-gradient(90deg, #107c41, #1e7145, #10b981)',
              height: 4,
              width: '100%',
            }}
          />

          <div className="mobile-table-hint">
            👉 Swipe horizontally to view all spreadsheet columns
          </div>

          <div className="excel-table-scroll-wrapper" style={{ overflowX: 'auto', maxHeight: '680px' }}>
            <table
              className="excel-spreadsheet-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                textAlign: 'left',
                fontSize: 13,
              }}
            >
              <thead
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  background: theme === 'light' ? '#f1f5f9' : '#1e293b',
                  borderBottom: theme === 'light' ? '2px solid #cbd5e1' : '2px solid rgba(255, 255, 255, 0.12)',
                }}
              >
                <tr>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: 'var(--text-primary)', width: 50, textAlign: 'center' }}>#</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>Student Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>MIS Number</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>Hostel</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>Room No</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>Bed No</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>Floor</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>Academic Year</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>Email Address</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRosterStudents.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: 36, marginBottom: 8 }}>🔍</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>No students match your filter criteria</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>Try clearing the search or switching the floor/year filter.</div>
                    </td>
                  </tr>
                ) : (
                  paginatedRosterStudents.map((st, idx) => {
                    const rowNum = (rosterPage - 1) * (rosterPageSize === 'All' ? 0 : Number(rosterPageSize)) + idx + 1;
                    const isEven = idx % 2 === 0;
                    return (
                      <tr
                        key={`${st.mis}-${st.room}-${idx}`}
                        style={{
                          background: theme === 'light'
                            ? (isEven ? '#ffffff' : '#f8fafc')
                            : (isEven ? 'rgba(30, 41, 59, 0.4)' : 'rgba(15, 23, 42, 0.25)'),
                          borderBottom: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.05)',
                          transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = theme === 'light' ? 'rgba(16, 124, 65, 0.06)' : 'rgba(16, 124, 65, 0.15)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = theme === 'light'
                            ? (isEven ? '#ffffff' : '#f8fafc')
                            : (isEven ? 'rgba(30, 41, 59, 0.4)' : 'rgba(15, 23, 42, 0.25)');
                        }}
                      >
                        {/* # */}
                        <td style={{ padding: '11px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }}>
                          {rowNum}
                        </td>

                        {/* Student Name */}
                        <td style={{ padding: '11px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 10,
                                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: 13,
                                flexShrink: 0,
                              }}
                            >
                              {st.name ? st.name.charAt(0).toUpperCase() : '?'}
                            </div>
                            <div>
                              <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                                {formatStudentName(st.name)}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* MIS Number */}
                        <td style={{ padding: '11px 16px' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontWeight: 700,
                                fontSize: 12.5,
                                color: '#6366f1',
                                background: 'rgba(99, 102, 241, 0.1)',
                                padding: '3px 8px',
                                borderRadius: 6,
                              }}
                            >
                              {st.mis || '—'}
                            </span>
                            {st.mis && st.mis !== '—' && (
                              <button
                                type="button"
                                onClick={() => handleCopyMis(st.mis)}
                                title="Copy MIS"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--text-muted)',
                                  padding: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                }}
                              >
                                <MdContentCopy size={14} />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Hostel */}
                        <td style={{ padding: '11px 16px' }}>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: currentHostel.color,
                              background: `${currentHostel.color}15`,
                              padding: '3px 8px',
                              borderRadius: 6,
                            }}
                          >
                            {currentHostel.code} ({currentHostel.name})
                          </span>
                        </td>

                        {/* Room Number */}
                        <td style={{ padding: '11px 16px' }}>
                          <button
                            type="button"
                            onClick={() => handleInspectStudentRoom(st)}
                            title={`Inspect Room ${st.room} 3D View`}
                            style={{
                              background: 'rgba(16, 185, 129, 0.12)',
                              color: '#059669',
                              border: '1px solid rgba(16, 185, 129, 0.35)',
                              padding: '4px 10px',
                              borderRadius: 8,
                              fontWeight: 800,
                              fontSize: 12.5,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              transition: 'transform 0.15s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                          >
                            <span>🚪</span>
                            <span>Room {st.room}</span>
                          </button>
                        </td>

                        {/* Bed Number */}
                        <td style={{ padding: '11px 16px' }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              background: 'rgba(59, 130, 246, 0.1)',
                              color: '#3b82f6',
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            Bed {st.bedIndex || 1}
                          </span>
                        </td>

                        {/* Floor */}
                        <td style={{ padding: '11px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {st.floor}
                        </td>

                        {/* Academic Year */}
                        <td style={{ padding: '11px 16px' }}>
                          <span
                            style={{
                              padding: '3px 9px',
                              borderRadius: 6,
                              background: st.year === '2nd Year'
                                ? 'rgba(245, 158, 11, 0.12)'
                                : 'rgba(168, 85, 247, 0.12)',
                              color: st.year === '2nd Year' ? '#d97706' : '#9333ea',
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            {st.year}
                          </span>
                        </td>

                        {/* Email */}
                        <td style={{ padding: '11px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
                          {st.email || '—'}
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '11px 16px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleInspectStudentRoom(st)}
                            style={{
                              padding: '5px 12px',
                              borderRadius: 8,
                              border: '1px solid var(--border-color)',
                              background: theme === 'light' ? '#ffffff' : 'rgba(255, 255, 255, 0.06)',
                              color: 'var(--primary-light)',
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <MdVisibility size={14} />
                            <span>Inspect Room</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Pagination Controls */}
          <div
            className="excel-table-footer"
            style={{
              padding: '12px 20px',
              borderTop: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
              background: theme === 'light' ? '#f8fafc' : 'rgba(15, 23, 42, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Showing <strong>{paginatedRosterStudents.length}</strong> of <strong>{filteredRosterStudents.length}</strong> students (Total: {allHostelStudents.length})
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Page Size Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Rows per page:</span>
                <select
                  value={rosterPageSize}
                  onChange={(e) => {
                    setRosterPageSize(e.target.value === 'All' ? 'All' : Number(e.target.value));
                    setRosterPage(1);
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--border-color)',
                    background: theme === 'light' ? '#ffffff' : '#1e293b',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value="All">All ({filteredRosterStudents.length})</option>
                </select>
              </div>

              {/* Pagination Buttons */}
              {rosterPageSize !== 'All' && totalRosterPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setRosterPage((p) => Math.max(1, p - 1))}
                    disabled={rosterPage === 1}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      cursor: rosterPage === 1 ? 'not-allowed' : 'pointer',
                      opacity: rosterPage === 1 ? 0.4 : 1,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Previous
                  </button>

                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', padding: '0 4px' }}>
                    Page {rosterPage} of {totalRosterPages}
                  </span>

                  <button
                    type="button"
                    onClick={() => setRosterPage((p) => Math.min(totalRosterPages, p + 1))}
                    disabled={rosterPage === totalRosterPages}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      cursor: rosterPage === totalRosterPages ? 'not-allowed' : 'pointer',
                      opacity: rosterPage === totalRosterPages ? 0.4 : 1,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
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
            className="room-modal-card"
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
              className="room-modal-header"
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
                    Hostel {currentHostel.code} ({currentHostel.name}) • Room {activeRoom.roomNumber}
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
            <div className="room-modal-body" style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Occupancy Status Strip */}
              <div
                className="room-occupancy-strip"
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
                        className="modal-student-row"
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
                        <div className="modal-student-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
            className="modal-compact-card"
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
                  Hostel {currentHostel.code} ({currentHostel.name}) • Available Vacancies: {activeRoom.vacancies}
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
            className="modal-compact-card"
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
                  Target Room Number in {currentHostel.code} ({currentHostel.name}):
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

      {/* ── PDF IMPORT & RECONCILIATION SUMMARY MODAL ── */}
      {importSummary && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            animation: 'fadeInModal 0.2s ease-out',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setImportSummary(null);
          }}
        >
          <div
            className="modal-compact-card modal-summary-card"
            style={{
              backgroundColor: theme === 'light' ? '#ffffff' : '#0f172a',
              borderRadius: 24,
              border: theme === 'light' ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
              maxWidth: 620,
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              animation: 'scaleUpModal 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: theme === 'light' ? '#f8fafc' : 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    fontWeight: 900,
                  }}
                >
                  ✓
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>
                    PDF Student Import & Reconciliation Summary
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Official Allocation Lists 2026–2027 • BH-2 (Krishna)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportSummary(null)}
                style={{ background: 'transparent', border: 'none', fontSize: 22, color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Metrics Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 10,
                }}
              >
                <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase' }}>Total Read</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 3 }}>{importSummary.totalRead}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>From 10 Pages</div>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#10b981', textTransform: 'uppercase' }}>Allocated BH-2</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#10b981', marginTop: 3 }}>{importSummary.allocatedBH2 || importSummary.imported}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Active 4-Bed Slots</div>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase' }}>Verified Rooms</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 3 }}>{importSummary.roomsCreatedOrUpdated}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Basement to 3rd Fl</div>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.25)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#c084fc', textTransform: 'uppercase' }}>Total Capacity</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 3 }}>{importSummary.totalCapacity || (importSummary.roomsCreatedOrUpdated * 4)} Beds</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>4 Beds / Room</div>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase' }}>Available Beds</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#f59e0b', marginTop: 3 }}>{importSummary.availableBeds} Vacant</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Across 14 Rooms</div>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: '#ef4444', textTransform: 'uppercase' }}>Requires Review</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#ef4444', marginTop: 3 }}>{importSummary.requiresReview}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Flagged Students</div>
                </div>
              </div>

              {/* Status Note */}
              <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: 12, color: 'var(--text-primary)' }}>
                <strong>✓ Data Integrity Verified:</strong> All 10 pages of the official student allocation list (323 2nd Year + 71 3rd Year) were processed. All 104 rooms were synchronized with strict 4-bed limits.
              </div>

              {/* Records Flagged for Review Panel */}
              {importSummary.reviewList && importSummary.reviewList.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>⚠️</span>
                    <span>Records Requiring Manual Review ({importSummary.reviewList.length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {importSummary.reviewList.map((st, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 12,
                          background: theme === 'light' ? '#fef2f2' : 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{st.name}</span>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>MIS: {st.rollNo || 'N/A'}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#ef4444', marginTop: 3 }}>
                          <strong>Reason:</strong> {st.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '14px 24px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={() => setImportSummary(null)}
                style={{
                  padding: '9px 24px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'var(--primary)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Close Summary
              </button>
            </div>
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
        .mobile-table-hint {
          display: none;
        }

        /* ── Mobile & Tablet Responsiveness (< 768px) ── */
        @media (max-width: 768px) {
          .hostel-rooms-page-container {
            padding: 12px !important;
          }

          /* Hostel Switcher Grid */
          .hostel-switcher-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 8px !important;
            margin-bottom: 14px !important;
          }
          .hostel-switcher-card {
            padding: 10px 12px !important;
            border-radius: 14px !important;
          }
          .hostel-switcher-card .hostel-code {
            font-size: 14px !important;
          }
          .hostel-switcher-card .hostel-subtitle {
            display: none !important;
          }

          /* Top Header Bar */
          .rooms-top-header-bar {
            padding: 14px 16px !important;
            border-radius: 16px !important;
            gap: 12px !important;
            margin-bottom: 14px !important;
          }
          .rooms-main-title {
            font-size: 18px !important;
            line-height: 1.3 !important;
          }
          .rooms-header-actions {
            width: 100% !important;
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 8px !important;
          }
          .rooms-header-actions button {
            width: 100% !important;
            justify-content: center !important;
            padding: 11px 14px !important;
            font-size: 13px !important;
          }

          /* Summary Stats Grid */
          .rooms-stats-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 8px !important;
          }
          .stat-pill {
            padding: 9px 12px !important;
            border-radius: 12px !important;
          }
          .stat-pill > div:last-child {
            font-size: 19px !important;
          }

          /* View Switcher Bar */
          .rooms-view-switcher-bar {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            margin-bottom: 14px !important;
          }
          .view-switcher-group {
            width: 100% !important;
            display: flex !important;
          }
          .view-switcher-group button {
            flex: 1 !important;
            justify-content: center !important;
            padding: 9px 10px !important;
            font-size: 12px !important;
          }

          /* Floor Elevation Pills */
          .floor-pills-scroll {
            padding-bottom: 8px !important;
            margin-bottom: 12px !important;
            -webkit-overflow-scrolling: touch !important;
          }
          .floor-pills-scroll button {
            padding: 8px 14px !important;
            font-size: 12px !important;
            border-radius: 12px !important;
          }

          /* Filter Toolbar & Search */
          .rooms-filter-toolbar {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            margin-bottom: 16px !important;
          }
          .rooms-search-box {
            max-width: 100% !important;
            width: 100% !important;
            flex: 1 1 100% !important;
          }
          .rooms-search-box input {
            font-size: 16px !important; /* Prevents iOS Safari auto-zoom */
            padding: 12px 14px 12px 42px !important;
          }
          .occupancy-filter-group {
            width: 100% !important;
            display: grid !important;
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 6px !important;
          }
          .occupancy-filter-group button {
            width: 100% !important;
            justify-content: center !important;
            padding: 8px 10px !important;
            font-size: 11.5px !important;
          }

          /* 3D Rooms Matrix Grid (Flatten on touch/mobile for smooth UX) */
          .rooms-matrix-grid {
            perspective: none !important;
            grid-template-columns: 1fr !important;
            gap: 14px !important;
          }
          .room-card-3d {
            transform: none !important;
            padding: 14px !important;
            border-radius: 16px !important;
            box-shadow: 0 4px 14px rgba(0,0,0,0.08) !important;
          }
          .room-card-3d:hover {
            transform: none !important;
          }

          /* Excel Roster View */
          .excel-roster-header-card {
            padding: 16px !important;
            border-radius: 16px !important;
            margin-bottom: 14px !important;
          }
          .excel-roster-header-card h2 {
            font-size: 18px !important;
          }
          .excel-roster-header-card button {
            width: 100% !important;
            justify-content: center !important;
            margin-top: 10px !important;
          }
          .excel-roster-metrics-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 8px !important;
          }
          .roster-toolbar-row {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
          }
          .roster-search-box {
            max-width: 100% !important;
            width: 100% !important;
          }
          .roster-search-box input {
            font-size: 16px !important; /* Prevents iOS Safari auto-zoom */
            padding: 12px 14px 12px 42px !important;
          }
          .roster-toolbar-pills {
            width: 100% !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch !important;
            flex-wrap: nowrap !important;
            padding-bottom: 4px !important;
          }
          .roster-toolbar-pills button {
            white-space: nowrap !important;
            flex-shrink: 0 !important;
          }
          .mobile-table-hint {
            display: block !important;
            padding: 8px 12px !important;
            font-size: 11.5px !important;
            color: #107c41 !important;
            background: rgba(16, 124, 65, 0.09) !important;
            border-bottom: 1px solid rgba(16, 124, 65, 0.2) !important;
            font-weight: 700 !important;
            text-align: center !important;
          }
          .excel-table-scroll-wrapper {
            width: 100% !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch !important;
          }
          .excel-spreadsheet-table {
            min-width: 740px !important;
          }
          .excel-table-footer {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            text-align: center !important;
            padding: 14px 16px !important;
          }
          .excel-table-footer > div:last-child {
            justify-content: center !important;
            flex-wrap: wrap !important;
          }

          /* Modal dialogs on mobile */
          .room-modal-card,
          .modal-compact-card {
            border-radius: 20px !important;
            max-height: 94vh !important;
            width: 100% !important;
            margin: 0 !important;
          }
          .room-modal-header {
            padding: 14px 16px !important;
          }
          .room-modal-body {
            padding: 14px 16px !important;
            gap: 14px !important;
          }
          .room-occupancy-strip {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            padding: 12px 14px !important;
          }
          .room-occupancy-strip button {
            width: 100% !important;
            justify-content: center !important;
          }
          .modal-student-row {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            padding: 12px 14px !important;
          }
          .modal-student-actions {
            width: 100% !important;
            justify-content: flex-end !important;
            padding-top: 6px !important;
            border-top: 1px dashed rgba(255,255,255,0.08) !important;
          }
          .modal-compact-card input,
          .modal-compact-card select {
            font-size: 16px !important;
          }
        }

        /* ── Extra Small Phone Responsiveness (< 420px) ── */
        @media (max-width: 420px) {
          .hostel-switcher-grid {
            grid-template-columns: 1fr 1fr !important;
          }
          .occupancy-filter-group {
            grid-template-columns: 1fr !important;
          }
          .excel-roster-metrics-grid {
            grid-template-columns: 1fr 1fr !important;
          }
          .rooms-stats-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
