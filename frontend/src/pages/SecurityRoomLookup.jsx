/**
 * SecurityRoomLookup Page
 * Read-only room occupancy and student directory lookup for Security personnel.
 */

import { useState, useEffect } from 'react';
import { MdSearch, MdPeople, MdMeetingRoom, MdRefresh } from 'react-icons/md';
import toast from 'react-hot-toast';
import allocationApi from '../services/allocationApi';
import Navbar from '../components/Navbar';

export default function SecurityRoomLookup() {
  const [records, setRecords] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchLookup = async (query = '') => {
    setLoading(true);
    try {
      const data = await allocationApi.getSecurityLookup(query);
      setRecords(data);
    } catch (err) {
      toast.error('Failed to load room lookup');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLookup();
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchLookup(search.trim());
  };

  return (
    <div className="fade-in">
      <Navbar title="Security Room Lookup" />
      <div className="page-area">
        <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
            <MdPeople style={{ color: 'var(--accent)' }} />
            Hostel Room Occupancy Lookup
          </h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Read-only student room allocation directory for gate & campus security
          </div>
        </div>

        <button
          type="button"
          className="btn btn-outline"
          onClick={() => fetchLookup(search.trim())}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <MdRefresh size={18} />
          Refresh
        </button>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 450 }}>
          <MdSearch size={20} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search by student name or roll number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 40 }}
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
        {search && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setSearch('');
              fetchLookup('');
            }}
          >
            Clear
          </button>
        )}
      </form>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="loading-spinner" style={{ width: 36, height: 36, margin: '0 auto 12px' }} />
          Searching records...
        </div>
      ) : records.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', borderRadius: 14 }}>
          No student room allocations found.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 12 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
              <thead>
                <tr style={{ backgroundColor: 'rgba(139,92,246,0.12)', borderBottom: '1px solid var(--glass-border)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>Roll / MIS</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>Student Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>Hostel</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>Floor</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>Room No</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>Bed</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr
                    key={r.allocation_id || i}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                    }}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--accent)' }}>
                      {r.roll_number}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {r.student_name}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                      {r.hostel}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                      {r.floor}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--primary-light)' }}>
                      Room {r.room_number}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                      {r.bed_number}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--glass-border)' }}>
            Showing {records.length} active allocation{records.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
