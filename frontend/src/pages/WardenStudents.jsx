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
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHostel, setSelectedHostel] = useState('ALL');

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const res = await api.get('/dashboard/students?limit=2000');
      const studentList = res.data.students || [];
      setStudents(studentList);
      setTotalCount(res.data.count ?? studentList.length);
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

  useEffect(() => {
    fetchStudents();
  }, []);

  const totalRegistered = totalCount || students.length;
  const countBH1 = students.filter((s) => s.hostel === 'BH1').length;
  const countBH2 = students.filter((s) => s.hostel === 'BH2').length;
  const countGH  = students.filter((s) => s.hostel === 'GH').length;
  const countUnassigned = students.filter((s) => !s.hostel).length;

  const filteredStudents = students.filter((student) => {
    const matchesSearch =
      student.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.rollNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.hostel?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.email?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesHostel =
      selectedHostel === 'ALL'
        ? true
        : selectedHostel === 'UNASSIGNED'
          ? !student.hostel
          : student.hostel === selectedHostel;

    return matchesSearch && matchesHostel;
  });

  return (
    <div className="fade-in">
      <Navbar title="Students Directory" />
      <div className="page-area">
        <div className="section-header" style={{ marginBottom: 20 }}>
          <div>
            <div className="section-title">
              <MdPeople size={24} style={{ color: 'var(--primary)', marginRight: 8, verticalAlign: 'middle' }} />
              Students Directory
            </div>
            <div className="section-subtitle">
              Comprehensive registry of institutional students enrolled in HEIMDALL campus management
            </div>
          </div>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
          }}>
            <MdPeople size={20} style={{ color: 'var(--primary-light)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total Registered:</span>
            <strong style={{ fontSize: 16, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
              {loading ? '…' : totalRegistered}
            </strong>
          </div>
        </div>

        {/* ── Summary Stat Cards ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            className="stat-card fade-in"
            style={{
              padding: '14px 18px',
              cursor: 'pointer',
              border: selectedHostel === 'ALL' ? '2px solid var(--primary)' : 'var(--border)',
            }}
            onClick={() => setSelectedHostel('ALL')}
          >
            <div className="stat-label">All Registered Students</div>
            <div className="stat-value" style={{ fontSize: 26, marginTop: 4 }}>
              {loading ? '—' : totalRegistered}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Total active directory users</div>
          </div>

          <div
            className="stat-card fade-in"
            style={{
              padding: '14px 18px',
              cursor: 'pointer',
              border: selectedHostel === 'BH1' ? '2px solid var(--primary)' : 'var(--border)',
            }}
            onClick={() => setSelectedHostel('BH1')}
          >
            <div className="stat-label">Boys Hostel 1 (BH1)</div>
            <div className="stat-value" style={{ fontSize: 26, marginTop: 4, color: '#3b82f6' }}>
              {loading ? '—' : countBH1}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Registered in BH1</div>
          </div>

          <div
            className="stat-card fade-in"
            style={{
              padding: '14px 18px',
              cursor: 'pointer',
              border: selectedHostel === 'BH2' ? '2px solid var(--primary)' : 'var(--border)',
            }}
            onClick={() => setSelectedHostel('BH2')}
          >
            <div className="stat-label">Boys Hostel 2 (BH2)</div>
            <div className="stat-value" style={{ fontSize: 26, marginTop: 4, color: '#6366f1' }}>
              {loading ? '—' : countBH2}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Registered in BH2</div>
          </div>

          <div
            className="stat-card fade-in"
            style={{
              padding: '14px 18px',
              cursor: 'pointer',
              border: selectedHostel === 'GH' ? '2px solid var(--primary)' : 'var(--border)',
            }}
            onClick={() => setSelectedHostel('GH')}
          >
            <div className="stat-label">Girls Hostel (GH)</div>
            <div className="stat-value" style={{ fontSize: 26, marginTop: 4, color: '#ec4899' }}>
              {loading ? '—' : countGH}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Registered in GH</div>
          </div>

          {countUnassigned > 0 && (
            <div
              className="stat-card fade-in"
              style={{
                padding: '14px 18px',
                cursor: 'pointer',
                border: selectedHostel === 'UNASSIGNED' ? '2px solid var(--primary)' : 'var(--border)',
              }}
              onClick={() => setSelectedHostel('UNASSIGNED')}
            >
              <div className="stat-label">Unassigned Hostel</div>
              <div className="stat-value" style={{ fontSize: 26, marginTop: 4, color: '#f59e0b' }}>
                {loading ? '—' : countUnassigned}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Pending hostel allocation</div>
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 10, flex: 1, maxWidth: 500 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <MdSearch size={20} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 40 }}
                  placeholder="Search by student name, roll no, email, or hostel..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              {searchTerm && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSearchTerm('')}
                  style={{ alignSelf: 'center' }}
                >
                  Clear
                </button>
              )}
            </div>

            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.03)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span>Showing:</span>
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                {filteredStudents.length}
              </strong>
              <span>of</span>
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                {totalRegistered}
              </strong>
              <span>registered students</span>
            </div>
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
                        <td style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {student.createdAt
                            ? new Date(student.createdAt).toLocaleDateString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                              })
                            : '—'}
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
