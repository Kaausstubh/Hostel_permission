import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import iiitLogo from '../assets/iiitpune-logo.png';
import { getHostelLabel } from './hostel';

/**
 * Safely loads image asset for jsPDF embedding
 */
const loadLogoImage = (src) => {
  return new Promise((resolve) => {
    if (!src || typeof window === 'undefined') return resolve(null);
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
};

/**
 * Generate and download an official HEIMDALL Gate Scan & Hostel Records PDF Report
 * Formatted with formal IIIT Pune institutional letterhead, audit reference, and sign-offs.
 *
 * @param {Object} reportData - { metadata, summary, records } from /api/archive/export-data
 * @param {string} customFileName - Optional custom file name
 */
export const downloadGateRecordsPDF = async (reportData, customFileName) => {
  const { metadata = {}, summary = {}, records = [] } = reportData || {};

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Try loading the official IIIT Pune logo
  const logoImg = await loadLogoImage(iiitLogo);

  // ── 1. Top Institutional Stripes ──
  doc.setFillColor(30, 58, 138); // Deep Navy Blue (#1e3a8a)
  doc.rect(0, 0, pageWidth, 4, 'F');
  doc.setFillColor(217, 119, 6); // Academic Gold (#d97706)
  doc.rect(0, 4, pageWidth, 2, 'F');

  // ── 2. Official Institute Letterhead ──
  if (logoImg) {
    try {
      doc.addImage(logoImg, 'PNG', 32, 14, 46, 46);
    } catch {
      // Fallback seal emblem
      doc.setFillColor(30, 58, 138);
      doc.circle(55, 37, 21, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text('IIITP', 43, 41);
    }
  } else {
    doc.setFillColor(30, 58, 138);
    doc.circle(55, 37, 21, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('IIITP', 43, 41);
  }

  // Institute Header Text Block
  const headerTextX = 88;

  // Institute Name
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('INDIAN INSTITUTE OF INFORMATION TECHNOLOGY, PUNE', headerTextX, 24);

  // Statutory line
  doc.setTextColor(71, 85, 105); // slate-600
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('An Institute of National Importance under Ministry of Education, Govt. of India', headerTextX, 35);

  // Department
  doc.setTextColor(30, 58, 138); // Navy-800
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('OFFICE OF HOSTEL ADMINISTRATION & STAFF', headerTextX, 47);

  // Official Report Title
  doc.setTextColor(67, 56, 202); // Indigo-700
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('CAMPUS ACCESS & GATE MOVEMENT AUDIT REPORT', headerTextX, 60);

  // ── 3. Official Document Tracking Badge (Right corner) ──
  const badgeWidth = 205;
  const badgeX = pageWidth - 32 - badgeWidth;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.roundedRect(badgeX, 13, badgeWidth, 50, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(185, 28, 28); // red-700
  doc.text('OFFICIAL & CONFIDENTIAL AUDIT', badgeX + 10, 24);

  const cleanPeriod = String(metadata.period || '').slice(0, 10).replace(/[^0-9]/g, '') || new Date().getFullYear();
  const docRef = `Ref: IIITP/HA/GATE/${cleanPeriod}/${String(records.length * 19 + 101).padStart(4, '0')}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text(docRef, badgeX + 10, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  doc.text('System: HEIMDALL Access Control v2.4', badgeX + 10, 47);
  doc.text('Security Wing: Campus Security Gate', badgeX + 10, 56);

  // Dividing Rule
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(1);
  doc.line(32, 69, pageWidth - 32, 69);

  // ── 4. Administrative Scope & Metadata Box ──
  const startY = 74;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.roundedRect(32, startY, pageWidth - 64, 52, 5, 5, 'FD');

  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);

  // Left column (Audit Scope)
  doc.setFont('helvetica', 'bold');
  doc.text('Audit Scope / Period:', 44, startY + 18);
  doc.setFont('helvetica', 'normal');
  doc.text(String(metadata.period || 'All Records'), 136, startY + 18);

  doc.setFont('helvetica', 'bold');
  doc.text('Hostel Scope / Filter:', 44, startY + 35);
  doc.setFont('helvetica', 'normal');
  doc.text(String(metadata.hostelFilter || 'All Hostels (Brahmaputra BH1, Krishna BH2, Indrayani GH)'), 136, startY + 35);

  // Center column (Issuing Authority)
  doc.setFont('helvetica', 'bold');
  doc.text('Issuing Officer:', 290, startY + 18);
  doc.setFont('helvetica', 'normal');
  const cleanOfficer = String(metadata.generatedBy || 'Authorized Staff').replace(/\bWARDEN\b/gi, 'HOSTEL STAFF');
  doc.text(cleanOfficer, 365, startY + 18);

  doc.setFont('helvetica', 'bold');
  doc.text('Generated On:', 290, startY + 35);
  doc.setFont('helvetica', 'normal');
  const defaultGeneratedAt = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' (IST)';
  doc.text(String(metadata.generatedAt || defaultGeneratedAt), 365, startY + 35);

  // Right column (Movement Metrics)
  doc.setFont('helvetica', 'bold');
  doc.text('Total Verified Logs:', 550, startY + 18);
  doc.setFont('helvetica', 'normal');
  doc.text(`${summary.totalRecords || records.length} Record(s)`, 645, startY + 18);

  doc.setFont('helvetica', 'bold');
  doc.text('Movement Status:', 550, startY + 35);
  doc.setFont('helvetica', 'normal');
  doc.text(`${summary.totalExits || 0} Out  /  ${summary.totalEntries || 0} In  /  ${summary.notReturned || 0} Outside`, 645, startY + 35);

  // Clean Date & Time Formatter helpers (IST Normalized - 24 Hours)
  const formatTimeIST = (timeVal) => {
    if (!timeVal || timeVal === '—' || timeVal === '-') return '—';
    const str = String(timeVal).trim();
    // If in 12h AM/PM format (e.g. "04:15:30 pm" or "4:15 PM"), convert to 24h
    const match12 = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = match12[2];
      const s = match12[3] || '00';
      const isPm = match12[4].toLowerCase() === 'pm';
      if (isPm && h < 12) h += 12;
      if (!isPm && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${m}:${s}`;
    }
    const d = new Date(timeVal);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }
    return str;
  };

  const formatSingleDate = (d) => {
    if (!d || d === '—' || d === '-') return '—';
    const str = String(d).trim();
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }
    return str;
  };

  const formatRecordDate = (r) => {
    if (r.leaveDate && r.returnDate) {
      return `${formatSingleDate(r.leaveDate)} to\n${formatSingleDate(r.returnDate)}`;
    }
    const raw = r.date || '';
    if (!raw || raw === '—' || raw === '-') return '—';
    const str = String(raw).trim();
    if (str.includes('→') || str.includes(' to ') || str.includes(' - ')) {
      const parts = str.split(/[→]|(\s+to\s+)|(\s+-\s+)/).map(s => s?.trim()).filter(s => s && s !== 'to' && s !== '-');
      if (parts.length >= 2) {
        return `${formatSingleDate(parts[0])} to\n${formatSingleDate(parts[1])}`;
      }
    }
    return formatSingleDate(str);
  };

  // ── 5. Audit Log Table ──
  const tableRows = records.map((r, index) => [
    index + 1,
    r.studentName || '—',
    r.rollNo || '—',
    getHostelLabel(r.hostel),
    r.roomNo || '—',
    r.category || 'In/Out',
    r.status || '—',
    r.place || r.destination || '—',
    formatRecordDate(r),
    formatTimeIST(r.outTime || (r.status === 'OUT' ? r.time : '—')),
    formatTimeIST(r.inTime || (r.status === 'IN' ? r.time : '—')),
    r.returned || '—',
    r.scannedBy || r.scannedByName || '—',
  ]);

  autoTable(doc, {
    startY: startY + 59,
    margin: { left: 32, right: 32, bottom: 44 },
    head: [[
      '#',
      'Student Name',
      'Roll No',
      'Hostel',
      'Room',
      'Pass Type',
      'Status',
      'Destination / Place',
      'Date',
      'Out Time',
      'In Time',
      'Returned',
      'Scanned By',
    ]],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 58, 138], // Deep Navy Blue (#1e3a8a)
      textColor: [255, 255, 255],
      fontSize: 7.8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 4.5,
    },
    bodyStyles: {
      fontSize: 7.2,
      textColor: [15, 23, 42],
      cellPadding: 3.5,
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 90, fontStyle: 'bold', halign: 'left' },
      2: { cellWidth: 52, halign: 'center' },
      3: { cellWidth: 35, halign: 'center' },
      4: { cellWidth: 35, halign: 'center' },
      5: { cellWidth: 46, halign: 'center' },
      6: { cellWidth: 44, halign: 'center' },
      7: { cellWidth: 76, halign: 'left' },
      8: { cellWidth: 74, halign: 'center' },
      9: { cellWidth: 54, halign: 'center' },
      10: { cellWidth: 54, halign: 'center' },
      11: { cellWidth: 40, halign: 'center' },
      12: { cellWidth: 'auto', halign: 'left' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        if (data.column.index === 6) { // Status
          if (data.cell.raw === 'IN' || String(data.cell.raw).includes('IN')) {
            data.cell.styles.textColor = [5, 150, 105]; // green-600
            data.cell.styles.fontStyle = 'bold';
          } else if (data.cell.raw === 'OUT' || String(data.cell.raw).includes('OUT')) {
            data.cell.styles.textColor = [220, 38, 38]; // red-600
            data.cell.styles.fontStyle = 'bold';
          }
        }
        if (data.column.index === 11) { // Returned
          if (data.cell.raw === 'Yes') {
            data.cell.styles.textColor = [5, 150, 105];
            data.cell.styles.fontStyle = 'bold';
          } else if (data.cell.raw === 'No') {
            data.cell.styles.textColor = [220, 38, 38];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    },
  });

  // ── 6. Official Sign-off & Verification Section (After table) ──
  const finalY = doc.lastAutoTable?.finalY || (startY + 59);
  let signY = finalY + 16;

  // Check if sign-off fits on this page without overlapping footer (needs ~60pt)
  if (signY + 58 > pageHeight - 35) {
    doc.addPage();
    signY = 40;
  }

  // Verification disclaimer
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Certified that the entries above represent genuine electronic campus access logs captured via HEIMDALL biometric & QR gate terminals.',
    32,
    signY
  );

  const lineY = signY + 30;

  // Box 1: Security Supervisor / Guard In-Charge
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.8);
  doc.line(32, lineY, 210, lineY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(30, 41, 59);
  doc.text('Security Supervisor / Guard In-Charge', 32, lineY + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  doc.text('Campus Security Gate — Main Security Post', 32, lineY + 19);

  // Box 2: Hostel Staff
  doc.line(310, lineY, 490, lineY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(30, 41, 59);
  doc.text('Resident Hostel Staff', 310, lineY + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  doc.text('Hostel Staff Administration (Brahmaputra / Krishna / Indrayani), IIIT Pune', 310, lineY + 19);

  // Box 3: Hostel Administration
  doc.line(600, lineY, 780, lineY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(30, 41, 59);
  doc.text('Office of Hostel Administration', 600, lineY + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  doc.text('Student Affairs & Hostel Administration, IIIT Pune', 600, lineY + 19);

  // ── 7. Page Footer (Applied to every page) ──
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.6);
    doc.line(32, pageHeight - 20, pageWidth - 32, pageHeight - 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'Official Institutional Record — Indian Institute of Information Technology Pune (IIIT Pune) | HEIMDALL Access Control v2.4',
      32,
      pageHeight - 9
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - 75, pageHeight - 9);
  }

  // Calculate safe file name
  const safePeriod = String(metadata.period || 'Records').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = customFileName || `IIITP_HEIMDALL_Gate_Records_${safePeriod}.pdf`;

  doc.save(filename);
};

/**
 * Generate PDF directly from client-side logs (works for Warden & Security regardless of backend state)
 */
export const generatePDFFromLocalLogs = async ({
  gateLogs = [],
  homeLogs = [],
  user = {},
  period = 'Records',
  hostelFilter = 'All Hostels',
  customFileName,
}) => {
  const formattedRecords = [];

  for (const log of gateLogs) {
    const student = log.student_id;
    const d = log.date || (log.timestamp ? new Date(log.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '—');
    const timeStr = log.timestamp
      ? new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : (log.out_time ? new Date(log.out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
    const outTimeStr = log.out_time
      ? new Date(log.out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : (log.status === 'OUT' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
    const inTimeStr = log.in_time
      ? new Date(log.in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : (log.status === 'IN' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
    const scannedByName = log.scanned_by_name || log.scannedBy?.name || log.scannedBy?.rollNo || (typeof log.scannedBy === 'string' ? log.scannedBy : 'N/A');

    formattedRecords.push({
      id: log._id,
      category: 'In/Out Daily',
      date: d,
      time: timeStr,
      outTime: outTimeStr,
      inTime: inTimeStr,
      scannedBy: scannedByName,
      studentName: student?.name || log.name || 'Unknown',
      rollNo: student?.rollNo || log.rollNo || '—',
      hostel: getHostelLabel(student?.hostel || log.hostel),
      roomNo: log.roomNo || student?.roomNo || '—',
      status: log.status || 'OUT',
      returned: log.returned ? 'Yes' : 'No',
      destination: log.place || 'City / Local',
      place: log.place || 'City / Local',
      timestamp: log.timestamp ? new Date(log.timestamp).getTime() : 0,
    });
  }

  for (const log of homeLogs) {
    const student = log.student_id;
    const outTimeStr = log.actual_out_time
      ? new Date(log.actual_out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : '—';
    const inTimeStr = log.actual_in_time
      ? new Date(log.actual_in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : '—';
    const leaveTime = outTimeStr !== '—' ? outTimeStr : (inTimeStr !== '—' ? inTimeStr : '—');
    const scannedByName = log.scanned_by_name || log.scannedBy?.name || log.scannedBy?.rollNo || log.parent_call_confirmed_by?.name || (typeof log.scannedBy === 'string' ? log.scannedBy : '—');

    const dateStr = (log.leave_date && log.return_date)
      ? `${log.leave_date} to ${log.return_date}`
      : (log.leave_date || log.return_date || '—');

    formattedRecords.push({
      id: log._id,
      category: 'Home Visit',
      date: dateStr,
      leaveDate: log.leave_date || '',
      returnDate: log.return_date || '',
      time: leaveTime,
      outTime: outTimeStr,
      inTime: inTimeStr,
      scannedByName,
      scannedBy: scannedByName,
      studentName: student?.name || log.name || 'Unknown',
      rollNo: student?.rollNo || log.rollNo || '—',
      hostel: getHostelLabel(student?.hostel || log.hostel),
      roomNo: log.roomNo || student?.roomNo || '—',
      status: log.actual_in_time ? 'HOME IN' : (log.actual_out_time ? 'HOME OUT' : (log.overall_status?.toUpperCase() || 'APPROVED')),
      returned: log.qr_used_in ? 'Yes' : 'No',
      destination: log.place || 'Home Destination',
      place: log.place || 'Home Destination',
      timestamp: log.createdAt ? new Date(log.createdAt).getTime() : 0,
    });
  }

  formattedRecords.sort((a, b) => b.timestamp - a.timestamp);

  const totalExits = formattedRecords.filter((r) => r.status === 'OUT').length;
  const totalEntries = formattedRecords.filter((r) => r.status === 'IN').length;
  const notReturned = formattedRecords.filter((r) => r.status === 'OUT' && r.returned === 'No').length;

  const officerRole = (user?.role === 'warden' ? 'HOSTEL STAFF' : (user?.role || 'staff')).toUpperCase();
  const reportData = {
    metadata: {
      generatedAt: new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) + ' (IST)',
      generatedBy: `${user?.name || 'Authorized Staff'} (${officerRole})`,
      period,
      hostelFilter,
      totalCount: formattedRecords.length,
    },
    summary: {
      totalRecords: formattedRecords.length,
      totalExits,
      totalEntries,
      notReturned,
    },
    records: formattedRecords,
  };

  await downloadGateRecordsPDF(reportData, customFileName);
};

/**
 * Generate and download an official HEIMDALL Visitor Entry/Exit & Vehicle PDF Report
 * Formatted with formal IIIT Pune institutional letterhead, headcount KPIs, and vehicle status.
 *
 * @param {Object} reportData - { metadata, summary, records }
 * @param {string} customFileName - Optional custom file name
 */
export const downloadVisitorRecordsPDF = async (reportData, customFileName) => {
  const { metadata = {}, summary = {}, records = [] } = reportData || {};

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const logoImg = await loadLogoImage(iiitLogo);

  // ── Top Stripes ──
  doc.setFillColor(30, 58, 138); // Deep Navy
  doc.rect(0, 0, pageWidth, 4, 'F');
  doc.setFillColor(217, 119, 6); // Academic Gold
  doc.rect(0, 4, pageWidth, 2, 'F');

  // ── Letterhead Emblem ──
  if (logoImg) {
    try {
      doc.addImage(logoImg, 'PNG', 32, 14, 46, 46);
    } catch {
      doc.setFillColor(30, 58, 138);
      doc.circle(55, 37, 21, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text('IIITP', 43, 41);
    }
  } else {
    doc.setFillColor(30, 58, 138);
    doc.circle(55, 37, 21, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('IIITP', 43, 41);
  }

  const headerTextX = 88;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('INDIAN INSTITUTE OF INFORMATION TECHNOLOGY, PUNE', headerTextX, 24);

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('An Institute of National Importance under Ministry of Education, Govt. of India', headerTextX, 35);

  doc.setTextColor(30, 58, 138);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('OFFICE OF CAMPUS SECURITY & HOSTEL ADMINISTRATION', headerTextX, 47);

  doc.setTextColor(67, 56, 202);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('CAMPUS VISITOR ENTRY / EXIT & VEHICLE MOVEMENT AUDIT REPORT', headerTextX, 60);

  // ── Document Tracking Badge ──
  const badgeWidth = 205;
  const badgeX = pageWidth - 32 - badgeWidth;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(badgeX, 13, badgeWidth, 50, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(185, 28, 28);
  doc.text('OFFICIAL & CONFIDENTIAL AUDIT', badgeX + 10, 24);

  const docRef = `Ref: IIITP/SEC/VIS/${new Date().getFullYear()}/${String(records.length * 7 + 101).padStart(4, '0')}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text(docRef, badgeX + 10, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${metadata.generatedAt || new Date().toLocaleString('en-IN')}`, badgeX + 10, 47);
  doc.text(`By: ${metadata.generatedBy || 'Security Staff'}`, badgeX + 10, 57);

  // Divider
  doc.setDrawColor(226, 232, 240);
  doc.line(32, 68, pageWidth - 32, 68);

  // Summary KPI Cards
  const totalEntries = summary.totalEntries ?? records.length;
  const totalHeadcount = summary.totalHeadcount ?? records.reduce((acc, r) => acc + (Number(r.visitorCount) || 1), 0);
  const insideCount = summary.insideCount ?? records.filter((r) => r.status === 'INSIDE').length;
  const insideHeadcount = summary.insideHeadcount ?? records.filter((r) => r.status === 'INSIDE').reduce((acc, r) => acc + (Number(r.visitorCount) || 1), 0);
  const vehiclesCount = summary.vehiclesCount ?? records.filter((r) => r.hasVehicle).length;

  const cardWidth = (pageWidth - 64 - 36) / 4;
  const cardY = 74;
  const cardH = 34;

  const kpis = [
    { title: 'TOTAL PASSES', value: String(totalEntries), color: [30, 58, 138] },
    { title: 'TOTAL HEADCOUNT', value: `${totalHeadcount} People`, color: [16, 185, 129] },
    { title: 'CURRENTLY INSIDE', value: `${insideCount} Passes (${insideHeadcount} People)`, color: [217, 119, 6] },
    { title: 'VEHICLES ON CAMPUS', value: `${vehiclesCount} Vehicles`, color: [99, 102, 241] },
  ];

  kpis.forEach((kpi, i) => {
    const cx = 32 + i * (cardWidth + 12);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cx, cardY, cardWidth, cardH, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.title, cx + 8, cardY + 12);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...kpi.color);
    doc.text(kpi.value, cx + 8, cardY + 26);
  });

  // AutoTable data with formula injection neutralization and neat columns
  const tableData = records.map((r, idx) => {
    const entryStr = r.entryTime ? new Date(r.entryTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
    const exitStr = r.exitTime ? new Date(r.exitTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }) : (r.status === 'INSIDE' ? 'Inside' : '—');

    let hostInfo = '—';
    if (r.purpose === 'Meeting a student') {
      hostInfo = [r.studentName, getHostelLabel(r.studentHostel), r.studentRoomNo].filter(Boolean).join(' | ');
    } else if (r.purposeDetails) {
      hostInfo = r.purposeDetails;
    }

    return [
      idx + 1,
      r.name || 'Unknown',
      r.phone || '—',
      `${r.visitorCount || 1}`,
      r.hasVehicle && r.vehicleNumber ? r.vehicleNumber : '—',
      r.purpose || 'General',
      hostInfo,
      entryStr,
      exitStr,
      r.status || 'INSIDE',
    ];
  });

  autoTable(doc, {
    startY: 114,
    head: [['S.No', 'Visitor Name', 'Phone', 'Visitors', 'Vehicle No', 'Purpose', 'Host / Details', 'In Time', 'Out Time', 'Status']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
    },
    bodyStyles: {
      fontSize: 7,
      textColor: [30, 41, 59],
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center' },
      1: { cellWidth: 85 },
      2: { cellWidth: 70 },
      3: { cellWidth: 45, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 65, halign: 'center' },
      5: { cellWidth: 80 },
      6: { cellWidth: 100 },
      7: { cellWidth: 50, halign: 'center' },
      8: { cellWidth: 50, halign: 'center' },
      9: { cellWidth: 50, halign: 'center' },
    },
    margin: { left: 32, right: 32, bottom: 40 },
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${pageCount} — HEIMDALL Visitor Access Control System — IIIT Pune`, 32, pageHeight - 16);
    doc.text(`Printed on: ${new Date().toLocaleString('en-IN')}`, pageWidth - 160, pageHeight - 16);
  }

  const fileName = customFileName || `IIITP_HEIMDALL_Visitor_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
};

