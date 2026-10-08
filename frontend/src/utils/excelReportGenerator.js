let xlsxPromise = null;
import { getHostelLabel } from './hostel';

const getXLSX = () => {
  if (!xlsxPromise) {
    xlsxPromise = import('xlsx');
  }
  return xlsxPromise;
};

/**
 * Formula injection neutralization:
 * If a string starts with =, +, -, @, \t, or \r, prepend a single quote to neutralize formula execution.
 */
export const sanitizeFormula = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
};

/**
 * Calculates responsive column widths for an Excel worksheet based on content
 */
const autoFitColumns = (data, minWidth = 12) => {
  if (!data || data.length === 0) return [];
  const keys = Object.keys(data[0]);
  return keys.map((key) => {
    let maxLen = key.length;
    for (const row of data) {
      const val = row[key];
      if (val !== undefined && val !== null) {
        const strVal = String(val);
        if (strVal.length > maxLen) {
          maxLen = strVal.length;
        }
      }
    }
    return { wch: Math.min(Math.max(maxLen + 3, minWidth), 45) };
  });
};

/**
 * Formats Gate Scan Logs into tabular rows
 */
export const formatGateLogsForExcel = (logs = []) => {
  return logs.map((log, index) => {
    const student = log.student_id;
    const outTimeStr = log.out_time
      ? new Date(log.out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : (log.status === 'OUT' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
    const inTimeStr = log.in_time
      ? new Date(log.in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : (log.status === 'IN' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
    const scannedByName =
      log.scanned_by_name ||
      log.scannedBy?.name ||
      log.scannedBy?.rollNo ||
      log.scannedBy?.email ||
      'Duty Guard';

    return {
      'S.No': index + 1,
      'Student Name': sanitizeFormula(student?.name || log.name || 'Unknown'),
      'Roll Number': sanitizeFormula(student?.rollNo || log.rollNo || '—'),
      'Hostel': sanitizeFormula(getHostelLabel(student?.hostel || log.hostel)),
      'Room Number': sanitizeFormula(log.roomNo || student?.roomNo || '—'),
      'Status': sanitizeFormula(log.status || 'OUT'),
      'Destination / Place': sanitizeFormula(log.place || 'City / Local'),
      'Date': sanitizeFormula(log.date || (log.timestamp ? new Date(log.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '—')),
      'Out Time': sanitizeFormula(outTimeStr),
      'In Time': sanitizeFormula(inTimeStr),
      'Returned': log.returned ? 'Yes' : 'No',
      'Duty Guard / Scanned By': sanitizeFormula(scannedByName),
      'Record ID': sanitizeFormula(String(log._id || '')),
    };
  });
};

/**
 * Formats Home Visit Records into tabular rows
 */
export const formatHomeLogsForExcel = (homeLogs = []) => {
  return homeLogs.map((visit, index) => {
    const student = visit.student_id;
    const outTimeStr = visit.actual_out_time
      ? new Date(visit.actual_out_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : '—';
    const inTimeStr = visit.actual_in_time
      ? new Date(visit.actual_in_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : '—';
    const statusStr = visit.actual_in_time
      ? 'HOME IN'
      : (visit.actual_out_time ? 'HOME OUT' : (visit.overall_status?.toUpperCase() || 'APPROVED'));
    const scannedByName =
      visit.scanned_by_name ||
      visit.scannedBy?.name ||
      visit.scanned_by_in?.name ||
      visit.scanned_by_out?.name ||
      visit.parent_call_confirmed_by?.name ||
      (visit.actual_in_time || visit.actual_out_time ? 'Duty Guard' : '—');

    return {
      'S.No': index + 1,
      'Student Name': sanitizeFormula(student?.name || visit.name || 'Unknown'),
      'Roll Number': sanitizeFormula(student?.rollNo || visit.rollNo || '—'),
      'Hostel': sanitizeFormula(getHostelLabel(student?.hostel || visit.hostel)),
      'Room Number': sanitizeFormula(visit.roomNo || student?.roomNo || '—'),
      'Destination Place': sanitizeFormula(visit.place || '—'),
      'Reason': sanitizeFormula(visit.reason || '—'),
      'Leave Date': sanitizeFormula(visit.leave_date || '—'),
      'Return Date': sanitizeFormula(visit.return_date || '—'),
      'Home Out Time': sanitizeFormula(outTimeStr),
      'Home In Time': sanitizeFormula(inTimeStr),
      'Status': sanitizeFormula(statusStr),
      'Returned': visit.qr_used_in ? 'Yes' : (visit.actual_in_time ? 'Yes' : 'No'),
      'Parent Contact': sanitizeFormula(student?.parentPhone || visit.parent_phone || '—'),
      'Staff / Guard': sanitizeFormula(scannedByName),
      'Record ID': sanitizeFormula(String(visit._id || '')),
    };
  });
};

/**
 * Formats Visitor Entry/Exit Records into tabular rows
 */
export const formatVisitorLogsForExcel = (visitorLogs = []) => {
  return visitorLogs.map((log, index) => {
    const entryTimeStr = log.entryTime
      ? new Date(log.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : '—';
    const exitTimeStr = log.exitTime
      ? new Date(log.exitTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : '—';

    let details = '—';
    if (log.purpose === 'Meeting a student') {
      details = [
        log.studentName ? `Student: ${log.studentName}` : '',
        log.studentHostel ? `Hostel: ${getHostelLabel(log.studentHostel)}` : '',
        log.studentRoomNo ? `Room: ${log.studentRoomNo}` : '',
      ].filter(Boolean).join(', ') || '—';
    } else if (log.purposeDetails) {
      details = log.purposeDetails;
    }

    return {
      'S.No': index + 1,
      'Visitor Name': sanitizeFormula(log.name || 'Unknown'),
      'Phone Number': sanitizeFormula(log.phone || '—'),
      'Visitors': Number(log.visitorCount) || 1,
      'Has Vehicle': log.hasVehicle ? 'Yes' : 'No',
      'Vehicle No': sanitizeFormula(log.hasVehicle && log.vehicleNumber ? log.vehicleNumber : ''),
      'Purpose': sanitizeFormula(log.purpose || 'General Visit'),
      'Student / Details': sanitizeFormula(details),
      'Status': sanitizeFormula(log.status || 'INSIDE'),
      'Date': sanitizeFormula(log.date || '—'),
      'Entry Time': sanitizeFormula(entryTimeStr),
      'Exit Time': sanitizeFormula(exitTimeStr),
      'Duty Guard / Logged By': sanitizeFormula(log.logged_by_name || 'Duty Guard'),
      'Pass Number': sanitizeFormula(log.passNumber || '—'),
      'Source': sanitizeFormula(log.source || 'MANUAL'),
      'Record ID': sanitizeFormula(String(log._id || '')),
    };
  });
};

/**
 * Generate and download an Excel spreadsheet (.xlsx or .csv) from Gate & Home visit logs
 */
export const downloadGateRecordsExcel = async ({
  gateLogs = [],
  homeLogs = [],
  user = {},
  dateFilter = '',
  activeTab = 'gate',
  exportScope = 'current',
  customFileName = '',
}) => {
  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();
  const dateStamp = dateFilter || new Date().toISOString().slice(0, 10);
  const officerRole = (user?.role === 'warden' ? 'HOSTEL STAFF' : (user?.role || 'Staff')).toUpperCase();
  const generatedBy = `${user?.name || 'Authorized Staff'} (${officerRole})`;

  // Determine what to export
  const shouldExportGate = exportScope === 'gate' || exportScope === 'all' || (exportScope === 'current' && activeTab === 'gate') || (exportScope === 'csv' && activeTab === 'gate');
  const shouldExportHome = exportScope === 'home' || exportScope === 'all' || (exportScope === 'current' && activeTab === 'home') || (exportScope === 'csv' && activeTab === 'home');

  let defaultName = `IIITP_HEIMDALL_Logs_${dateStamp}.xlsx`;
  if (exportScope === 'gate' || (exportScope === 'current' && activeTab === 'gate')) {
    defaultName = `IIITP_HEIMDALL_Gate_Scan_Logs_${dateStamp}.xlsx`;
  } else if (exportScope === 'home' || (exportScope === 'current' && activeTab === 'home')) {
    defaultName = `IIITP_HEIMDALL_Home_Visit_Records_${dateStamp}.xlsx`;
  } else if (exportScope === 'all') {
    defaultName = `IIITP_HEIMDALL_Combined_Access_Report_${dateStamp}.xlsx`;
  } else if (exportScope === 'csv') {
    defaultName = `IIITP_HEIMDALL_${activeTab === 'gate' ? 'Gate_Scan' : 'Home_Visit'}_Logs_${dateStamp}.csv`;
  }

  const fileName = customFileName || defaultName;

  // Handle CSV export mode
  if (exportScope === 'csv') {
    const csvData = activeTab === 'gate'
      ? formatGateLogsForExcel(gateLogs)
      : formatHomeLogsForExcel(homeLogs);

    if (csvData.length === 0) {
      throw new Error(`No ${activeTab === 'gate' ? 'gate scan' : 'home visit'} records found to export.`);
    }

    const ws = XLSX.utils.json_to_sheet(csvData);
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  // Handle Excel (.xlsx) export mode
  let addedSheets = 0;

  if (shouldExportGate && gateLogs.length > 0) {
    const formattedGate = formatGateLogsForExcel(gateLogs);
    const wsGate = XLSX.utils.json_to_sheet(formattedGate);
    wsGate['!cols'] = autoFitColumns(formattedGate);
    XLSX.utils.book_append_sheet(wb, wsGate, 'Gate Scan Logs');
    addedSheets++;
  }

  if (shouldExportHome && homeLogs.length > 0) {
    const formattedHome = formatHomeLogsForExcel(homeLogs);
    const wsHome = XLSX.utils.json_to_sheet(formattedHome);
    wsHome['!cols'] = autoFitColumns(formattedHome);
    XLSX.utils.book_append_sheet(wb, wsHome, 'Home Visit Records');
    addedSheets++;
  }

  if (addedSheets === 0) {
    throw new Error('No records available in the selected scope to export.');
  }

  // Add Summary Audit Sheet
  const totalGate = gateLogs.length;
  const totalHome = homeLogs.length;
  const exits = gateLogs.filter((l) => l.status === 'OUT').length;
  const entries = gateLogs.filter((l) => l.status === 'IN').length;
  const pendingReturn = gateLogs.filter((l) => l.status === 'OUT' && !l.returned).length;

  const summaryData = [
    { 'Audit Property': 'INSTITUTION', 'Value': 'INDIAN INSTITUTE OF INFORMATION TECHNOLOGY, PUNE (IIITP)' },
    { 'Audit Property': 'SYSTEM', 'Value': 'HEIMDALL — Campus Access & Hostel Management Platform' },
    { 'Audit Property': 'OFFICE', 'Value': 'Office of Hostel Administration & Chief Warden' },
    { 'Audit Property': 'REPORT GENERATED AT', 'Value': new Date().toLocaleString('en-IN') },
    { 'Audit Property': 'GENERATED BY', 'Value': generatedBy },
    { 'Audit Property': 'DATE FILTER', 'Value': dateFilter || 'All Recorded Dates' },
    { 'Audit Property': 'TOTAL GATE SCAN LOGS', 'Value': totalGate },
    { 'Audit Property': 'GATE EXITS (OUT)', 'Value': exits },
    { 'Audit Property': 'GATE ENTRIES (IN)', 'Value': entries },
    { 'Audit Property': 'PENDING / NOT RETURNED', 'Value': pendingReturn },
    { 'Audit Property': 'TOTAL HOME VISIT RECORDS', 'Value': totalHome },
    { 'Audit Property': 'TOTAL COMBINED LOGS', 'Value': totalGate + totalHome },
  ];

  const wsSummary = XLSX.utils.json_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 32 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Audit Summary');

  // Trigger browser file download
  XLSX.writeFile(wb, fileName);
};

/**
 * Generate and download an Excel spreadsheet (.xlsx or .csv) for Visitor Entry/Exit logs
 * Includes Total Visitor Headcount in the summary and tabular records.
 */
export const downloadVisitorRecordsExcel = async ({
  visitorLogs = [],
  user = {},
  dateFilter = '',
  statusFilter = '',
  customFileName = '',
  asCsv = false,
}) => {
  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();
  const dateStamp = dateFilter || new Date().toISOString().slice(0, 10);
  const officerRole = (user?.role === 'warden' ? 'HOSTEL STAFF' : (user?.role || 'Staff')).toUpperCase();
  const generatedBy = `${user?.name || 'Authorized Staff'} (${officerRole})`;

  if (visitorLogs.length === 0) {
    throw new Error('No visitor records found to export.');
  }

  const formattedRows = formatVisitorLogsForExcel(visitorLogs);
  const defaultName = `IIITP_HEIMDALL_Visitor_Logs_${dateStamp}.${asCsv ? 'csv' : 'xlsx'}`;
  const fileName = customFileName || defaultName;

  if (asCsv) {
    const ws = XLSX.utils.json_to_sheet(formattedRows);
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  // Excel (.xlsx) mode
  const wsVisitors = XLSX.utils.json_to_sheet(formattedRows);
  wsVisitors['!cols'] = autoFitColumns(formattedRows, 14);
  XLSX.utils.book_append_sheet(wb, wsVisitors, 'Visitor Logs');

  // Summary Sheet with Total Headcount calculation
  const totalEntries = visitorLogs.length;
  const totalHeadcount = visitorLogs.reduce((acc, v) => acc + (Number(v.visitorCount) || 1), 0);
  const insideEntries = visitorLogs.filter((v) => v.status === 'INSIDE').length;
  const insideHeadcount = visitorLogs.filter((v) => v.status === 'INSIDE').reduce((acc, v) => acc + (Number(v.visitorCount) || 1), 0);
  const exitedEntries = visitorLogs.filter((v) => v.status === 'EXITED').length;
  const exitedHeadcount = visitorLogs.filter((v) => v.status === 'EXITED').reduce((acc, v) => acc + (Number(v.visitorCount) || 1), 0);
  const visitorsWithVehicles = visitorLogs.filter((v) => v.hasVehicle).length;

  const summaryData = [
    { 'Audit Property': 'INSTITUTION', 'Value': 'INDIAN INSTITUTE OF INFORMATION TECHNOLOGY, PUNE (IIITP)' },
    { 'Audit Property': 'SYSTEM', 'Value': 'HEIMDALL — Campus Visitor Entry/Exit Management' },
    { 'Audit Property': 'OFFICE', 'Value': 'Office of Campus Security & Hostel Administration' },
    { 'Audit Property': 'REPORT GENERATED AT', 'Value': new Date().toLocaleString('en-IN') },
    { 'Audit Property': 'GENERATED BY', 'Value': generatedBy },
    { 'Audit Property': 'DATE FILTER', 'Value': dateFilter || 'All Recorded Dates' },
    { 'Audit Property': 'STATUS FILTER', 'Value': statusFilter || 'All Records' },
    { 'Audit Property': 'TOTAL VISITOR ENTRIES (PASSES)', 'Value': totalEntries },
    { 'Audit Property': 'TOTAL VISITOR HEADCOUNT (PEOPLE)', 'Value': totalHeadcount },
    { 'Audit Property': 'CURRENTLY INSIDE (PASSES)', 'Value': insideEntries },
    { 'Audit Property': 'CURRENTLY INSIDE HEADCOUNT (PEOPLE)', 'Value': insideHeadcount },
    { 'Audit Property': 'EXITED ENTRIES (PASSES)', 'Value': exitedEntries },
    { 'Audit Property': 'EXITED HEADCOUNT (PEOPLE)', 'Value': exitedHeadcount },
    { 'Audit Property': 'VISITORS WITH VEHICLES', 'Value': visitorsWithVehicles },
  ];

  const wsSummary = XLSX.utils.json_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 38 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Visitor Summary');

  XLSX.writeFile(wb, fileName);
};
