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
  const officerRole = (['warden', 'hostel_staff'].includes(user?.role) ? 'HOSTEL STAFF' : (user?.role || 'Staff')).toUpperCase();
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
 * Export Attendance Records to Excel (.xlsx)
 */
export const exportAttendanceToExcel = async ({
  records = [],
  startDate = '',
  endDate = '',
  hostel = 'ALL',
  floor = 'ALL',
  customFileName,
}) => {
  if (!records || records.length === 0) {
    throw new Error('No attendance records available to export.');
  }

  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();

  const formattedRows = records.map((r, index) => {
    const student = r.student || {};
    const statusLabel =
      r.status === 'present'
        ? 'PRESENT'
        : r.status === 'on_leave'
        ? 'ON LEAVE'
        : 'ABSENT';
    const methodLabel =
      r.method === 'self_approved' || r.method === 'qr_geofence'
        ? 'GPS Geofence'
        : 'Staff Override';

    return {
      'S.No': index + 1,
      'Date': r.date || '—',
      'Session': r.session || 'Night Attendance',
      'Hostel': getHostelLabel(r.hostel),
      'Floor': r.floor || '—',
      'Room Number': r.roomNo || '—',
      'Student Name': student.name || 'Unknown',
      'Roll / MIS Number': student.rollNo || '—',
      'Attendance Status': statusLabel,
      'Verification Method': methodLabel,
      'Verified By': r.verifiedBy || 'Self-Approved',
      'Remarks / Reason': r.remark || '—',
      'Recorded Timestamp': r.createdAt
        ? new Date(r.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : '—',
    };
  });

  const wsRecords = XLSX.utils.json_to_sheet(formattedRows);
  wsRecords['!cols'] = autoFitColumns(formattedRows, 14);
  XLSX.utils.book_append_sheet(wb, wsRecords, 'Attendance Records');

  // Summary Sheet
  const presentCount = records.filter((r) => r.status === 'present').length;
  const absentCount = records.filter((r) => r.status === 'absent').length;
  const leaveCount = records.filter((r) => r.status === 'on_leave').length;
  const pct = records.length > 0 ? `${Math.round((presentCount / records.length) * 100)}%` : '0%';

  const summaryRows = [
    { 'Audit Property': 'INSTITUTION', 'Value': 'INDIAN INSTITUTE OF INFORMATION TECHNOLOGY, PUNE (IIITP)' },
    { 'Audit Property': 'SYSTEM', 'Value': 'HEIMDALL — Room Attendance Verification Module' },
    { 'Audit Property': 'REPORT TYPE', 'Value': 'Hostel Attendance Audit Roster' },
    { 'Audit Property': 'DATE RANGE', 'Value': `${startDate || 'Start'} to ${endDate || 'End'}` },
    { 'Audit Property': 'HOSTEL SCOPE', 'Value': hostel === 'ALL' ? 'All Hostels' : getHostelLabel(hostel) },
    { 'Audit Property': 'FLOOR SCOPE', 'Value': floor === 'ALL' ? 'All Floors' : floor },
    { 'Audit Property': 'GENERATED AT', 'Value': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) },
    { 'Audit Property': 'TOTAL RECORDS', 'Value': records.length },
    { 'Audit Property': 'STUDENTS PRESENT', 'Value': presentCount },
    { 'Audit Property': 'STUDENTS ABSENT', 'Value': absentCount },
    { 'Audit Property': 'STUDENTS ON APPROVED LEAVE', 'Value': leaveCount },
    { 'Audit Property': 'ATTENDANCE PERCENTAGE', 'Value': pct },
  ];

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Attendance Summary');

  const fileName =
    customFileName ||
    `IIITP_Attendance_Report_${startDate || 'all'}_to_${endDate || 'all'}.xlsx`;

  XLSX.writeFile(wb, fileName);
};

/**
 * Export Room Allocations to Excel (.xlsx)
 */
export const exportAllocationsToExcel = async ({
  hostel,
  rooms = [],
  customFileName,
}) => {
  if (!rooms || rooms.length === 0) {
    throw new Error('No rooms or allocations available to export.');
  }

  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();

  // 1. Student Allocations Sheet
  const allocationRows = [];
  let sNo = 1;

  for (const r of rooms) {
    const floorLabel = r.floor_id?.label || (r.floor !== undefined ? `Floor ${r.floor}` : '—');
    const occupants = r.occupants || [];

    if (occupants.length === 0) {
      allocationRows.push({
        'S.No': sNo++,
        'Hostel': hostel?.name || hostel?.code || '—',
        'Floor': floorLabel,
        'Room Number': r.room_number,
        'Bed Number': '—',
        'Student Name': '— (VACANT)',
        'Roll / MIS Number': '—',
        'Contact Phone': '—',
        'Room Capacity': r.capacity || 4,
        'Room Status': (r.status || 'vacant').toUpperCase(),
        'Allocated On': '—',
        'Allocation Source': '—',
      });
    } else {
      for (const occ of occupants) {
        const student = occ.student || {};
        allocationRows.push({
          'S.No': sNo++,
          'Hostel': hostel?.name || hostel?.code || '—',
          'Floor': floorLabel,
          'Room Number': r.room_number,
          'Bed Number': occ.bed_number || 'Bed 1',
          'Student Name': student.name || 'Unknown',
          'Roll / MIS Number': student.rollNo || '—',
          'Contact Phone': student.phone || '—',
          'Room Capacity': r.capacity || 4,
          'Room Status': (r.status || 'occupied').toUpperCase(),
          'Allocated On': occ.allocated_on
            ? new Date(occ.allocated_on).toISOString().split('T')[0]
            : '—',
          'Allocation Source': occ.source || 'system',
        });
      }
    }
  }

  const wsAlloc = XLSX.utils.json_to_sheet(allocationRows);
  wsAlloc['!cols'] = autoFitColumns(allocationRows, 14);
  XLSX.utils.book_append_sheet(wb, wsAlloc, 'Student Allocations');

  // 2. Room Inventory Summary Sheet
  const inventoryRows = rooms.map((r, index) => {
    const floorLabel = r.floor_id?.label || (r.floor !== undefined ? `Floor ${r.floor}` : '—');
    const occupantsCount = r.occupantsCount !== undefined ? r.occupantsCount : (r.occupants?.length || 0);
    const capacity = r.capacity || 4;
    const vacantBeds = Math.max(0, capacity - occupantsCount);
    const status = r.status || (occupantsCount >= capacity ? 'full' : (occupantsCount > 0 ? 'occupied' : 'vacant'));

    return {
      'S.No': index + 1,
      'Floor': floorLabel,
      'Room Number': r.room_number,
      'Capacity': capacity,
      'Occupants Count': occupantsCount,
      'Vacant Beds': vacantBeds,
      'Room Status': status.toUpperCase(),
      'Remarks': r.remarks || '—',
    };
  });

  const wsInventory = XLSX.utils.json_to_sheet(inventoryRows);
  wsInventory['!cols'] = autoFitColumns(inventoryRows, 14);
  XLSX.utils.book_append_sheet(wb, wsInventory, 'Room Inventory Summary');

  // 3. Metrics Sheet
  let totalCapacity = 0;
  let totalOccupants = 0;
  rooms.forEach((r) => {
    totalCapacity += r.capacity || 4;
    totalOccupants += r.occupantsCount !== undefined ? r.occupantsCount : (r.occupants?.length || 0);
  });
  const vacantBeds = Math.max(0, totalCapacity - totalOccupants);
  const occupancyRate = totalCapacity > 0 ? `${Math.round((totalOccupants / totalCapacity) * 100)}%` : '0%';

  const metricsRows = [
    { 'Property': 'INSTITUTION', 'Value': 'INDIAN INSTITUTE OF INFORMATION TECHNOLOGY, PUNE (IIITP)' },
    { 'Property': 'MODULE', 'Value': 'HEIMDALL — Room Allocation & Occupancy Management' },
    { 'Property': 'TARGET HOSTEL', 'Value': hostel?.name ? `${hostel.name} (${hostel.code})` : (hostel?.code || 'Hostel') },
    { 'Property': 'REPORT DATE', 'Value': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) },
    { 'Property': 'TOTAL ROOMS', 'Value': rooms.length },
    { 'Property': 'TOTAL BED CAPACITY', 'Value': totalCapacity },
    { 'Property': 'OCCUPIED BEDS', 'Value': totalOccupants },
    { 'Property': 'VACANT BEDS', 'Value': vacantBeds },
    { 'Property': 'OVERALL OCCUPANCY RATE', 'Value': occupancyRate },
  ];

  const wsMetrics = XLSX.utils.json_to_sheet(metricsRows);
  wsMetrics['!cols'] = [{ wch: 28 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsMetrics, 'Hostel Metrics');

  const fileName =
    customFileName ||
    `IIITP_Room_Allocations_${hostel?.code || 'Hostel'}_${new Date().toISOString().slice(0, 10)}.xlsx`;

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
  const officerRole = (['warden', 'hostel_staff'].includes(user?.role) ? 'HOSTEL STAFF' : (user?.role || 'Staff')).toUpperCase();
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

/**
 * Export official Excel spreadsheet of students residing in a hostel
 * Title: e.g. "BH2 Krishna Hostel Students"
 * Columns: Sr. No | Student Name | MIS / Roll Number | Hostel | Room Number | Bed Number | Floor | Academic Year | Contact Phone | Email
 */
export const exportHostelStudentsExcel = async ({
  hostelCode = 'BH2',
  hostelName = 'Krishna',
  students = [],
  customFileName = null,
}) => {
  if (!students || students.length === 0) {
    throw new Error('No students found to export.');
  }

  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new();

  const formattedRows = students.map((s, index) => {
    const mis = s.mis || s.rollNo || '—';
    let year = s.year;
    if (!year) {
      if (typeof mis === 'string' && mis.startsWith('1125')) year = '2nd Year';
      else if (typeof mis === 'string' && mis.startsWith('1124')) year = '3rd Year';
      else if (typeof mis === 'string' && mis.startsWith('1123')) year = '4th Year';
      else year = '—';
    }

    return {
      'Sr. No.': index + 1,
      'Student Name': sanitizeFormula(s.name || 'Unknown'),
      'MIS / Roll Number': sanitizeFormula(mis),
      'Hostel': sanitizeFormula(`${hostelCode} (${hostelName})`),
      'Room Number': sanitizeFormula(s.room || s.roomNumber || s.roomNo || 'Unassigned'),
      'Bed Number': sanitizeFormula(s.bedIndex ? `Bed ${s.bedIndex}` : s.bedNumber || '—'),
      'Floor': sanitizeFormula(s.floor || '—'),
      'Academic Year': sanitizeFormula(year),
      'Contact Phone': sanitizeFormula(s.phone || '—'),
      'Email': sanitizeFormula(s.email || (mis !== '—' ? `${mis}@cse.iiitp.ac.in` : '—')),
    };
  });

  const wsRoster = XLSX.utils.json_to_sheet(formattedRows);
  wsRoster['!cols'] = autoFitColumns(formattedRows, 14);
  const sheetTitle = `${hostelCode} Students Roster`.slice(0, 31);
  XLSX.utils.book_append_sheet(wb, wsRoster, sheetTitle);

  // Summary Sheet
  const summaryRows = [
    { 'Property': 'INSTITUTION', 'Details': 'Indian Institute of Information Technology, Pune (IIITP)' },
    { 'Property': 'HOSTEL CODE', 'Details': hostelCode },
    { 'Property': 'HOSTEL NAME', 'Details': `${hostelName} Residence` },
    { 'Property': 'REPORT TITLE', 'Details': `${hostelCode} ${hostelName} Hostel Students List` },
    { 'Property': 'TOTAL STUDENTS LISTED', 'Details': students.length },
    { 'Property': 'EXPORT GENERATED AT', 'Details': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 28 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Hostel Summary');

  const defaultFileName = `${hostelCode}_${hostelName.replace(/\s+/g, '_')}_Hostel_Students_Roster.xlsx`;
  XLSX.writeFile(wb, customFileName || defaultFileName);
};

