let xlsxPromise = null;
const getXLSX = () => {
  if (!xlsxPromise) {
    xlsxPromise = import('xlsx');
  }
  return xlsxPromise;
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
      'Student Name': student?.name || log.name || 'Unknown',
      'Roll Number': student?.rollNo || log.rollNo || '—',
      'Hostel': student?.hostel || log.hostel || '—',
      'Status': log.status || 'OUT',
      'Destination / Place': log.place || 'City / Local',
      'Date': log.date || (log.timestamp ? new Date(log.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '—'),
      'Out Time': outTimeStr,
      'In Time': inTimeStr,
      'Returned': log.returned ? 'Yes' : 'No',
      'Duty Guard / Scanned By': scannedByName,
      'Record ID': String(log._id || ''),
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
      'Student Name': student?.name || visit.name || 'Unknown',
      'Roll Number': student?.rollNo || visit.rollNo || '—',
      'Hostel': student?.hostel || visit.hostel || '—',
      'Destination Place': visit.place || '—',
      'Reason': visit.reason || '—',
      'Leave Date': visit.leave_date || '—',
      'Return Date': visit.return_date || '—',
      'Home Out Time': outTimeStr,
      'Home In Time': inTimeStr,
      'Status': statusStr,
      'Returned': visit.qr_used_in ? 'Yes' : (visit.actual_in_time ? 'Yes' : 'No'),
      'Parent Contact': student?.parentPhone || visit.parent_phone || '—',
      'Staff / Guard': scannedByName,
      'Record ID': String(visit._id || ''),
    };
  });
};

/**
 * Generate and download an Excel spreadsheet (.xlsx or .csv) from Gate & Home visit logs
 *
 * @param {Object} options
 * @param {Array} options.gateLogs - Array of raw gate scan logs
 * @param {Array} options.homeLogs - Array of raw home visit logs
 * @param {Object} options.user - Current logged in user
 * @param {string} options.dateFilter - Currently active date filter
 * @param {string} options.activeTab - 'gate' or 'home'
 * @param {string} options.exportScope - 'current' | 'gate' | 'home' | 'all' | 'csv'
 * @param {string} [options.customFileName] - Optional file name
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

  // If no records in chosen scope
  if (addedSheets === 0) {
    throw new Error('No records available in the selected scope to export.');
  }

  // Add Summary Audit Sheet for professional institutional records
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
