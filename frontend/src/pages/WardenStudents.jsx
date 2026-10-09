import { useState, useEffect, useMemo } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdPeople, MdSearch, MdEmail, MdPhone, MdLock, MdDeleteOutline, MdRefresh } from 'react-icons/md';
import { useAuth } from '../context/AuthContext';
import StudentAvatar from '../components/StudentAvatar';
import { getHostelLabel } from '../utils/hostel';

export default function WardenStudents() {
  const { user } = useAuth();
  const [students, setStudents] = useState(() => {
    try {
      const cached = sessionStorage.getItem('heimdall_warden_students');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [totalCount, setTotalCount] = useState(() => {
    try {
      const cachedCount = sessionStorage.getItem('heimdall_warden_students_count');
      return cachedCount ? Number(cachedCount) : 0;
    } catch {
      return 0;
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      const cached = sessionStorage.getItem('heimdall_warden_students');
      return !cached;
    } catch {
      return true;
    }
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedHostel, setSelectedHostel] = useState('ALL');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 280);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchStudents = async () => {
    try {
      if (students.length === 0) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const res = await api.get('/dashboard/students?limit=2000');
      const studentList = res.data.students || [];
      const countVal = res.data.count ?? studentList.length;
      setStudents(studentList);
      setTotalCount(countVal);
      try {
        sessionStorage.setItem('heimdall_warden_students', JSON.stringify(studentList));
        sessionStorage.setItem('heimdall_warden_students_count', String(countVal));
      } catch {}
    } catch (err) {
      toast.error('Failed to load students list');
      console.error(err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
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

  const { countBH1, countBH2, countGH1, countGH2, countUnassigned } = useMemo(() => {
    let bh1 = 0, bh2 = 0, gh1 = 0, gh2 = 0, unassigned = 0;
    for (const s of students) {
      if (s.hostel === 'BH1') bh1++;
      else if (s.hostel === 'BH2') bh2++;
      else if (s.hostel === 'GH1' || s.hostel === 'GH') gh1++;
      else if (s.hostel === 'GH2') gh2++;
      else unassigned++;
    }
    return { countBH1: bh1, countBH2: bh2, countGH1: gh1, countGH2: gh2, countUnassigned: unassigned };
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q && selectedHostel === 'ALL') return students;

    return students.filter((student) => {
      const matchesHostel =
        selectedHostel === 'ALL'
          ? true
          : selectedHostel === 'UNASSIGNED'
            ? !student.hostel
            : selectedHostel === 'GH1'
              ? (student.hostel === 'GH1' || student.hostel === 'GH')
              : student.hostel === selectedHostel;
      if (!matchesHostel) return false;
      if (!q) return true;

      const hostelLabel = getHostelLabel(student.hostel, '');
      return (
        student.name?.toLowerCase().includes(q) ||
        student.rollNo?.toLowerCase().includes(q) ||
        student.roomNo?.toLowerCase().includes(q) ||
        student.hostel?.toLowerCase().includes(q) ||
        hostelLabel.toLowerCase().includes(q) ||
        student.email?.toLowerCase().includes(q)
      );
    });
  }, [students, debouncedSearch, selectedHostel]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={fetchStudents}
              disabled={loading && students.length === 0}
              title="Refresh students directory"
            >
              <MdRefresh size={16} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
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
                {loading && students.length === 0 ? '…' : totalRegistered}
              </strong>
            </div>
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
            <div className="stat-label">Brahmaputra (BH1)</div>
            <div className="stat-value" style={{ fontSize: 26, marginTop: 4, color: '#3b82f6' }}>
              {loading ? '—' : countBH1}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Registered in Brahmaputra (BH1)</div>
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
            <div className="stat-label">Krishna (BH2)</div>
            <div className="stat-value" style={{ fontSize: 26, marginTop: 4, color: '#6366f1' }}>
              {loading ? '—' : countBH2}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Registered in Krishna (BH2)</div>
          </div>

          <div
            className="stat-card fade-in"
            style={{
              padding: '14px 18px',
              cursor: 'pointer',
              border: selectedHostel === 'GH1' ? '2px solid var(--primary)' : 'var(--border)',
            }}
            onClick={() => setSelectedHostel('GH1')}
          >
            <div className="stat-label">Indrayani (GH1)</div>
            <div className="stat-value" style={{ fontSize: 26, marginTop: 4, color: '#ec4899' }}>
              {loading ? '—' : countGH1}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Registered in Indrayani (GH1)</div>
          </div>

          <div
            className="stat-card fade-in"
            style={{
              padding: '14px 18px',
              cursor: 'pointer',
              border: selectedHostel === 'GH2' ? '2px solid var(--primary)' : 'var(--border)',
            }}
            onClick={() => setSelectedHostel('GH2')}
          >
            <div className="stat-label">Sindhu (GH2)</div>
            <div className="stat-value" style={{ fontSize: 26, marginTop: 4, color: '#06b6d4' }}>
              {loading ? '—' : countGH2}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Registered in Sindhu (GH2)</div>
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

          {(loading && students.length === 0) ? (
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
                        <th>Room</th>
                        <th>Contact Info</th>
                        <th>Joined</th>
                        {['warden', 'hostel_staff', 'admin'].includes(user?.role) && <th>Action</th>}
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
                                <span className="badge badge-primary">{getHostelLabel(student.hostel)}</span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>
                              )}
                            </td>
                            <td>
                              {student.roomNo ? (
                                <span
                                  style={{
                                    fontFamily: 'JetBrains Mono, monospace',
                                    fontWeight: 700,
                                    fontSize: 12.5,
                                    color: 'var(--text-primary)',
                                    background: 'rgba(99, 102, 241, 0.12)',
                                    border: '1px solid rgba(99, 102, 241, 0.28)',
                                    padding: '3px 8px',
                                    borderRadius: '6px',
                                    display: 'inline-block',
                                  }}
                                >
                                  Room {student.roomNo}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
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
                            {['warden', 'hostel_staff', 'admin'].includes(user?.role) && (
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
                          <td colSpan={['warden', 'hostel_staff', 'admin'].includes(user?.role) ? '6' : '5'} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
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
