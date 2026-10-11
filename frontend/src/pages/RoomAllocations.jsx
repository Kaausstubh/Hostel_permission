/**
 * RoomAllocations Page
 * Main dashboard for managing hostel rooms, floor structure, and student occupancy.
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  MdMeetingRoom, MdSearch, MdFileDownload, MdPersonAdd,
  MdFilterList, MdCheckCircle, MdWarning, MdBuild,
  MdRefresh, MdPerson, MdPictureAsPdf, MdApartment,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import allocationApi from '../services/allocationApi';
import Navbar from '../components/Navbar';
import RoomDetailModal from '../components/RoomDetailModal';
import AllocateStudentModal from '../components/AllocateStudentModal';
import { downloadAllocationReportPDF } from '../utils/pdfReportGenerator';
import { exportAllocationsToExcel } from '../utils/excelReportGenerator';
import { getHostelLabel } from '../utils/hostel';

export default function RoomAllocations() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hostels, setHostels] = useState([]);
  const [selectedHostel, setSelectedHostel] = useState(null);
  const [floors, setFloors] = useState([]);
  const [selectedFloorId, setSelectedFloorId] = useState('ALL');
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'vacant' | 'occupied' | 'full' | 'maintenance'
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [showAllocateModal, setShowAllocateModal] = useState(false);

  // 1. Initial Load: Hostels
  useEffect(() => {
    allocationApi.getHostels()
      .then((data) => {
        setHostels(data);
        const defaultH = data.find((h) => h.code === 'BH1') || data.find((h) => h.code === 'BH2') || data[0];
        setSelectedHostel(defaultH || null);
      })
      .catch((err) => toast.error('Failed to load hostels: ' + err.message));
  }, []);

  // 2. Load Floors when Hostel changes
  useEffect(() => {
    if (!selectedHostel) return;
    allocationApi.getFloors(selectedHostel._id)
      .then((data) => {
        setFloors(data);
        setSelectedFloorId('ALL');
      })
      .catch((err) => toast.error('Failed to load floors: ' + err.message));
  }, [selectedHostel]);

  // 3. Load Rooms when Floor or Hostel changes
  const loadRooms = async () => {
    if (!selectedHostel) return;
    setLoading(true);
    try {
      if (selectedFloorId === 'ALL') {
        const allRooms = await allocationApi.getHostelRooms(selectedHostel._id);
        setRooms(allRooms);
      } else {
        const flRooms = await allocationApi.getRooms(selectedFloorId);
        setRooms(flRooms);
      }
    } catch (err) {
      toast.error('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedHostel && selectedFloorId) {
      loadRooms();
    }
  }, [selectedFloorId, selectedHostel]);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalRooms = rooms.length;
    let totalCapacity = 0;
    let totalOccupants = 0;
    let fullRooms = 0;
    let vacantRooms = 0;
    let maintenanceRooms = 0;

    rooms.forEach((r) => {
      totalCapacity += r.capacity || 4;
      totalOccupants += r.occupantsCount || 0;
      if (r.status === 'maintenance' || r.status === 'blocked') maintenanceRooms++;
      else if (r.occupantsCount === 0) vacantRooms++;
      else if (r.occupantsCount >= r.capacity) fullRooms++;
    });

    const vacantBeds = Math.max(0, totalCapacity - totalOccupants);
    const occupancyRate = totalCapacity > 0 ? Math.round((totalOccupants / totalCapacity) * 100) : 0;

    return {
      totalRooms,
      totalCapacity,
      totalOccupants,
      vacantBeds,
      occupancyRate,
      fullRooms,
      vacantRooms,
      maintenanceRooms,
    };
  }, [rooms]);

  // Filtered rooms
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      // Status filter
      if (statusFilter === 'vacant' && r.occupantsCount !== 0) return false;
      if (statusFilter === 'full' && r.occupantsCount < r.capacity) return false;
      if (statusFilter === 'occupied' && (r.occupantsCount === 0 || r.occupantsCount >= r.capacity)) return false;
      if (statusFilter === 'maintenance' && r.status !== 'maintenance' && r.status !== 'blocked') return false;

      // Search query (matches room number OR student name OR student rollNo)
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesRoom = r.room_number.toLowerCase().includes(query);
        const matchesStudent = r.occupants?.some((o) => {
          const s = o.student;
          return s?.name?.toLowerCase().includes(query) || s?.rollNo?.toLowerCase().includes(query);
        });
        if (!matchesRoom && !matchesStudent) return false;
      }

      return true;
    });
  }, [rooms, statusFilter, searchQuery]);

  const getRoomsForExport = async () => {
    if (!selectedHostel) return [];
    if (selectedFloorId === 'ALL' && rooms.length > 0) {
      return rooms;
    }
    try {
      return await allocationApi.getHostelRooms(selectedHostel._id);
    } catch {
      return rooms;
    }
  };

  const handleExportPdf = async () => {
    if (!selectedHostel) {
      toast.error('Please select a hostel first');
      return;
    }
    try {
      setExportingPdf(true);
      const exportRooms = await getRoomsForExport();
      if (exportRooms.length === 0) {
        toast.error('No rooms available to export');
        return;
      }
      await downloadAllocationReportPDF({
        hostel: selectedHostel,
        rooms: exportRooms,
        metrics,
        user,
      });
      toast.success('Allocation PDF report downloaded successfully');
    } catch (err) {
      toast.error('Failed to export PDF: ' + err.message);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    if (!selectedHostel) {
      toast.error('Please select a hostel first');
      return;
    }
    try {
      setExportingExcel(true);
      const exportRooms = await getRoomsForExport();
      if (exportRooms.length === 0) {
        toast.error('No rooms available to export');
        return;
      }
      await exportAllocationsToExcel({
        hostel: selectedHostel,
        rooms: exportRooms,
      });
      toast.success('Allocation Excel spreadsheet downloaded successfully');
    } catch (err) {
      toast.error('Failed to export Excel: ' + err.message);
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="fade-in">
      <Navbar title="Room Allocation Management" />
      <div className="page-area">
        <div style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 40 }}>
      {/* Top Banner / Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
            <MdMeetingRoom style={{ color: 'var(--primary-light)' }} />
            Room Allocation Management
          </h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
            Hostel structure & single source of truth for student room occupancy
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={loadRooms}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <MdRefresh size={18} />
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleExportPdf}
            disabled={exportingPdf || rooms.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <MdPictureAsPdf size={18} style={{ color: '#ef4444' }} />
            {exportingPdf ? 'Exporting PDF...' : 'Export PDF'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleExportExcel}
            disabled={exportingExcel || rooms.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <MdFileDownload size={18} style={{ color: '#10b981' }} />
            {exportingExcel ? 'Exporting Excel...' : 'Export Excel'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAllocateModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <MdPersonAdd size={18} />
            Allocate Student
          </button>
        </div>
      </div>

      {/* Select Hostel Section */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          borderRadius: 14,
          marginBottom: 20,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MdApartment style={{ color: 'var(--primary-light)', fontSize: 22 }} />
            <div>
              <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
                Select Hostel
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>
                Choose hostel to view and manage its floor allocations
              </span>
            </div>
          </div>
          {selectedHostel && (
            <span
              style={{
                fontSize: 12,
                padding: '4px 12px',
                borderRadius: 20,
                background: 'rgba(139,92,246,0.15)',
                color: 'var(--primary-light)',
                fontWeight: 600,
                border: '1px solid rgba(139,92,246,0.3)',
              }}
            >
              Active: {getHostelLabel(selectedHostel.code)}
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {hostels.map((h) => {
            const isSelected = selectedHostel?._id === h._id || selectedHostel?.code === h.code;
            return (
              <div
                key={h._id || h.code}
                onClick={() => {
                  if (selectedHostel?._id !== h._id && selectedHostel?.code !== h.code) {
                    setSelectedHostel(h);
                    setSelectedFloorId('ALL');
                  }
                }}
                style={{
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                  background: isSelected ? 'rgba(139,92,246,0.12)' : 'var(--bg-input)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: isSelected ? 'var(--primary-light)' : 'var(--text-primary)' }}>
                    {getHostelLabel(h.code)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {h.name || `Hostel ${h.code}`}
                  </div>
                </div>
                {isSelected ? (
                  <MdCheckCircle style={{ color: 'var(--primary)', fontSize: 20 }} />
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ padding: '16px 20px', borderRadius: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total Rooms</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
            {metrics.totalRooms}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Capacity: {metrics.totalCapacity} beds
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderRadius: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Occupied Beds</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--primary-light)', marginTop: 4 }}>
            {metrics.totalOccupants}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {metrics.occupancyRate}% overall occupancy
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderRadius: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Vacant Beds</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
            {metrics.vacantBeds}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {metrics.vacantRooms} fully empty rooms
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderRadius: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Rooms in Maintenance</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--warning)', marginTop: 4 }}>
            {metrics.maintenanceRooms}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Excluded from allocations
          </div>
        </div>
      </div>

      {/* Floor Selector Pills */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setSelectedFloorId('ALL')}
          className={`btn btn-sm ${selectedFloorId === 'ALL' ? 'btn-primary' : 'btn-outline'}`}
          style={{ whiteSpace: 'nowrap', borderRadius: 20 }}
        >
          All Floors ({floors.length})
        </button>
        {floors.map((f) => (
          <button
            key={f._id}
            type="button"
            onClick={() => setSelectedFloorId(f._id)}
            className={`btn btn-sm ${selectedFloorId === f._id ? 'btn-primary' : 'btn-outline'}`}
            style={{ whiteSpace: 'nowrap', borderRadius: 20 }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {/* Status Filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: 'ALL', label: 'All Rooms' },
            { id: 'vacant', label: 'Vacant' },
            { id: 'occupied', label: 'Partially Occupied' },
            { id: 'full', label: 'Full' },
            { id: 'maintenance', label: 'Maintenance' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStatusFilter(item.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: statusFilter === item.id ? '1px solid var(--primary)' : '1px solid var(--glass-border)',
                backgroundColor: statusFilter === item.id ? 'rgba(139,92,246,0.2)' : 'transparent',
                color: statusFilter === item.id ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Live Search */}
        <div style={{ position: 'relative', width: 280, maxWidth: '100%' }}>
          <MdSearch size={20} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search student or room..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 38 }}
          />
        </div>
      </div>

      {/* Room Grid */}
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="loading-spinner" style={{ width: 36, height: 36, margin: '0 auto 12px' }} />
          Loading room grid...
        </div>
      ) : filteredRooms.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', borderRadius: 14 }}>
          No rooms match the selected criteria.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {filteredRooms.map((room) => {
            const isFull = room.occupantsCount >= room.capacity;
            const isVacant = room.occupantsCount === 0;
            const isMaint = room.status === 'maintenance' || room.status === 'blocked';

            return (
              <div
                key={room._id}
                onClick={() => setSelectedRoomId(room._id)}
                className="card"
                style={{
                  padding: 16,
                  borderRadius: 12,
                  cursor: 'pointer',
                  border: isMaint
                    ? '1px solid rgba(245,158,11,0.4)'
                    : isFull
                    ? '1px solid rgba(139,92,246,0.4)'
                    : '1px solid var(--glass-border)',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  backgroundColor: 'var(--card-bg)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                {/* Room Card Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
                    Room {room.room_number}
                  </div>
                  <span
                    className={`badge badge-${
                      isMaint ? 'warning' : isFull ? 'primary' : isVacant ? 'success' : 'info'
                    }`}
                    style={{ fontSize: 11 }}
                  >
                    {isMaint ? 'Maintenance' : `${room.occupantsCount}/${room.capacity}`}
                  </span>
                </div>

                {/* Occupants list preview */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 64 }}>
                  {room.occupants?.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 8 }}>
                      Empty room ({room.capacity} vacant beds)
                    </div>
                  ) : (
                    room.occupants.map((o) => (
                      <div
                        key={o.allocation_id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        <MdPerson size={14} style={{ color: 'var(--primary-light)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {o.student?.name || 'Student'}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          ({o.student?.rollNo || 'N/A'})
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Bottom vacancy info */}
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 8,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>{room.vacantBeds} vacant bed{room.vacantBeds !== 1 ? 's' : ''}</span>
                  <span style={{ color: 'var(--primary-light)', fontWeight: 600 }}>Manage &gt;</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

        </div>
      </div>

      {/* Room Detail Modal */}
      {selectedRoomId && (
        <RoomDetailModal
          isOpen={Boolean(selectedRoomId)}
          onClose={() => setSelectedRoomId(null)}
          roomId={selectedRoomId}
          floors={floors}
          onRoomUpdated={loadRooms}
        />
      )}

      {/* Allocate Student Modal */}
      {showAllocateModal && (
        <AllocateStudentModal
          isOpen={showAllocateModal}
          onClose={() => setShowAllocateModal(false)}
          floors={floors}
          hostel={selectedHostel}
          onAllocated={loadRooms}
        />
      )}
    </div>
  );
}
