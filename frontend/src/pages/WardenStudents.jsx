import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdPeople, MdSearch, MdEmail, MdPhone, MdLock } from 'react-icons/md';
import { useAuth } from '../context/AuthContext';

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
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
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
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length > 0 ? (
                    filteredStudents.map((student) => (
                      <tr key={student._id}>
                        <td style={{ fontWeight: 600 }}>{student.name}</td>
                        <td style={{ color: 'var(--text-accent)' }}>{student.rollNo || 'N/A'}</td>
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
                                  Parent: {student.parentPhone}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          {new Date(student.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
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
