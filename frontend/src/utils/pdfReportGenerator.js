import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import iiitLogo from '../assets/iiitpune-logo.png';

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
  doc.text('OFFICE OF THE CHIEF WARDEN & HOSTEL ADMINISTRATION', headerTextX, 47);

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
  doc.text('Security Wing: Maharashtra Security Force (MSF)', badgeX + 10, 56);

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
  doc.text(String(metadata.hostelFilter || 'All Hostels (BH1, BH2, GH)'), 136, startY + 35);

  // Center column (Issuing Authority)
  doc.setFont('helvetica', 'bold');
  doc.text('Issuing Officer:', 290, startY + 18);
  doc.setFont('helvetica', 'normal');
  doc.text(String(metadata.generatedBy || 'Authorized Staff'), 365, startY + 18);

  doc.setFont('helvetica', 'bold');
  doc.text('Generated On:', 290, startY + 35);
  doc.setFont('helvetica', 'normal');
  doc.text(String(metadata.generatedAt || new Date().toLocaleString('en-IN')), 365, startY + 35);

  // Right column (Movement Metrics)
  doc.setFont('helvetica', 'bold');
  doc.text('Total Verified Logs:', 550, startY + 18);
  doc.setFont('helvetica', 'normal');
  doc.text(`${summary.totalRecords || records.length} Record(s)`, 645, startY + 18);

  doc.setFont('helvetica', 'bold');
  doc.text('Movement Status:', 550, startY + 35);
  doc.setFont('helvetica', 'normal');
  doc.text(`${summary.totalExits || 0} Out  /  ${summary.totalEntries || 0} In  /  ${summary.notReturned || 0} Outside`, 645, startY + 35);

  // Clean Date Formatter helpers
  const formatSingleDate = (d) => {
    if (!d || d === '—' || d === '-') return '—';
    const str = String(d).trim();
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return `${m[3]}/${m[2]}/${m[1]}`;
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
    r.hostel || '—',
    r.category || 'In/Out',
    r.status || '—',
    r.place || r.destination || '—',
    formatRecordDate(r),
    r.outTime || (r.status === 'OUT' ? r.time : '—') || '—',
    r.inTime || (r.status === 'IN' ? r.time : '—') || '—',
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
      'Pass Type',
      'Status',
      'Destination / Place',
      'Date',
      'Out Time',
      'In Time',
      'Returned',
      'Verified By (MSF)',
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
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 95, fontStyle: 'bold', halign: 'left' },
      2: { cellWidth: 55, halign: 'center' },
      3: { cellWidth: 35, halign: 'center' },
      4: { cellWidth: 50, halign: 'center' },
      5: { cellWidth: 46, halign: 'center' },
      6: { cellWidth: 80, halign: 'left' },
      7: { cellWidth: 78, halign: 'center' }, // Generous width prevents date wrapping
      8: { cellWidth: 58, halign: 'center' },
      9: { cellWidth: 58, halign: 'center' },
      10: { cellWidth: 42, halign: 'center' },
      11: { cellWidth: 'auto', halign: 'left' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        if (data.column.index === 5) { // Status
          if (data.cell.raw === 'IN' || String(data.cell.raw).includes('IN')) {
            data.cell.styles.textColor = [5, 150, 105]; // green-600
            data.cell.styles.fontStyle = 'bold';
          } else if (data.cell.raw === 'OUT' || String(data.cell.raw).includes('OUT')) {
            data.cell.styles.textColor = [220, 38, 38]; // red-600
            data.cell.styles.fontStyle = 'bold';
          }
        }
        if (data.column.index === 10) { // Returned
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

  // Box 1: Security Supervisor (MSF)
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
  doc.text('Maharashtra Security Force (MSF) — Campus Gate', 32, lineY + 19);

  // Box 2: Hostel Warden
  doc.line(310, lineY, 490, lineY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(30, 41, 59);
  doc.text('Resident Hostel Warden', 310, lineY + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  doc.text('Council of Wardens (BH1 / BH2 / GH), IIIT Pune', 310, lineY + 19);

  // Box 3: Chief Warden
  doc.line(600, lineY, 780, lineY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(30, 41, 59);
  doc.text('Office of the Chief Warden', 600, lineY + 10);
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
    const d = log.date || (log.timestamp ? new Date(log.timestamp).toISOString().slice(0, 10) : '—');
    const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : (log.out_time || '—');
    const outTimeStr = log.out_time
      ? new Date(log.out_time).toLocaleTimeString('en-IN')
      : (log.status === 'OUT' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '—');
    const inTimeStr = log.in_time
      ? new Date(log.in_time).toLocaleTimeString('en-IN')
      : (log.status === 'IN' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '—');
    const scannedByName = log.scannedBy?.name || log.scannedBy?.rollNo || (typeof log.scannedBy === 'string' ? log.scannedBy : 'N/A');

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
      hostel: student?.hostel || log.hostel || '—',
      status: log.status || 'OUT',
      returned: log.returned ? 'Yes' : 'No',
      destination: log.place || 'City / Local',
      place: log.place || 'City / Local',
      timestamp: log.timestamp ? new Date(log.timestamp).getTime() : 0,
    });
  }

  for (const log of homeLogs) {
    const student = log.student_id;
    const outTimeStr = log.actual_out_time ? new Date(log.actual_out_time).toLocaleTimeString('en-IN') : '—';
    const inTimeStr = log.actual_in_time ? new Date(log.actual_in_time).toLocaleTimeString('en-IN') : '—';
    const leaveTime = outTimeStr !== '—' ? outTimeStr : (inTimeStr !== '—' ? inTimeStr : '—');
    const scannedByName = log.scannedBy?.name || log.scannedBy?.rollNo || log.parent_call_confirmed_by?.name || (typeof log.scannedBy === 'string' ? log.scannedBy : '—');

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
      hostel: student?.hostel || log.hostel || '—',
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

  const reportData = {
    metadata: {
      generatedAt: new Date().toLocaleString('en-IN'),
      generatedBy: `${user?.name || 'Authorized Staff'} (${(user?.role || 'staff').toUpperCase()})`,
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
