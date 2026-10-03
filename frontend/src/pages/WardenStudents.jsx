import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdPeople, MdSearch, MdEmail, MdPhone, MdLock, MdDeleteOutline } from 'react-icons/md';
import { useAuth } from '../context/AuthContext';
import StudentAvatar from '../components/StudentAvatar';

export default function WardenStudents() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const res = await api.get('/dashboard/students');
      setStudents(res.data.students || []);
    } catch (err) {
      toast.error('Failed to load students list');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStudent = async (id, name) => {
    if (!window.confirm(`Are you sure you want to permanently delete student "${name}" and all their request history?`)) {
      return;
    }
    try {
      const res = await api.delete(`/dashboard/students/${id}`);
      toast.success(res.data.message || 'Student deleted');
      fetchStudents();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete student');
    }
  };

  const handleWipeAllStudents = async () => {
    const confirmText = window.prompt(
      '⚠️ WARNING: This will permanently delete ALL registered student accounts, photos, and pass records.\nType "WIPE" to confirm:'
    );
    if (confirmText !== 'WIPE') {
      if (confirmText !== null) toast.error('Confirmation mismatch. Operation cancelled.');
      return;
    }
    try {
      const res = await api.post('/dashboard/wipe-records', { wipeStudents: true });
      toast.success(res.data.message || 'All students deleted successfully');
      fetchStudents();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to wipe students');
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  const filteredStudents = students.filter(
    (student) =>
      student.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.rollNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.hostel?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fade-in">
      <Navbar title="Students Directory" />
      <div className="page-area">
        <div className="section-header" style={{ marginBottom: 24 }}>
          <div>
            <div className="section-title">
              <MdPeople size={24} style={{ color: 'var(--primary)', marginRight: 8, verticalAlign: 'middle' }} />
              Students
            </div>
            <div className="section-subtitle">View all registered students and their details</div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 260, maxWidth: 400 }}>
              <MdSearch size={20} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: 40 }}
                placeholder="Search by name, roll no, or hostel..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {user?.role === 'warden' && (
              <button
                type="button"
                onClick={handleWipeAllStudents}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  padding: '8px 16px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  transition: 'all 0.15s ease',
                }}
              >
                <MdDeleteOutline size={18} /> Wipe All Students
              </button>
            )}
          </div>

          {loading ? (
            <div className="loading-page" style={{ minHeight: 200 }}>
              <div className="loading-spinner" />
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Roll Number</th>
                    <th>Hostel</th>
                    <th>Contact Info</th>
                    <th>Joined</th>
                    {user?.role === 'warden' && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length > 0 ? (
                    filteredStudents.map((student) => (
                      <tr key={student._id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <StudentAvatar student={student} name={student.name} size={36} />
                            <div>
                              <div style={{ fontWeight: 600 }}>{student.name}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{student.email || student.rollNo || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--text-accent)', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                          {student.rollNo || 'N/A'}
                        </td>
                        <td>
                          {student.hostel ? (
                            <span className="badge badge-primary">{student.hostel}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>
                          )}
                        </td>
                        <td>
                          {user?.role === 'security' ? (
                            <div style={{ color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <MdLock size={14} />
                              Hidden for security
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {student.email && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                  <MdEmail size={14} color="var(--text-muted)" />
                                  {student.email}
                                </div>
                              )}
                              {student.phone && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                  <MdPhone size={14} color="var(--text-muted)" />
                                  Student: {student.phone}
                                </div>
                              )}
                              {student.parentPhone && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                  <MdPhone size={14} color="var(--text-muted)" />
                                  Parent 1: {student.parentPhone}
                                </div>
                              )}
                              {student.parentPhone2 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                  <MdPhone size={14} color="var(--text-muted)" />
                                  Parent 2: {student.parentPhone2}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          {new Date(student.createdAt).toLocaleDateString()}
                        </td>
                        {user?.role === 'warden' && (
                          <td>
                            <button
                              type="button"
                              onClick={() => handleDeleteStudent(student._id, student.name)}
                              title={`Delete ${student.name}`}
                              style={{
                                background: 'rgba(239, 68, 68, 0.08)',
                                color: '#ef4444',
                                border: '1px solid rgba(239, 68, 68, 0.28)',
                                padding: '6px 10px',
                                borderRadius: 8,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 12,
                                fontWeight: 600,
                              }}
                            >
                              <MdDeleteOutline size={15} /> Delete
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={user?.role === 'warden' ? '6' : '5'} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                        No students found matching your criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
