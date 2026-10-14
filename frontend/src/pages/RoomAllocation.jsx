/**
 * RoomAllocation Component
 * Enhanced Hostel-Wise, Floor-Wise, and Room-Wise Student Allocation Management Module.
 * Provides hierarchical navigation: Hostel (Step 1) → Floor (Step 2) → Room (Step 3) → Students (Step 4),
 * student multi-filters, checkbox selection, batch actions, room occupancy metrics,
 * detailed resident student rosters, and overall allocation table view.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import Navbar from '../components/Navbar';
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
  MdContentCopy,
  MdArrowForward,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdClear,
  MdLayers,
  MdLocationCity,
  MdArrowDropDown,
  MdArrowBack,
} from 'react-icons/md';

// Available Hostels Configuration
const HOSTEL_OPTIONS = [
  { id: 'BH2', code: 'BH2', name: 'BH-2 (Krishna Hostel)', block: 'BH-2', tag: 'Boys Hostel', gender: 'Male' },
  { id: 'BH1', code: 'BH1', name: 'BH-1 (Boys Hostel 1)', block: 'BH-1', tag: 'Boys Hostel', gender: 'Male' },
  { id: 'GH1', code: 'GH1', name: 'GH-1 (Girls Hostel 1)', block: 'GH-1', tag: 'Girls Hostel', gender: 'Female' },
  { id: 'GH2', code: 'GH2', name: 'GH-2 (Girls Hostel 2)', block: 'GH-2', tag: 'Girls Hostel', gender: 'Female' },
];

export default function RoomAllocation({ embedded = false }) {
  const { theme } = useTheme();

  // ── 1. Hierarchical Selection State ──────────────────────────────────────────
  // Step 1: Selected Hostel
  const [selectedHostel, setSelectedHostel] = useState('BH2');
  // Step 2: Selected Floor ('All' or specific floor name)
  const [selectedFloor, setSelectedFloor] = useState('All');
  // Step 3: Selected Room ('All' or specific roomNumber)
  const [selectedRoomNumber, setSelectedRoomNumber] = useState('All');

  // ── 2. Data & Loading State ──────────────────────────────────────────────────
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingPdf, setSyncingPdf] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // ── 3. Active View Mode Tab ──────────────────────────────────────────────────
  // 'hierarchy-rooms': Room Cards Grid & Selected Room Detail
  // 'overall-students': Master Table of all students on selected hostel/floor
  // 'unassigned-pool': Students without room assignments
  const [activeTab, setActiveTab] = useState('hierarchy-rooms');

  // ── 4. Student & Room Filters ────────────────────────────────────────────────
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [filterYear, setFilterYear] = useState('All'); // 'All', 'FY', 'SY', 'TY', 'Fourth Year'
  const [filterAllocationStatus, setFilterAllocationStatus] = useState('All'); // 'All', 'Allocated', 'Unassigned'
  const [filterRoomStatus, setFilterRoomStatus] = useState('All'); // 'All', 'available', 'partial', 'full'
  const [roomSortBy, setRoomSortBy] = useState('default'); // 'default', 'vacancies_desc', 'occupancy_desc', 'room_asc'
  const [studentSortBy, setStudentSortBy] = useState('name_asc'); // 'name_asc', 'name_desc', 'room_asc', 'roll_asc'

  // ── 5. Student Checkbox Selection State ──────────────────────────────────────
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set());

  // ── 6. Pagination State for Overall Student Table ────────────────────────────
  const [studentPage, setStudentPage] = useState(1);
  const [studentPageSize, setStudentPageSize] = useState(25);

  // ── 7. Modals State ──────────────────────────────────────────────────────────
  const [activeRoomInspectModal, setActiveRoomInspectModal] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [targetRoomForAdd, setTargetRoomForAdd] = useState(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [studentToTransfer, setStudentToTransfer] = useState(null);
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

  // ── 8. Fetch Rooms & Allocation Data ─────────────────────────────────────────
  const fetchRooms = useCallback(
    async (isSilent = false) => {
      try {
        if (!isSilent) setLoading(true);
        else setRefreshing(true);
        setFetchError(null);

        const res = await api.get(`/rooms?hostel=${selectedHostel}`);
        if (res.data?.success) {
          setData(res.data);
          // If a room is currently being inspected in modal, refresh its latest data
          if (activeRoomInspectModal) {
            const updated = res.data.rooms.find((r) => r.roomNumber === activeRoomInspectModal.roomNumber);
            if (updated) setActiveRoomInspectModal(updated);
          }
        } else {
          setFetchError(res.data?.message || 'Failed to load room data');
        }
      } catch (err) {
        const msg = err.response?.data?.message || err.message || 'Failed to fetch room allocations';
        setFetchError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedHostel, activeRoomInspectModal]
  );

  // When hostel changes: fetch rooms, reset floor and room, clear student selection
  useEffect(() => {
    setSelectedFloor('All');
    setSelectedRoomNumber('All');
    setSelectedStudentIds(new Set());
    setStudentPage(1);
    fetchRooms();
  }, [selectedHostel]);

  // When floor changes: reset room to 'All', clear student selection
  const handleFloorChange = (newFloor) => {
    setSelectedFloor(newFloor);
    setSelectedRoomNumber('All');
    setSelectedStudentIds(new Set());
    setStudentPage(1);
  };

  // When room changes: clear student selection
  const handleRoomChange = (newRoom) => {
    setSelectedRoomNumber(newRoom);
    setSelectedStudentIds(new Set());
    setStudentPage(1);
  };

  // ── 9. Dynamic Floor & Room Options for Dropdowns ────────────────────────────
  // Available floors for selected hostel
  const availableFloors = useMemo(() => {
    if (!data?.floors) return ['All', 'Basement', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'];
    return data.floors;
  }, [data?.floors]);

  // Rooms belonging to selected hostel & floor (for Step 3 Room dropdown)
  const availableRoomsOnFloor = useMemo(() => {
    if (!data?.rooms) return [];
    if (selectedFloor === 'All') return data.rooms;
    return data.rooms.filter((r) => r.floor === selectedFloor);
  }, [data?.rooms, selectedFloor]);

  // Active Selected Room Object (if a specific room is selected in Step 3 or clicked)
  const currentSelectedRoomObj = useMemo(() => {
    if (selectedRoomNumber === 'All' || !data?.rooms) return null;
    return data.rooms.find((r) => r.roomNumber === selectedRoomNumber) || null;
  }, [data?.rooms, selectedRoomNumber]);

  // ── 10. Filtered Rooms List for Cards Grid ───────────────────────────────────
  const filteredRooms = useMemo(() => {
    if (!data?.rooms) return [];
    let list = [...data.rooms];

    // Floor filter (Step 2)
    if (selectedFloor !== 'All') {
      list = list.filter((r) => r.floor === selectedFloor);
    }

    // Room filter (Step 3)
    if (selectedRoomNumber !== 'All') {
      list = list.filter((r) => r.roomNumber === selectedRoomNumber);
    }

    // Room status filter
    if (filterRoomStatus === 'available') {
      list = list.filter((r) => r.vacancies > 0);
    } else if (filterRoomStatus === 'partial') {
      list = list.filter((r) => r.occupancy > 0 && r.occupancy < r.capacity);
    } else if (filterRoomStatus === 'full') {
      list = list.filter((r) => r.occupancy >= r.capacity);
    }

    // Student Search / Room Search
    if (studentSearchTerm.trim()) {
      const q = studentSearchTerm.trim().toLowerCase();
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

    // Year filter (FY, SY, TY, Fourth Year)
    if (filterYear !== 'All') {
      list = list.filter((r) =>
        r.students?.some((s) => {
          const y = String(s.year || '').toLowerCase();
          if (filterYear === 'FY') return y.includes('1st') || y.includes('fy') || y.includes('first');
          if (filterYear === 'SY') return y.includes('2nd') || y.includes('sy') || y.includes('second');
          if (filterYear === 'TY') return y.includes('3rd') || y.includes('ty') || y.includes('third');
          if (filterYear === 'Fourth Year') return y.includes('4th') || y.includes('fourth') || y.includes('final');
          return y.includes(filterYear.toLowerCase());
        })
      );
    }

    // Sorting
    if (roomSortBy === 'vacancies_desc') {
      list.sort((a, b) => b.vacancies - a.vacancies);
    } else if (roomSortBy === 'occupancy_desc') {
      list.sort((a, b) => b.occupancy - a.occupancy);
    } else if (roomSortBy === 'room_asc') {
      list.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
    }

    return list;
  }, [data?.rooms, selectedFloor, selectedRoomNumber, filterRoomStatus, studentSearchTerm, filterYear, roomSortBy]);

  // ── 11. Master Student List & Multi-Filtering ────────────────────────────────
  // Collect all students for the selected hostel, floor, and room scope
  const scopedStudentsList = useMemo(() => {
    if (!data?.rooms) return [];

    let scopedRooms = data.rooms;
    if (selectedFloor !== 'All') {
      scopedRooms = scopedRooms.filter((r) => r.floor === selectedFloor);
    }
    if (selectedRoomNumber !== 'All') {
      scopedRooms = scopedRooms.filter((r) => r.roomNumber === selectedRoomNumber);
    }

    const roomStudents = scopedRooms.flatMap((r) =>
      (r.students || []).map((s) => ({
        ...s,
        roomNumber: r.roomNumber,
        floor: r.floor,
        hostel: selectedHostel,
        hostelName: currentHostelInfo.name,
        isUnassigned: false,
      }))
    );

    // If viewing all rooms on hostel or 'All' floor, include unassigned students
    const unassigned =
      selectedRoomNumber === 'All' && (selectedFloor === 'All' || filterAllocationStatus === 'Unassigned')
        ? (data.unassigned || []).map((u) => ({
            ...u,
            roomNumber: 'Unassigned',
            floor: 'Unassigned',
            bedIndex: '-',
            hostel: selectedHostel,
            hostelName: currentHostelInfo.name,
            isUnassigned: true,
          }))
        : [];

    return [...roomStudents, ...unassigned];
  }, [data?.rooms, data?.unassigned, selectedFloor, selectedRoomNumber, selectedHostel, currentHostelInfo]);

  // Apply dedicated student filters (Name, MIS, Department, Course, Year, Status)
  const filteredStudents = useMemo(() => {
    let list = [...scopedStudentsList];

    // Search query (Name or MIS / Enrollment number or Email)
    if (studentSearchTerm.trim()) {
      const q = studentSearchTerm.trim().toLowerCase();
      list = list.filter(
        (s) =>
          (s.name && s.name.toLowerCase().includes(q)) ||
          (s.rollNo && s.rollNo.toLowerCase().includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q)) ||
          (s.roomNumber && s.roomNumber.toLowerCase().includes(q))
      );
    }

    // Department filter
    // Year / Semester filter (FY, SY, TY, Fourth Year)
    if (filterYear !== 'All') {
      list = list.filter((s) => {
        const y = String(s.year || '').toLowerCase();
        if (filterYear === 'FY') return y.includes('1st') || y.includes('fy') || y.includes('first');
        if (filterYear === 'SY') return y.includes('2nd') || y.includes('sy') || y.includes('second');
        if (filterYear === 'TY') return y.includes('3rd') || y.includes('ty') || y.includes('third');
        if (filterYear === 'Fourth Year') return y.includes('4th') || y.includes('fourth') || y.includes('final');
        return y.includes(filterYear.toLowerCase());
      });
    }

    // Allocation status filter
    if (filterAllocationStatus === 'Allocated') {
      list = list.filter((s) => !s.isUnassigned && s.roomNumber !== 'Unassigned');
    } else if (filterAllocationStatus === 'Unassigned') {
      list = list.filter((s) => s.isUnassigned || s.roomNumber === 'Unassigned');
    }

    // Sorting
    list.sort((a, b) => {
      if (studentSortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
      if (studentSortBy === 'name_desc') return (b.name || '').localeCompare(a.name || '');
      if (studentSortBy === 'room_asc') return (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true });
      if (studentSortBy === 'roll_asc') return (a.rollNo || '').localeCompare(b.rollNo || '');
      return 0;
    });

    return list;
  }, [scopedStudentsList, studentSearchTerm, filterYear, filterAllocationStatus, studentSortBy]);

  // Paginated Students for Overall Table
  const paginatedStudents = useMemo(() => {
    if (studentPageSize === 'All') return filteredStudents;
    const size = Number(studentPageSize) || 25;
    const start = (studentPage - 1) * size;
    return filteredStudents.slice(start, start + size);
  }, [filteredStudents, studentPage, studentPageSize]);

  const totalStudentPages = useMemo(() => {
    if (studentPageSize === 'All') return 1;
    const size = Number(studentPageSize) || 25;
    return Math.max(1, Math.ceil(filteredStudents.length / size));
  }, [filteredStudents.length, studentPageSize]);

  // ── 12. Checkbox Selection Logic ─────────────────────────────────────────────
  // Select / Deselect individual student
  const handleToggleStudentSelection = (studentId) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  // Select all currently filtered students (guarantees NO student outside filter is selected)
  const handleSelectAllFiltered = () => {
    const allFilteredIds = filteredStudents.map((s) => s._id);
    setSelectedStudentIds(new Set(allFilteredIds));
    toast.success(`Selected all ${allFilteredIds.length} filtered students`);
  };

  // Clear all selections
  const handleClearSelection = () => {
    setSelectedStudentIds(new Set());
  };

  const isAllFilteredSelected =
    filteredStudents.length > 0 && filteredStudents.every((s) => selectedStudentIds.has(s._id));

  // ── 13. Dynamic Statistics Calculation ───────────────────────────────────────
  // Scoped to selected hostel and selected floor!
  const scopedStats = useMemo(() => {
    if (!data?.rooms) {
      return {
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
    }

    let roomsInScope = data.rooms;
    if (selectedFloor !== 'All') {
      roomsInScope = roomsInScope.filter((r) => r.floor === selectedFloor);
    }
    if (selectedRoomNumber !== 'All') {
      roomsInScope = roomsInScope.filter((r) => r.roomNumber === selectedRoomNumber);
    }

    let cap = 0;
    let occ = 0;
    let full = 0;
    let partial = 0;
    let empty = 0;
    let avail = 0;

    roomsInScope.forEach((r) => {
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

    const unassignedCount = selectedRoomNumber === 'All' ? (data.unassigned?.length || 0) : 0;
    const occupancyRate = cap > 0 ? Math.round((occ / cap) * 100) : 0;

    return {
      totalRooms: roomsInScope.length,
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
  }, [data?.rooms, data?.unassigned, selectedFloor, selectedRoomNumber]);

  // Candidate Rooms with Vacancies for Transfer Target Selection
  const roomsWithVacancies = useMemo(() => {
    if (!data?.rooms) return [];
    return data.rooms.filter((r) => r.vacancies > 0);
  }, [data?.rooms]);

  // Clear all filters helper
  const handleClearAllFilters = () => {
    setStudentSearchTerm('');
    setFilterYear('All');
    setFilterAllocationStatus('All');
    setFilterRoomStatus('All');
    setStudentPage(1);
    toast('All filters cleared', { icon: '🧹' });
  };

  // ── 14. Action Handlers: Allocate, Transfer, Remove ─────────────────────────
  // Remove Student from Room
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

  // Add / Allocate Student Submit
  const handleAddStudentSubmit = async (e) => {
    e.preventDefault();
    const targetRoom = targetRoomForAdd || currentSelectedRoomObj || activeRoomInspectModal;
    if (!targetRoom) {
      toast.error('Please select a target room first');
      return;
    }

    if (targetRoom.occupancy >= targetRoom.capacity) {
      toast.error(`Room ${targetRoom.roomNumber} is already full (${targetRoom.capacity}/${targetRoom.capacity} beds occupied)!`);
      return;
    }

    setAddLoading(true);
    try {
      let payload = { hostel: selectedHostel };

      if (addFormMode === 'unassigned') {
        if (!selectedUnassignedId) {
          toast.error('Please select an unassigned student');
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

  // Transfer Student Submit
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

  // Create New Room Submit
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

  // Update Room Capacity Submit
  const handleUpdateCapacitySubmit = async (e) => {
    e.preventDefault();
    const targetRoom = currentSelectedRoomObj || activeRoomInspectModal;
    if (!targetRoom) return;

    setCapacityLoading(true);
    try {
      const res = await api.put(`/rooms/${encodeURIComponent(targetRoom.roomNumber)}/capacity`, {
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

  // Sync Official PDF Roster for BH-2
  const handleSyncPdf = async () => {
    if (selectedHostel !== 'BH2') {
      toast.error('Official PDF roster is strictly for BH-2 (Krishna Hostel).');
      return;
    }
    if (
      !window.confirm(
        'Sync all 394 students from the official BH-2 PDF allotment sheet?\n\nThis will re-verify room allocations across all 104 BH-2 rooms according to the university allotment sheet.'
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

  // Export Filtered / Selected Students to Excel
  const handleExportExcel = (exportOnlySelected = false) => {
    const listToExport = exportOnlySelected
      ? filteredStudents.filter((s) => selectedStudentIds.has(s._id))
      : filteredStudents;

    if (listToExport.length === 0) {
      toast.error(exportOnlySelected ? 'No students currently selected' : 'No student records match the filters');
      return;
    }

    const rows = listToExport.map((s, idx) => ({
      'S.No': idx + 1,
      'Student Name': s.name,
      'Student ID / MIS': s.rollNo || '-',
      'Hostel': currentHostelInfo.name,
      'Floor': s.floor || '-',
      'Room Number': s.roomNumber || 'Unassigned',
      'Bed Slot': s.bedIndex || '-',
      'Department': s.department || 'CSE',
      'Course': s.course || 'B.Tech',
      'Year / Semester': s.year || 'B.Tech',
      'Gender': s.gender || currentHostelInfo.gender,
      'Allocation Status': s.isUnassigned ? 'Unassigned' : 'Allocated',
      'Email': s.email || '-',
      'Phone': s.phone || '-',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Room Allocations');

    worksheet['!cols'] = [
      { wch: 6 },  // S.No
      { wch: 26 }, // Name
      { wch: 18 }, // MIS
      { wch: 22 }, // Hostel
      { wch: 16 }, // Floor
      { wch: 14 }, // Room
      { wch: 10 }, // Bed
      { wch: 32 }, // Dept
      { wch: 12 }, // Course
      { wch: 16 }, // Year
      { wch: 10 }, // Gender
      { wch: 18 }, // Status
      { wch: 28 }, // Email
      { wch: 16 }, // Phone
    ];

    const scopeName = selectedRoomNumber !== 'All' ? `Room_${selectedRoomNumber}` : selectedFloor !== 'All' ? selectedFloor.replace(/\s+/g, '_') : selectedHostel;
    const fileName = `${selectedHostel}_${scopeName}_Allocations_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    toast.success(`Exported ${rows.length} allocation records to ${fileName}!`);
  };

  // Copy selected student roll numbers / MIS
  const handleCopySelectedRollNos = () => {
    const selected = filteredStudents.filter((s) => selectedStudentIds.has(s._id) && s.rollNo);
    if (selected.length === 0) {
      toast.error('No students with roll numbers selected');
      return;
    }
    const rollsText = selected.map((s) => s.rollNo).join(', ');
    navigator.clipboard.writeText(rollsText);
    toast.success(`Copied ${selected.length} roll numbers to clipboard!`);
  };

  const pageContent = (
    <div
      className={`room-allocation-page ${embedded ? 'embedded' : ''}`}
      style={{
        padding: embedded ? '0' : '0 0 60px 0',
        maxWidth: 1650,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        width: '100%',
        minHeight: 'auto',
      }}
    >
      {/* ──────────────────────────────────────────────────────────────────────────
          SECTION 1: PAGE TITLE & HIERARCHICAL SELECTION BAR
          Hostel (Step 1) → Floor (Step 2) → Room (Step 3)
      ────────────────────────────────────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '20px 24px',
          background: 'var(--bg-card)',
          borderRadius: 20,
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          overflow: 'visible',
          flexShrink: 0,
        }}
      >
        {/* Title & Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
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
              <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                Room Allocation
              </h1>
              <p style={{ fontSize: 13, margin: '2px 0 0', color: 'var(--text-secondary)' }}>
                Hostel-Wise → Floor-Wise → Room-Wise Student Allocation Management
              </p>
            </div>
          </div>

          {/* Right Header Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleExportExcel(false)}
              disabled={loading || filteredStudents.length === 0}
              title={
                filteredStudents.length === 0
                  ? 'No student records match current filters to export'
                  : `Export ${filteredStudents.length} student allocation records to Excel (.xlsx)`
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                fontWeight: 700,
                fontSize: 12.5,
                padding: '7px 15px',
                borderRadius: 99,
                background:
                  filteredStudents.length > 0 && !loading
                    ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
                    : 'var(--bg-input, rgba(255,255,255,0.06))',
                color: filteredStudents.length > 0 && !loading ? '#ffffff' : 'var(--text-muted)',
                border:
                  filteredStudents.length > 0 && !loading
                    ? '1px solid rgba(16, 185, 129, 0.45)'
                    : '1px solid var(--border-color, rgba(255,255,255,0.1))',
                boxShadow:
                  filteredStudents.length > 0 && !loading
                    ? '0 3px 12px rgba(16, 185, 129, 0.35)'
                    : 'none',
                cursor: filteredStudents.length > 0 && !loading ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
              }}
            >
              <MdDownload
                size={17}
                style={{
                  color: filteredStudents.length > 0 && !loading ? '#ffffff' : 'var(--text-muted)',
                }}
              />
              <span>Export Excel (.xlsx)</span>
              {filteredStudents.length > 0 && !loading && (
                <span
                  style={{
                    background: 'rgba(255, 255, 255, 0.25)',
                    color: '#ffffff',
                    padding: '1px 7px',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 800,
                    marginLeft: 2,
                  }}
                >
                  {filteredStudents.length}
                </span>
              )}
            </button>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setShowCreateRoomModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}
            >
              <MdAdd size={18} />
              <span>Add Room</span>
            </button>

            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => fetchRooms(true)}
              disabled={refreshing || loading}
              title="Refresh database records"
              style={{ padding: '8px 12px' }}
            >
              <MdRefresh size={18} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>
        </div>

        {/* ── Hierarchical Selection Interface (Step 1, Step 2, Step 3) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 14,
            padding: '16px 18px',
            borderRadius: 16,
            background: 'var(--bg-input, rgba(255,255,255,0.03))',
            border: '1.5px solid var(--border-color)',
          }}
        >
          {/* Step 1: Select Hostel */}
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6366f1', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span>🏢</span> Step 1: Select Hostel
            </label>
            <select
              className="form-select"
              value={selectedHostel}
              onChange={(e) => setSelectedHostel(e.target.value)}
              style={{
                width: '100%',
                height: 42,
                borderRadius: 12,
                fontSize: 13.5,
                fontWeight: 700,
                border: '1.5px solid rgba(99, 102, 241, 0.4)',
              }}
            >
              {HOSTEL_OPTIONS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} — {h.tag}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Select Floor */}
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#06b6d4', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span>🪜</span> Step 2: Select Floor
            </label>
            <select
              className="form-select"
              value={selectedFloor}
              onChange={(e) => handleFloorChange(e.target.value)}
              style={{
                width: '100%',
                height: 42,
                borderRadius: 12,
                fontSize: 13.5,
                fontWeight: 700,
                border: selectedFloor !== 'All' ? '1.5px solid #06b6d4' : '1px solid var(--border-color)',
              }}
            >
              <option value="All">All Floors ({availableFloors.filter((f) => f !== 'All').length} Floors)</option>
              {availableFloors
                .filter((f) => f !== 'All')
                .map((fl) => (
                  <option key={fl} value={fl}>
                    {fl}
                  </option>
                ))}
            </select>
          </div>

          {/* Step 3: Select Room */}
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#10b981', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span>🚪</span> Step 3: Select Room
            </label>
            <select
              className="form-select"
              value={selectedRoomNumber}
              onChange={(e) => handleRoomChange(e.target.value)}
              style={{
                width: '100%',
                height: 42,
                borderRadius: 12,
                fontSize: 13.5,
                fontWeight: 700,
                border: selectedRoomNumber !== 'All' ? '1.5px solid #10b981' : '1px solid var(--border-color)',
              }}
            >
              <option value="All">
                All Rooms on {selectedFloor === 'All' ? 'Hostel' : selectedFloor} ({availableRoomsOnFloor.length} Rooms)
              </option>
              {availableRoomsOnFloor.map((rm) => (
                <option key={rm.roomNumber} value={rm.roomNumber}>
                  Room {rm.roomNumber} ({rm.floor}) — {rm.occupancy}/{rm.capacity} Beds ({rm.vacancies} Vacant)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Active Selection Breadcrumbs & Scope Indicator ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            paddingTop: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontWeight: 600 }}>
            <span>Active Selection:</span>
            <span style={{ color: '#4f46e5', fontWeight: 800 }}>{currentHostelInfo.name}</span>
            <span>›</span>
            <span style={{ color: selectedFloor !== 'All' ? '#06b6d4' : 'var(--text-primary)', fontWeight: 700 }}>
              {selectedFloor === 'All' ? 'All Floors' : selectedFloor}
            </span>
            <span>›</span>
            <span style={{ color: selectedRoomNumber !== 'All' ? '#10b981' : 'var(--text-primary)', fontWeight: 700 }}>
              {selectedRoomNumber === 'All' ? `All Rooms (${availableRoomsOnFloor.length})` : `Room ${selectedRoomNumber}`}
            </span>
          </div>

          {(selectedFloor !== 'All' || selectedRoomNumber !== 'All') && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setSelectedFloor('All');
                setSelectedRoomNumber('All');
              }}
              style={{ padding: '4px 10px', fontSize: 11.5, color: 'var(--text-muted)' }}
            >
              Reset to All Floors &amp; Rooms
            </button>
          )}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          SECTION 2: SUMMARY METRIC CARDS (DYNAMICALLY UPDATED PER SELECTION)
      ────────────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 12,
        }}
      >
        {/* Total Rooms in Scope */}
        <div className="card" style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🏢</span> Total Rooms
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', marginTop: 4 }}>
            {scopedStats.totalRooms}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Capacity: {scopedStats.totalCapacity} Beds
          </div>
        </div>

        {/* Allocated Students */}
        <div className="card" style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>👥</span> Allocated Students
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#6366f1', marginTop: 4 }}>
            {scopedStats.totalOccupied}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Occupancy: {scopedStats.occupancyRate}%
          </div>
        </div>

        {/* Vacant Beds */}
        <div className="card" style={{ padding: '14px 16px', borderRadius: 16, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
          <div style={{ fontSize: 11.5, color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🛏️</span> Vacant Beds
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#10b981', marginTop: 4 }}>
            {scopedStats.totalVacancies}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Ready for allocation
          </div>
        </div>

        {/* Available Rooms */}
        <div className="card" style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#10b981' }}>🟢</span> Available Rooms
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#10b981', marginTop: 4 }}>
            {scopedStats.availableRooms}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Rooms with free beds
          </div>
        </div>

        {/* Partially Occupied */}
        <div className="card" style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#f59e0b' }}>🟠</span> Partially Occupied
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#f59e0b', marginTop: 4 }}>
            {scopedStats.partialRooms}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            1 to 3 students assigned
          </div>
        </div>

        {/* Fully Occupied */}
        <div className="card" style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#ef4444' }}>🔴</span> Full Rooms
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#ef4444', marginTop: 4 }}>
            {scopedStats.fullRooms}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            All 4 beds filled
          </div>
        </div>

        {/* Unassigned Students Pool */}
        <div
          className="card"
          onClick={() => setActiveTab('unassigned-pool')}
          style={{
            padding: '14px 16px',
            borderRadius: 16,
            background: scopedStats.unassignedCount > 0 ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-card)',
            border: scopedStats.unassignedCount > 0 ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid var(--glass-border)',
            cursor: 'pointer',
          }}
          title="Click to view unassigned students"
        >
          <div style={{ fontSize: 11.5, color: scopedStats.unassignedCount > 0 ? '#ef4444' : 'var(--text-secondary)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>📋 Unassigned Pool</span>
            <MdArrowForward size={14} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: scopedStats.unassignedCount > 0 ? '#ef4444' : 'var(--text-primary)', marginTop: 4 }}>
            {scopedStats.unassignedCount}
          </div>
          <div style={{ fontSize: 11, color: scopedStats.unassignedCount > 0 ? '#ef4444' : 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>
            {scopedStats.unassignedCount > 0 ? 'Needs allocation' : 'All Allocated'}
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          SECTION 3: VIEW TABS & MULTI-FILTER CONTROLS
      ────────────────────────────────────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '18px 20px',
          background: 'var(--bg-card)',
          borderRadius: 18,
          border: '1px solid var(--glass-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflow: 'visible',
          flexShrink: 0,
        }}
      >
        {/* Top: View Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            paddingBottom: 14,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('hierarchy-rooms')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 10,
                border: 'none',
                background: activeTab === 'hierarchy-rooms' ? '#4f46e5' : 'var(--bg-input, rgba(255,255,255,0.05))',
                color: activeTab === 'hierarchy-rooms' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <MdViewModule size={17} />
              <span>Room Cards &amp; Details</span>
              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 99, background: 'rgba(255,255,255,0.2)' }}>
                {filteredRooms.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('overall-students')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 10,
                border: 'none',
                background: activeTab === 'overall-students' ? '#4f46e5' : 'var(--bg-input, rgba(255,255,255,0.05))',
                color: activeTab === 'overall-students' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <MdViewList size={17} />
              <span>Overall Student Allocation Table</span>
              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 99, background: 'rgba(255,255,255,0.2)' }}>
                {filteredStudents.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('unassigned-pool')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 10,
                border: 'none',
                background: activeTab === 'unassigned-pool' ? '#4f46e5' : 'var(--bg-input, rgba(255,255,255,0.05))',
                color: activeTab === 'unassigned-pool' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <MdPeople size={17} />
              <span>Unassigned Pool</span>
              <span
                style={{
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 99,
                  background: scopedStats.unassignedCount > 0 ? '#ef4444' : 'rgba(255,255,255,0.2)',
                  color: '#ffffff',
                }}
              >
                {scopedStats.unassignedCount}
              </span>
            </button>
          </div>

          {/* Student Filter Match Counter & Clear Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
              Showing <strong>{filteredStudents.length}</strong> students across <strong>{filteredRooms.length}</strong> rooms
            </span>

            {(studentSearchTerm || filterYear !== 'All' || filterAllocationStatus !== 'All' || filterRoomStatus !== 'All') && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={handleClearAllFilters}
                style={{ fontSize: 12, padding: '4px 10px', color: '#ef4444' }}
              >
                Clear All Filters
              </button>
            )}
          </div>
        </div>

        {/* Quick Academic Year Pills (FY / SY / TY / Fourth Year) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', marginRight: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>🎓</span> Academic Year:
          </span>
          {[
            { id: 'All', label: 'All Years' },
            { id: 'FY', label: 'FY' },
            { id: 'SY', label: 'SY' },
            { id: 'TY', label: 'TY' },
            { id: 'Fourth Year', label: 'Fourth Year' },
          ].map((pill) => {
            const active = filterYear === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => {
                  setFilterYear(pill.id);
                  setStudentPage(1);
                }}
                style={{
                  padding: '5px 14px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 800,
                  border: active ? '1.5px solid #6366f1' : '1px solid var(--border-color)',
                  background: active ? 'rgba(99, 102, 241, 0.16)' : 'var(--bg-card, #fff)',
                  color: active ? '#6366f1' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: active ? '0 2px 8px rgba(99, 102, 241, 0.2)' : 'none',
                }}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        {/* Multi-Filter Controls Row (Search, Year, Status, Sort) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 12,
            alignItems: 'center',
          }}
        >
          {/* Search Box */}
          <div style={{ position: 'relative', gridColumn: 'span 2' }}>
            <MdSearch size={18} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-input"
              value={studentSearchTerm}
              onChange={(e) => {
                setStudentSearchTerm(e.target.value);
                setStudentPage(1);
              }}
              placeholder="Search by student name, roll no / MIS, or room..."
              style={{ paddingLeft: 38, height: 40, borderRadius: 10, fontSize: 12.5 }}
            />
            {studentSearchTerm && (
              <button
                type="button"
                onClick={() => setStudentSearchTerm('')}
                style={{ position: 'absolute', right: 10, top: 10, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <MdClose size={16} />
              </button>
            )}
          </div>

          {/* Filter: Year (FY, SY, TY, Fourth Year) */}
          <div>
            <select
              className="form-select"
              value={filterYear}
              onChange={(e) => {
                setFilterYear(e.target.value);
                setStudentPage(1);
              }}
              style={{
                width: '100%',
                height: 40,
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 700,
                border: filterYear !== 'All' ? '1.5px solid #6366f1' : '1px solid var(--border-color)',
              }}
            >
              <option value="All">All Academic Years</option>
              <option value="FY">FY (First Year)</option>
              <option value="SY">SY (Second Year)</option>
              <option value="TY">TY (Third Year)</option>
              <option value="Fourth Year">Fourth Year</option>
            </select>
          </div>

          {/* Filter: Allocation Status */}
          <div>
            <select
              className="form-select"
              value={filterAllocationStatus}
              onChange={(e) => {
                setFilterAllocationStatus(e.target.value);
                setStudentPage(1);
              }}
              style={{ width: '100%', height: 40, borderRadius: 10, fontSize: 12 }}
            >
              <option value="All">All Allocation Status</option>
              <option value="Allocated">Allocated to Room</option>
              <option value="Unassigned">Unassigned Pool</option>
            </select>
          </div>

          {/* Filter: Room Occupancy Status */}
          <div>
            <select
              className="form-select"
              value={filterRoomStatus}
              onChange={(e) => setFilterRoomStatus(e.target.value)}
              style={{ width: '100%', height: 40, borderRadius: 10, fontSize: 12 }}
            >
              <option value="All">All Room Statuses</option>
              <option value="available">Available (Has Vacancy)</option>
              <option value="partial">Partially Occupied</option>
              <option value="full">Full (4/4 Occupied)</option>
            </select>
          </div>

          {/* Sort By Filter */}
          <div>
            <select
              className="form-select"
              value={activeTab === 'hierarchy-rooms' ? roomSortBy : studentSortBy}
              onChange={(e) => {
                if (activeTab === 'hierarchy-rooms') {
                  setRoomSortBy(e.target.value);
                } else {
                  setStudentSortBy(e.target.value);
                }
              }}
              style={{ width: '100%', height: 40, borderRadius: 10, fontSize: 12 }}
            >
              {activeTab === 'hierarchy-rooms' ? (
                <>
                  <option value="default">Sort: Default Order</option>
                  <option value="vacancies_desc">Sort: Vacancies (High to Low)</option>
                  <option value="occupancy_desc">Sort: Occupancy (High to Low)</option>
                  <option value="room_asc">Sort: Room Number (Ascending)</option>
                </>
              ) : (
                <>
                  <option value="name_asc">Sort: Student Name (A → Z)</option>
                  <option value="name_desc">Sort: Student Name (Z → A)</option>
                  <option value="room_asc">Sort: Room Number</option>
                  <option value="roll_asc">Sort: Roll / MIS No</option>
                </>
              )}
            </select>
          </div>
        </div>

        {/* ── Selection Action Bar (Appears when students are checked) ── */}
        {selectedStudentIds.size > 0 && (
          <div
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.12) 0%, rgba(6, 182, 212, 0.12) 100%)',
              border: '1.5px solid #4f46e5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>🎯</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#4f46e5' }}>
                {selectedStudentIds.size} student{selectedStudentIds.size === 1 ? '' : 's'} selected
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                ({Math.round((selectedStudentIds.size / filteredStudents.length) * 100)}% of filtered results)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={handleCopySelectedRollNos}
                style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <MdContentCopy size={14} />
                <span>Copy Roll Numbers</span>
              </button>

              <button
                type="button"
                className="btn btn-sm"
                onClick={() => handleExportExcel(true)}
                style={{
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 700,
                  padding: '6px 13px',
                  borderRadius: 99,
                  background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                  color: '#ffffff',
                  border: '1px solid rgba(16, 185, 129, 0.45)',
                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.35)',
                }}
              >
                <MdDownload size={15} />
                <span>Export Selected (.xlsx)</span>
                <span
                  style={{
                    background: 'rgba(255, 255, 255, 0.25)',
                    color: '#ffffff',
                    padding: '1px 6px',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  {selectedStudentIds.size}
                </span>
              </button>

              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={handleClearSelection}
                style={{ fontSize: 12, color: '#ef4444' }}
              >
                Clear Selection
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          SECTION 4: ACTIVE TAB CONTENT
      ────────────────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="card" style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div
            style={{
              width: 44,
              height: 44,
              margin: '0 auto 16px',
              borderRadius: '50%',
              border: '4px solid rgba(99, 102, 241, 0.2)',
              borderTopColor: '#6366f1',
              animation: 'spin 1s linear infinite',
            }}
          />
          <div style={{ fontSize: 16, fontWeight: 800 }}>Loading Allocations...</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Fetching physical room records and student rosters for {currentHostelInfo.name}
          </div>
        </div>
      ) : fetchError && !data ? (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)', borderRadius: 20 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
            Unable to Load Room Allocations
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 460, margin: '8px auto 20px' }}>
            {fetchError}. The server might be waking up or warming up. Please try again.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fetchRooms(false)}
            style={{ fontWeight: 700, padding: '10px 24px' }}
          >
            Retry Connection
          </button>
        </div>
      ) : activeTab === 'hierarchy-rooms' ? (
        /* ════════════════════════════════════════════════════════════════════════
           TAB 1: ROOM HIERARCHY CARDS GRID & SELECTED ROOM DETAIL
        ════════════════════════════════════════════════════════════════════════ */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* If a single room is explicitly selected in Step 3, show its full dedicated section */}
          {currentSelectedRoomObj && (
            <div
              className="card"
              style={{
                padding: '22px 26px',
                borderRadius: 20,
                background: 'var(--bg-card)',
                border: '2px solid #4f46e5',
                boxShadow: '0 8px 30px rgba(79, 70, 229, 0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              {/* Selected Room Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#4f46e5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                    }}
                  >
                    <MdMeetingRoom />
                  </div>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                      Room {currentSelectedRoomObj.roomNumber} Details
                    </h2>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>
                      {currentSelectedRoomObj.floor} · {currentHostelInfo.name}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setSelectedRoomNumber('All')}
                    style={{ fontSize: 12 }}
                  >
                    Show All Rooms on Floor
                  </button>

                  {currentSelectedRoomObj.vacancies > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        setTargetRoomForAdd(currentSelectedRoomObj);
                        setShowAddModal(true);
                      }}
                      style={{ background: '#10b981', border: 'none', fontWeight: 800, fontSize: 12 }}
                    >
                      + Assign Student
                    </button>
                  )}
                </div>
              </div>

              {/* Room Stats Pill Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 10,
                  padding: '12px 16px',
                  borderRadius: 14,
                  background: 'var(--bg-input, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border-color)',
                  textAlign: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>CAPACITY</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>
                    {currentSelectedRoomObj.capacity} Beds
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>OCCUPIED</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#6366f1', marginTop: 2 }}>
                    {currentSelectedRoomObj.occupancy} Students
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>AVAILABLE BEDS</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: currentSelectedRoomObj.vacancies > 0 ? '#10b981' : '#ef4444', marginTop: 2 }}>
                    {currentSelectedRoomObj.vacancies} Vacant
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>STATUS</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: currentSelectedRoomObj.occupancy >= currentSelectedRoomObj.capacity ? '#ef4444' : currentSelectedRoomObj.occupancy > 0 ? '#f59e0b' : '#10b981', marginTop: 5 }}>
                    {currentSelectedRoomObj.occupancy >= currentSelectedRoomObj.capacity ? 'Full' : currentSelectedRoomObj.occupancy > 0 ? 'Partially Occupied' : 'Available'}
                  </div>
                </div>
              </div>

              {/* Resident Students in this room */}
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px', color: 'var(--text-primary)' }}>
                  Students Allocated to Room {currentSelectedRoomObj.roomNumber} ({currentSelectedRoomObj.occupancy}/{currentSelectedRoomObj.capacity})
                </h3>

                {currentSelectedRoomObj.students && currentSelectedRoomObj.students.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                    {currentSelectedRoomObj.students.map((student, idx) => (
                      <div
                        key={student._id}
                        style={{
                          padding: 14,
                          borderRadius: 14,
                          background: 'var(--bg-input, rgba(255,255,255,0.03))',
                          border: '1px solid var(--border-color)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: 14,
                              }}
                            >
                              {student.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>
                                {student.name}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                                MIS: <strong>{student.rollNo || 'Not Assigned'}</strong>
                              </div>
                            </div>
                          </div>

                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1', fontWeight: 800 }}>
                            Bed {student.bedIndex || idx + 1}
                          </span>
                        </div>

                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div><strong>Dept:</strong> {student.department || 'CSE'}</div>
                          <div><strong>Year / Course:</strong> {student.year || 'B.Tech'} · {student.course || 'B.Tech'}</div>
                          {student.email && <div><strong>Email:</strong> {student.email}</div>}
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              setStudentToTransfer(student);
                              setShowTransferModal(true);
                            }}
                            style={{ flex: 1, fontSize: 11.5, padding: '5px 8px' }}
                          >
                            <MdSwapHoriz size={14} /> Move
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => handleRemoveStudent(currentSelectedRoomObj.roomNumber, student)}
                            style={{ flex: 1, fontSize: 11.5, padding: '5px 8px', color: '#ef4444' }}
                          >
                            <MdDeleteOutline size={14} /> Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-input)', borderRadius: 12 }}>
                    This room currently has no students allocated (All {currentSelectedRoomObj.capacity} beds are vacant).
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Room Cards Grid */}
          {filteredRooms.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
                gap: 16,
              }}
            >
              {filteredRooms.map((room) => {
                const isFull = room.occupancy >= room.capacity;
                const isPartial = room.occupancy > 0 && room.occupancy < room.capacity;
                const isAvailable = room.vacancies > 0;

                const statusColor = isFull ? '#ef4444' : isPartial ? '#f59e0b' : '#10b981';
                const statusBg = isFull ? 'rgba(239, 68, 68, 0.12)' : isPartial ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)';
                const statusBorder = isFull ? 'rgba(239, 68, 68, 0.35)' : isPartial ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)';
                const statusLabel = isFull ? 'Full' : isPartial ? 'Partially Occupied' : 'Available';

                const percentage = Math.min(100, Math.round((room.occupancy / room.capacity) * 100));
                const isSelected = selectedRoomNumber === room.roomNumber;

                return (
                  <div
                    key={room.roomNumber}
                    className="room-card"
                    onClick={() => {
                      setSelectedRoomNumber(room.roomNumber);
                      setActiveRoomInspectModal(room);
                    }}
                    style={{
                      background: 'var(--bg-card)',
                      borderRadius: 18,
                      border: isSelected ? '2px solid #4f46e5' : `1.5px solid ${statusBorder}`,
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      cursor: 'pointer',
                      transition: 'all 0.18s ease',
                      boxShadow: isSelected ? '0 8px 24px rgba(79, 70, 229, 0.2)' : '0 4px 14px rgba(0,0,0,0.06)',
                    }}
                  >
                    {/* Card Header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 17 }}>🚪</span>
                          <h3 style={{ fontSize: 17, fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                            Room {room.roomNumber}
                          </h3>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>
                          {room.floor} · {currentHostelInfo.code}
                        </div>
                      </div>

                      <span
                        style={{
                          background: statusBg,
                          color: statusColor,
                          border: `1px solid ${statusBorder}`,
                          padding: '3px 9px',
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
                        <span>{statusLabel}</span>
                      </span>
                    </div>

                    {/* Occupancy Bar */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, marginBottom: 5, color: 'var(--text-secondary)' }}>
                        <span>
                          Occupied: <strong style={{ color: 'var(--text-primary)' }}>{room.occupancy}</strong> / {room.capacity} ({percentage}%)
                        </span>
                        <span style={{ color: isAvailable ? '#10b981' : 'var(--text-muted)' }}>
                          Vacant: <strong>{room.vacancies}</strong>
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-input, rgba(255,255,255,0.08))', overflow: 'hidden' }}>
                        <div style={{ width: `${percentage}%`, height: '100%', background: statusColor, borderRadius: 99, transition: 'width 0.3s ease' }} />
                      </div>
                    </div>

                    {/* Bed Chips Preview */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 5,
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'var(--bg-input, rgba(255,255,255,0.03))',
                        border: '1px solid var(--border-color, rgba(255,255,255,0.06))',
                      }}
                    >
                      {room.beds?.map((b) => {
                        if (b.status === 'OCCUPIED' && b.student) {
                          return (
                            <div
                              key={b.bedNumber}
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 7px',
                                borderRadius: 6,
                                background: 'rgba(99, 102, 241, 0.12)',
                                color: 'var(--text-primary)',
                                border: '1px solid rgba(99, 102, 241, 0.25)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                              }}
                              title={`Bed ${b.bedNumber}: ${b.student.name} (${b.student.rollNo || 'MIS unassigned'})`}
                            >
                              <span style={{ color: '#6366f1', fontWeight: 800, marginRight: 4 }}>B{b.bedNumber}</span>
                              <span>{b.student.name}</span>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={b.bedNumber}
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: 6,
                              background: 'rgba(16, 185, 129, 0.08)',
                              color: '#10b981',
                              border: '1px dashed rgba(16, 185, 129, 0.4)',
                            }}
                          >
                            B{b.bedNumber} Vacant
                          </div>
                        );
                      })}
                    </div>

                    {/* Bottom Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 2 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#4f46e5' }}>
                        Inspect Room &amp; Students →
                      </span>

                      {room.vacancies > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTargetRoomForAdd(room);
                            setShowAddModal(true);
                          }}
                          style={{ padding: '4px 10px', fontSize: 11.5, background: '#10b981', border: 'none', fontWeight: 800 }}
                        >
                          + Assign
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className="card"
              style={{
                padding: '48px 24px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                borderRadius: 18,
                border: '1px dashed var(--glass-border)',
                background: 'var(--bg-card)',
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                No Matching Rooms Found
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 480, margin: '6px auto 16px' }}>
                No rooms match the selected filters in {currentHostelInfo.name}
                {selectedFloor !== 'All' ? ` on ${selectedFloor}` : ''}
                {filterRoomStatus !== 'All' ? ` with status "${filterRoomStatus}"` : ''}
                {filterYear !== 'All' ? ` for "${filterYear}"` : ''}
                {studentSearchTerm ? ` matching "${studentSearchTerm}"` : ''}.
              </p>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={handleClearAllFilters}
                style={{ fontWeight: 700, padding: '6px 16px' }}
              >
                Clear All Filters
              </button>
            </div>
          )}
        </div>
      ) : activeTab === 'overall-students' ? (
        /* ════════════════════════════════════════════════════════════════════════
           TAB 2: OVERALL STUDENT ALLOCATION DIRECTORY TABLE
           Full student list with checkboxes, sortable columns, and batch actions
        ════════════════════════════════════════════════════════════════════════ */
        <div
          className="card"
          style={{
            padding: 0,
            overflow: 'hidden',
            borderRadius: 18,
            border: '1px solid var(--glass-border)',
            background: 'var(--bg-card)',
          }}
        >
          {/* Table Header Controls */}
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              background: 'var(--bg-input, rgba(255,255,255,0.02))',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={handleSelectAllFiltered}
                style={{ fontSize: 12, fontWeight: 700 }}
              >
                Select All Filtered ({filteredStudents.length})
              </button>

              {selectedStudentIds.size > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={handleClearSelection}
                  style={{ fontSize: 12, color: '#ef4444' }}
                >
                  Clear Selection ({selectedStudentIds.size})
                </button>
              )}
            </div>

            {/* Sorting & Page Size */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Sort By:</span>
              <select
                className="form-select"
                value={studentSortBy}
                onChange={(e) => setStudentSortBy(e.target.value)}
                style={{ height: 36, borderRadius: 8, fontSize: 12 }}
              >
                <option value="name_asc">Student Name (A-Z)</option>
                <option value="name_desc">Student Name (Z-A)</option>
                <option value="room_asc">Room Number</option>
                <option value="roll_asc">MIS / Roll No</option>
              </select>

              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Page Size:</span>
              <select
                className="form-select"
                value={studentPageSize}
                onChange={(e) => {
                  setStudentPageSize(e.target.value);
                  setStudentPage(1);
                }}
                style={{ height: 36, borderRadius: 8, fontSize: 12 }}
              >
                <option value="25">25 per page</option>
                <option value="50">50 per page</option>
                <option value="100">100 per page</option>
                <option value="All">Show All</option>
              </select>
            </div>
          </div>

          {/* Table Container */}
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
                  {/* Select All Checkbox */}
                  <th style={{ padding: '12px 14px', width: 44, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isAllFilteredSelected}
                      onChange={(e) => {
                        if (e.target.checked) handleSelectAllFiltered();
                        else handleClearSelection();
                      }}
                      style={{ cursor: 'pointer', width: 16, height: 16 }}
                      title="Select / Deselect all filtered students"
                    />
                  </th>
                  <th style={{ padding: '12px 14px', fontWeight: 800 }}>Student Name</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800 }}>Student ID / MIS</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800 }}>Hostel</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800 }}>Floor</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800 }}>Room &amp; Bed</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800 }}>Department</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800 }}>Course &amp; Year</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800 }}>Status</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedStudents.length > 0 ? (
                  paginatedStudents.map((student) => {
                    const isSelected = selectedStudentIds.has(student._id);
                    return (
                      <tr
                        key={student._id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          background: isSelected ? 'rgba(79, 70, 229, 0.08)' : 'transparent',
                          transition: 'background 0.15s ease',
                        }}
                        className="room-table-row"
                      >
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleStudentSelection(student._id)}
                            style={{ cursor: 'pointer', width: 16, height: 16 }}
                          />
                        </td>
                        <td style={{ padding: '12px 14px', fontWeight: 700 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #4f46e5, #06b6d4)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 800,
                                flexShrink: 0,
                              }}
                            >
                              {student.name.charAt(0).toUpperCase()}
                            </div>
                            <span style={{ color: 'var(--text-primary)' }}>{student.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {student.rollNo || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                          {student.hostel || selectedHostel}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                          {student.floor || '-'}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          {student.roomNumber !== 'Unassigned' ? (
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: 8,
                                background: 'rgba(99, 102, 241, 0.14)',
                                color: '#4f46e5',
                                fontWeight: 800,
                                fontSize: 12,
                              }}
                            >
                              Room {student.roomNumber} · Bed {student.bedIndex || '-'}
                            </span>
                          ) : (
                            <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>
                              Unassigned Pool
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                          {student.department || 'CSE'}
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                          {student.course || 'B.Tech'} ({student.year || 'B.Tech'})
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 99,
                              fontSize: 11,
                              fontWeight: 800,
                              background: student.isUnassigned ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                              color: student.isUnassigned ? '#ef4444' : '#10b981',
                            }}
                          >
                            {student.isUnassigned ? 'Unassigned' : 'Allocated'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {student.roomNumber !== 'Unassigned' ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => {
                                    setStudentToTransfer(student);
                                    setShowTransferModal(true);
                                  }}
                                  style={{ padding: '4px 8px', fontSize: 11.5 }}
                                  title="Transfer student to another room"
                                >
                                  Move
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => handleRemoveStudent(student.roomNumber, student)}
                                  style={{ padding: '4px 8px', fontSize: 11.5, color: '#ef4444' }}
                                  title="Remove from room"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() => {
                                  setSelectedUnassignedId(student._id);
                                  setAddFormMode('unassigned');
                                  setShowAddModal(true);
                                }}
                                style={{ padding: '4px 8px', fontSize: 11.5, background: '#10b981', border: 'none' }}
                              >
                                Assign
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                      No students match the current filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Pagination Footer */}
          {studentPageSize !== 'All' && totalStudentPages > 1 && (
            <div
              style={{
                padding: '12px 18px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12.5,
                color: 'var(--text-secondary)',
              }}
            >
              <span>
                Page <strong>{studentPage}</strong> of <strong>{totalStudentPages}</strong> ({filteredStudents.length} students)
              </span>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={studentPage <= 1}
                  onClick={() => setStudentPage((p) => Math.max(1, p - 1))}
                  style={{ padding: '4px 10px' }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={studentPage >= totalStudentPages}
                  onClick={() => setStudentPage((p) => Math.min(totalStudentPages, p + 1))}
                  style={{ padding: '4px 10px' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ════════════════════════════════════════════════════════════════════════
           TAB 3: UNASSIGNED STUDENT POOL
        ════════════════════════════════════════════════════════════════════════ */
        <div
          className="card"
          style={{
            padding: 24,
            borderRadius: 18,
            border: '1px solid var(--glass-border)',
            background: 'var(--bg-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>
                Unassigned Students in {currentHostelInfo.name} ({data?.unassigned?.length || 0})
              </h2>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                Students who belong to this hostel but currently do not have a room assigned.
              </p>
            </div>

            {data?.unassigned && data.unassigned.length > 0 && (
              <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontWeight: 800 }}>
                {data.unassigned.length} Awaiting Room
              </span>
            )}
          </div>

          {data?.unassigned && data.unassigned.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {data.unassigned.map((st) => (
                <div
                  key={st._id}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: 'var(--bg-input, rgba(255,255,255,0.03))',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #ef4444, #f59e0b)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: 15,
                      }}
                    >
                      {st.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--text-primary)' }}>
                        {st.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        MIS: <strong>{st.rollNo || 'Not Assigned'}</strong>
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div><strong>Department:</strong> {st.department || 'CSE'}</div>
                    <div><strong>Year:</strong> {st.year || 'B.Tech'}</div>
                    {st.email && <div><strong>Email:</strong> {st.email}</div>}
                    {st.phone && <div><strong>Phone:</strong> {st.phone}</div>}
                  </div>

                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setSelectedUnassignedId(st._id);
                      setAddFormMode('unassigned');
                      setShowAddModal(true);
                    }}
                    style={{ marginTop: 'auto', background: '#10b981', border: 'none', fontWeight: 800, fontSize: 12 }}
                  >
                    + Assign to a Room
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
                All Students in {currentHostelInfo.name} Are Allocated!
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                There are zero unassigned students in this hostel.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 1: DEDICATED ROOM INSPECT POPUP MODAL
      ────────────────────────────────────────────────────────────────────────── */}
      {activeRoomInspectModal && (
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
          onClick={() => setActiveRoomInspectModal(null)}
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
                    Room {activeRoomInspectModal.roomNumber}
                  </h2>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>
                    {activeRoomInspectModal.floor} · {currentHostelInfo.name} ({currentHostelInfo.code})
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setCapacityInput(activeRoomInspectModal.capacity);
                    setShowCapacityModal(true);
                  }}
                  style={{ fontSize: 12, padding: '6px 10px' }}
                >
                  Edit Capacity
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRoomInspectModal(null)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
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
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>CAPACITY</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginTop: 2 }}>
                  {activeRoomInspectModal.capacity} Beds
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>OCCUPIED</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#6366f1', marginTop: 2 }}>
                  {activeRoomInspectModal.occupancy} Students
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>AVAILABLE BEDS</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: activeRoomInspectModal.vacancies > 0 ? '#10b981' : '#ef4444', marginTop: 2 }}>
                  {activeRoomInspectModal.vacancies} Available
                </div>
              </div>
            </div>

            {/* Resident Students in Room */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Allocated Students ({activeRoomInspectModal.occupancy}/{activeRoomInspectModal.capacity})
                </h3>

                {activeRoomInspectModal.vacancies > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setTargetRoomForAdd(activeRoomInspectModal);
                      setShowAddModal(true);
                    }}
                    style={{ fontSize: 12, fontWeight: 800, background: '#10b981', border: 'none' }}
                  >
                    <MdPersonAdd size={15} /> + Add Student
                  </button>
                )}
              </div>

              {activeRoomInspectModal.students && activeRoomInspectModal.students.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {activeRoomInspectModal.students.map((student, idx) => (
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
                            <img src={student.studentPhoto} alt={student.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            student.name.charAt(0).toUpperCase()
                          )}
                        </div>

                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                              {student.name}
                            </span>
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, background: 'rgba(99, 102, 241, 0.14)', color: '#6366f1', fontWeight: 700 }}>
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
                            {student.email && <span><MdEmail size={12} /> {student.email}</span>}
                            {student.phone && <span><MdPhone size={12} /> {student.phone}</span>}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setStudentToTransfer(student);
                            setShowTransferModal(true);
                          }}
                          style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px' }}
                        >
                          <MdSwapHoriz size={16} /> Move Room
                        </button>

                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => handleRemoveStudent(activeRoomInspectModal.roomNumber, student)}
                          style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px', color: '#ef4444' }}
                        >
                          <MdDeleteOutline size={16} /> Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: 28, textAlign: 'center', borderRadius: 14, background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                  This room currently has no students assigned. All beds are vacant.
                </div>
              )}
            </div>
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
                  Assign Student to Room {targetRoomForAdd?.roomNumber || currentSelectedRoomObj?.roomNumber || activeRoomInspectModal?.roomNumber}
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {currentHostelInfo.name} · Bed capacity: {targetRoomForAdd?.capacity || currentSelectedRoomObj?.capacity || 4}
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
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)} style={{ flex: 1 }}>
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
                <button type="button" className="btn btn-secondary" onClick={() => setShowTransferModal(false)} style={{ flex: 1 }}>
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
          MODAL 4: CREATE NEW ROOM
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
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateRoomModal(false)} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createRoomLoading} style={{ flex: 1, fontWeight: 800 }}>
                  {createRoomLoading ? 'Creating...' : 'Create Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          MODAL 5: EDIT ROOM CAPACITY
      ────────────────────────────────────────────────────────────────────────── */}
      {showCapacityModal && (currentSelectedRoomObj || activeRoomInspectModal) && (
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
              Edit Capacity for Room {(currentSelectedRoomObj || activeRoomInspectModal).roomNumber}
            </h3>
            <form onSubmit={handleUpdateCapacitySubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, display: 'block' }}>
                  Total Bed Capacity (1–10 Beds)
                </label>
                <input
                  type="number"
                  min={Math.max(1, (currentSelectedRoomObj || activeRoomInspectModal).occupancy)}
                  max="10"
                  className="form-input"
                  value={capacityInput}
                  onChange={(e) => setCapacityInput(e.target.value)}
                  style={{ width: '100%', height: 38, borderRadius: 10, fontSize: 14 }}
                />
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  Cannot be lower than currently assigned students ({(currentSelectedRoomObj || activeRoomInspectModal).occupancy}).
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCapacityModal(false)} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={capacityLoading} style={{ flex: 1, fontWeight: 800 }}>
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
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 640px) {
          .room-allocation-page {
            padding: 12px !important;
          }
        }
      `}</style>
    </div>
  );

  if (embedded) {
    return pageContent;
  }

  return (
    <div className="fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Navbar title="Room Allocation Management" />
      <div
        className="page-area"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '24px 28px 80px',
        }}
      >
        {pageContent}
      </div>
    </div>
  );
}
