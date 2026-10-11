/**
 * AllocationImportPreview Page
 * Displays the authoritative BH2 PDF dataset preview with conflict checks,
 * capacity validations, and confirmation for idempotent import.
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MdPictureAsPdf, MdCheckCircle, MdWarning, MdArrowBack,
  MdPlayArrow, MdSearch, MdInfoOutline, MdDoneAll,
} from 'react-icons/md';
import toast from 'react-hot-toast';
import allocationApi from '../services/allocationApi';
import Navbar from '../components/Navbar';

export default function AllocationImportPreview() {
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Filters
  const [selectedFloor, setSelectedFloor] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const loadPreview = async () => {
    setLoading(true);
    try {
      const data = await allocationApi.getImportPreview();
      setReport(data);
    } catch (err) {
      toast.error('Failed to load PDF preview report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
  }, []);

  const filteredRecords = useMemo(() => {
    if (!report?.records) return [];
    return report.records.filter((r) => {
      if (selectedFloor !== 'ALL' && r.floor_number !== Number(selectedFloor)) {
        return false;
      }
      if (statusFilter !== 'ALL' && r.status !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchName = r.name.toLowerCase().includes(q);
        const matchRoll = r.rollNo.toLowerCase().includes(q);
        const matchRoom = r.roomNo.toLowerCase().includes(q);
        if (!matchName && !matchRoll && !matchRoom) return false;
      }
      return true;
    });
  }, [report, selectedFloor, statusFilter, search]);

  const handleConfirmImport = async () => {
    if (!window.confirm('Are you sure you want to commit these allocations to BH2? This will create rooms, student records, and room allocations.')) {
      return;
    }

    setExecuting(true);
    try {
      const result = await allocationApi.confirmImport();
      setImportResult(result);
      toast.success('BH2 allocation import completed successfully!');
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Import execution failed');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fade-in">
      <Navbar title="BH2 PDF Allocation Import" />
      <div className="page-area">
        <div style={{ maxWidth: 1300, margin: '0 auto', paddingBottom: 40 }}>
      {/* Top Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => navigate('/allocations')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <MdArrowBack size={18} />
          Back to Allocations
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-info" style={{ fontSize: 12 }}>
            Authoritative Source: PDF Document
          </span>
        </div>
      </div>

      {/* Main Title */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
          <MdPictureAsPdf style={{ color: 'var(--primary-light)' }} />
          BH2 PDF Import Preview & Validation
        </h1>
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
          Verification report for 394 student assignments across Basement, Ground, 1st, 2nd, and 3rd floors
        </div>
      </div>

      {/* Import Execution Result Modal / Banner */}
      {importResult && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            backgroundColor: 'rgba(16,185,129,0.15)',
            border: '1px solid var(--success)',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <MdDoneAll size={36} style={{ color: 'var(--success)' }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
                Import Successfully Executed!
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                Created {importResult.totalRooms} rooms • Created {importResult.usersCreated} student users •
                Allocated {importResult.allocationsCreated} students in BH2.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/allocations')}
          >
            Go to Room Allocation Grid
          </button>
        </div>
      )}

      {/* Summary Cards */}
      {report && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <div className="card" style={{ padding: '16px 20px', borderRadius: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total Rows in PDF</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
              {report.totalRecords}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Across 15 document pages
            </div>
          </div>

          <div className="card" style={{ padding: '16px 20px', borderRadius: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Valid to Allocate</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
              {report.validAllocations}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              100% compliant with capacity
            </div>
          </div>

          <div className="card" style={{ padding: '16px 20px', borderRadius: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Unique Rooms</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--primary-light)', marginTop: 4 }}>
              {report.totalRooms}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Room 30 configured: 8 capacity
            </div>
          </div>

          <div className="card" style={{ padding: '16px 20px', borderRadius: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Omitted Rows</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--warning)', marginTop: 4 }}>
              {report.skippedRecords}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Krunal Vasoya (blank room)
            </div>
          </div>
        </div>
      )}

      {/* Filter and Action Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {/* Floor Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: 'ALL', label: 'All Floors' },
            { id: '-1', label: 'Basement / Wing B' },
            { id: '0', label: 'Ground Floor' },
            { id: '1', label: '1st Floor' },
            { id: '2', label: '2nd Floor' },
            { id: '3', label: '3rd Floor' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedFloor(f.id)}
              className={`btn btn-sm ${selectedFloor === f.id ? 'btn-primary' : 'btn-outline'}`}
              style={{ borderRadius: 18, fontSize: 12 }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Action Button */}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleConfirmImport}
          disabled={executing || loading || Boolean(importResult)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px' }}
        >
          <MdPlayArrow size={20} />
          {executing ? 'Executing Import...' : 'Confirm & Commit Import to BH2'}
        </button>
      </div>

      {/* Search and Status Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'ALL', label: 'All Rows' },
            { id: 'valid', label: 'Valid Only' },
            { id: 'skipped', label: 'Omitted / Skipped Only' },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusFilter(s.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: statusFilter === s.id ? '1px solid var(--primary)' : '1px solid var(--glass-border)',
                backgroundColor: statusFilter === s.id ? 'rgba(139,92,246,0.2)' : 'transparent',
                color: statusFilter === s.id ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: 280, maxWidth: '100%' }}>
          <MdSearch size={20} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search student or room..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
          />
        </div>
      </div>

      {/* Preview Table */}
      {loading ? (
        <div style={{ padding: 64, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="loading-spinner" style={{ width: 40, height: 40, margin: '0 auto 12px' }} />
          Analyzing PDF dataset and checking DB matches...
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 12 }}>
          <div style={{ overflowX: 'auto', maxHeight: 600 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-surface)', zIndex: 2 }}>
                <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                  <th style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>Sr</th>
                  <th style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>Student Name</th>
                  <th style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>MIS / Roll No</th>
                  <th style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>Room Assigned</th>
                  <th style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>Floor</th>
                  <th style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>Capacity</th>
                  <th style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>Status</th>
                  <th style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>Validation Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((r) => (
                  <tr
                    key={r.sr}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      backgroundColor: r.status === 'skipped' ? 'rgba(245,158,11,0.06)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>{r.sr}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {r.name}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--accent)' }}>
                      {r.rollNo}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--primary-light)' }}>
                      Room {r.roomNo}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>
                      {r.floor_label}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>
                      {r.expectedCapacity} beds
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        className={`badge badge-${
                          r.status === 'valid'
                            ? 'success'
                            : r.status === 'skipped'
                            ? 'warning'
                            : 'danger'
                        }`}
                        style={{ fontSize: 11 }}
                      >
                        {r.status === 'valid' ? 'Valid' : r.status === 'skipped' ? 'Omitted' : 'Conflict'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 12 }}>
                      {r.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--glass-border)' }}>
            Showing {filteredRecords.length} of {report.totalRecords} records
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
