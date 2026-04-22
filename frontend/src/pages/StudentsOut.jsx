/**
 * Students Currently Out Page
 */
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdPeople, MdRefresh } from 'react-icons/md';

export default function StudentsOut() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStudentsOut = async () => {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const res = await api.get(`/inout/logs?date=${today}&status=OUT`);
      // Only show those not returned
      const notReturned = res.data.logs.filter((l) => !l.returned);
      setStudents(notReturned);
    } catch (err) {
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudentsOut();
    const interval = setInterval(fetchStudentsOut, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fade-in">
      <Navbar title="Students Currently Out" />
      <div className="page-area">

        <div className="section-header">
          <div>
            <div className="section-title"><MdPeople /> Currently Outside</div>
            <div className="section-subtitle">{students.length} student(s) outside the hostel right now</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchStudentsOut} disabled={loading}>
            <MdRefresh size={16} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="loading-page"><div className="loading-spinner" style={{ width: 40, height: 40 }} /></div>
        ) : students.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 60 }}>🏠</div>
            <div style={{ fontWeight: 700, marginTop: 12 }}>All Students Are In!</div>
            <p>No students are currently outside the hostel.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Hostel</th>
                  <th>Exit Time</th>
                  <th>Duration Outside</th>
                </tr>
              </thead>
              <tbody>
                {students.map((log) => {
                  const exitTime = new Date(log.timestamp);
                  const now = new Date();
                  const diffMin = Math.floor((now - exitTime) / 60000);
                  const hours = Math.floor(diffMin / 60);
                  const mins = diffMin % 60;
                  return (
                    <tr key={log._id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{log.student_id?.name || 'Unknown'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{log.student_id?.rollNumber}</div>
                      </td>
                      <td><span className="badge badge-out">{log.student_id?.hostel || '—'}</span></td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--text-secondary)' }}>
                        {exitTime.toLocaleTimeString('en-IN')}
                      </td>
                      <td>
                        <span style={{
                          color: diffMin > 480 ? '#ef4444' : diffMin > 240 ? '#f59e0b' : '#10b981',
                          fontWeight: 600,
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: 13,
                        }}>
                          {hours > 0 ? `${hours}h ` : ''}{mins}m
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
