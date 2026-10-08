/**
 * Room Allocation API Service
 * Client wrapper for the /api/allocations backend endpoints.
 */

import api from './api';

export const allocationApi = {
  // Structure
  getHostels: async () => {
    const res = await api.get('/allocations/hostels');
    return res.data?.data || [];
  },

  getFloors: async (hostelId) => {
    const res = await api.get(`/allocations/hostels/${hostelId}/floors`);
    return res.data?.data || [];
  },

  getRooms: async (floorId, status = '') => {
    const params = status ? { status } : {};
    const res = await api.get(`/allocations/floors/${floorId}/rooms`, { params });
    return res.data?.data || [];
  },

  getRoomDetails: async (roomId) => {
    const res = await api.get(`/allocations/rooms/${roomId}`);
    return res.data?.data;
  },

  createRoom: async (roomData) => {
    const res = await api.post('/allocations/rooms', roomData);
    return res.data?.data;
  },

  updateRoom: async (roomId, updates) => {
    const res = await api.patch(`/allocations/rooms/${roomId}`, updates);
    return res.data?.data;
  },

  // Allocations
  allocateStudent: async ({ student_id, room_id, bed_number, remarks }) => {
    const res = await api.post('/allocations/allocate', {
      student_id,
      room_id,
      bed_number,
      remarks,
    });
    return res.data?.data;
  },

  transferStudent: async (allocationId, { new_room_id, bed_number, reason }) => {
    const res = await api.post(`/allocations/${allocationId}/transfer`, {
      new_room_id,
      bed_number,
      reason,
    });
    return res.data?.data;
  },

  vacateStudent: async (allocationId, { reason, vacated_on }) => {
    const res = await api.post(`/allocations/${allocationId}/vacate`, {
      reason,
      vacated_on,
    });
    return res.data?.data;
  },

  // Search & Views
  searchAllocations: async ({ search = '', floorId = '', hostelId = '', status = 'active' }) => {
    const params = { search, floorId, hostelId, status };
    const res = await api.get('/allocations/search', { params });
    return res.data?.data || [];
  },

  getStudentAllocation: async (studentId) => {
    const res = await api.get(`/allocations/students/${studentId}/allocation`);
    return res.data?.data;
  },

  getSecurityLookup: async (search = '') => {
    const res = await api.get('/allocations/security/lookup', { params: { search } });
    return res.data?.data || [];
  },

  // Import
  getImportPreview: async () => {
    const res = await api.post('/allocations/import/preview');
    return res.data?.data;
  },

  confirmImport: async () => {
    const res = await api.post('/allocations/import/confirm');
    return res.data?.data;
  },

  exportAllocationsUrl: (hostelId = '') => {
    const baseUrl = api.defaults.baseURL || '/api';
    return `${baseUrl}/allocations/export${hostelId ? `?hostelId=${hostelId}` : ''}`;
  },
};


export default allocationApi;
