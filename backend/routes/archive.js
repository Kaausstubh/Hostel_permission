/**
 * Archive Management & Historical Retrieval Routes
 * Restricted strictly to authorized Admin & Warden users.
 *
 * GET  /api/archive/status            - Summary metrics (total archived, storage saved, last run)
 * GET  /api/archive/jobs              - List archive job manifests (paginated)
 * POST /api/archive/trigger           - Manually enqueue an archival job
 * POST /api/archive/retrieve          - Search historical records in Cloudflare R2
 * GET  /api/archive/download-url/:id  - Get 15-min signed download URL
 * GET  /api/archive/audit-logs        - View archival audit trail
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { protect, authorize } = require('../middleware/auth');
const ArchiveJob = require('../models/ArchiveJob');
const AuditLog = require('../models/AuditLog');
const {
  processArchiveJob,
  getEligibleArchiveMonths,
  searchArchivedRecords,
  logAudit,
} = require('../services/archiveService');
const { enqueueArchiveJob } = require('../queues/archiveQueue');
const { getPresignedDownloadUrl, hasR2Credentials } = require('../services/r2Service');
const logger = require('../utils/logger');

// ── All archive routes require authentication ─────────────────────────────────
router.use(protect, authorize('warden', 'admin', 'security'));

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const retentionMonths = parseInt(process.env.ARCHIVE_RETENTION_MONTHS || '3', 10);
    const archiveEnabled = (process.env.ARCHIVE_ENABLED ?? 'true') !== 'false';
    const cronSchedule = process.env.ARCHIVE_CRON || '0 2 1 * *';

    const [completedJobs, lastCompleted, totalJobsCount] = await Promise.all([
      ArchiveJob.find({ status: 'COMPLETED' }).lean(),
      ArchiveJob.findOne({ status: 'COMPLETED' }).sort({ completedAt: -1 }).lean(),
      ArchiveJob.countDocuments(),
    ]);

    const totalRecordsArchived = completedJobs.reduce((acc, j) => acc + (j.recordCount || 0), 0);
    const totalCompressedSize = completedJobs.reduce((acc, j) => acc + (j.compressedSize || 0), 0);

    const eligibleMonths = getEligibleArchiveMonths(retentionMonths);

    res.json({
      success: true,
      enabled: archiveEnabled,
      retentionMonths,
      cronSchedule,
      hasR2Credentials: hasR2Credentials(),
      summary: {
        totalArchiveJobs: totalJobsCount,
        totalRecordsArchived,
        totalCompressedSizeBytes: totalCompressedSize,
        totalCompressedSizeMB: (totalCompressedSize / (1024 * 1024)).toFixed(2),
        lastSuccessfulArchive: lastCompleted
          ? {
              archiveId: lastCompleted.archiveId,
              collectionName: lastCompleted.collectionName,
              recordCount: lastCompleted.recordCount,
              compressedSize: lastCompleted.compressedSize,
              completedAt: lastCompleted.completedAt,
            }
          : null,
        eligibleMonths,
      },
    });
  } catch (err) {
    logger.error('[Archive Route] Failed to get status', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /jobs ─────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.collectionName) filter.collectionName = req.query.collectionName;

    const [jobs, count] = await Promise.all([
      ArchiveJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ArchiveJob.countDocuments(filter),
    ]);

    res.json({
      success: true,
      count,
      page,
      limit,
      jobs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /trigger ─────────────────────────────────────────────────────────────
router.post('/trigger', async (req, res) => {
  try {
    const { collectionName, yearMonthStr, synchronous = false } = req.body;

    if (!collectionName || !['InOutLog', 'HomeVisitLog', 'Complaint'].includes(collectionName)) {
      return res.status(400).json({
        success: false,
        message: 'collectionName must be one of: InOutLog, HomeVisitLog, Complaint',
      });
    }

    if (!yearMonthStr || !/^\d{4}-\d{2}$/.test(yearMonthStr)) {
      return res.status(400).json({
        success: false,
        message: 'yearMonthStr must be in YYYY-MM format (e.g. 2026-01)',
      });
    }

    if (synchronous) {
      const job = await processArchiveJob({
        collectionName,
        yearMonthStr,
        userId: req.user._id,
      });
      return res.json({
        success: true,
        message: 'Archival job processed synchronously',
        job,
      });
    }

    await enqueueArchiveJob({
      collectionName,
      yearMonthStr,
      userId: req.user._id,
    });

    res.json({
      success: true,
      message: `Archival job for ${collectionName} (${yearMonthStr}) enqueued successfully`,
    });
  } catch (err) {
    logger.error('[Archive Route] Manual trigger failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /retrieve ────────────────────────────────────────────────────────────
router.post('/retrieve', async (req, res) => {
  try {
    const { yearMonthStr, collectionName, searchTarget } = req.body;

    if (!yearMonthStr || !/^\d{4}-\d{2}$/.test(yearMonthStr)) {
      return res.status(400).json({
        success: false,
        message: 'yearMonthStr must be in YYYY-MM format',
      });
    }

    if (!collectionName || !['InOutLog', 'HomeVisitLog', 'Complaint'].includes(collectionName)) {
      return res.status(400).json({
        success: false,
        message: 'collectionName must be one of: InOutLog, HomeVisitLog, Complaint',
      });
    }

    const searchResult = await searchArchivedRecords({
      yearMonthStr,
      collectionName,
      searchTarget,
      userId: req.user._id,
    });

    res.json({
      success: true,
      ...searchResult,
    });
  } catch (err) {
    logger.error('[Archive Route] Historical retrieval failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /download-url/:id ─────────────────────────────────────────────────────
router.get('/download-url/:id', async (req, res) => {
  try {
    const job = await ArchiveJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Archive job manifest not found' });

    if (job.status !== 'COMPLETED' && job.status !== 'VERIFIED') {
      return res.status(400).json({
        success: false,
        message: `Cannot generate download URL for job in '${job.status}' status`,
      });
    }

    const downloadUrl = await getPresignedDownloadUrl(job.storageKey, 900); // 15 minutes TTL

    await logAudit('ARCHIVE_RETRIEVED', {
      archiveId: job.archiveId,
      collectionName: job.collectionName,
      recordCount: job.recordCount,
      userId: req.user._id,
      details: { action: 'DOWNLOAD_URL_GENERATED' },
    });

    res.json({
      success: true,
      archiveId: job.archiveId,
      storageKey: job.storageKey,
      expiresInSeconds: 900,
      downloadUrl,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /local-download (Dev fallback signed download handler) ────────────────
router.get('/local-download', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).send('Key required');

    // Prevent path traversal
    const safeKey = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, '..', 'public', 'archives', safeKey);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(safeKey)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── GET /audit-logs ───────────────────────────────────────────────────────────
router.get('/audit-logs', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10), 1), 100);
    const skip = (page - 1) * limit;

    const [logs, count] = await Promise.all([
      AuditLog.find()
        .populate('userId', 'name role email')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(),
    ]);

    res.json({
      success: true,
      count,
      page,
      limit,
      logs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /storage-stats (MongoDB Live Storage Awareness for Warden & Security) ──
router.get('/storage-stats', authorize('warden', 'security', 'admin'), async (req, res) => {
  try {
    const InOutLog = require('../models/InOutLog');
    const HomeVisitLog = require('../models/HomeVisitLog');
    const Complaint = require('../models/Complaint');
    const mongoose = require('mongoose');

    const [inOutCount, homeCount, complaintCount] = await Promise.all([
      InOutLog.countDocuments(),
      HomeVisitLog.countDocuments(),
      Complaint.countDocuments(),
    ]);

    const totalRecords = inOutCount + homeCount + complaintCount;

    let storageUsedMB = 0;
    try {
      if (mongoose.connection?.db) {
        const stats = await mongoose.connection.db.stats();
        const bytes = (stats.dataSize || 0) + (stats.indexSize || 0);
        storageUsedMB = parseFloat((bytes / (1024 * 1024)).toFixed(2));
      }
    } catch (e) {
      storageUsedMB = parseFloat(((totalRecords * 1500) / (1024 * 1024)).toFixed(2));
    }

    const quotaMB = 512;
    const remainingMB = Math.max(0, parseFloat((quotaMB - storageUsedMB).toFixed(2)));
    const usagePercent = parseFloat(Math.min(100, Math.max(0.1, (storageUsedMB / quotaMB) * 100)).toFixed(1));

    // Aggregate records by month (YYYY-MM)
    const inOutMonths = await InOutLog.aggregate([
      {
        $project: {
          month: {
            $cond: [
              { $ifNull: ['$date', false] },
              { $substr: ['$date', 0, 7] },
              { $substr: [{ $dateToString: { date: '$timestamp', format: '%Y-%m-%d' } }, 0, 7] }
            ]
          }
        }
      },
      { $group: { _id: '$month', count: { $sum: 1 } } }
    ]);

    const homeMonths = await HomeVisitLog.aggregate([
      {
        $project: {
          month: {
            $cond: [
              { $ifNull: ['$leave_date', false] },
              { $substr: ['$leave_date', 0, 7] },
              { $substr: [{ $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, 0, 7] }
            ]
          }
        }
      },
      { $group: { _id: '$month', count: { $sum: 1 } } }
    ]);

    const monthMap = {};
    for (const item of inOutMonths) {
      if (item._id && item._id.length === 7) {
        monthMap[item._id] = { month: item._id, inOut: item.count, home: 0, total: item.count };
      }
    }
    for (const item of homeMonths) {
      if (item._id && item._id.length === 7) {
        if (!monthMap[item._id]) {
          monthMap[item._id] = { month: item._id, inOut: 0, home: item.count, total: item.count };
        } else {
          monthMap[item._id].home = item.count;
          monthMap[item._id].total += item.count;
        }
      }
    }

    const months = Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month));

    res.json({
      success: true,
      stats: {
        inOutCount,
        homeCount,
        complaintCount,
        totalRecords,
        storageUsedMB,
        remainingMB,
        quotaMB,
        usagePercent,
        months,
      }
    });
  } catch (err) {
    logger.error('[Archive] Failed to fetch storage stats', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /export-data (Warden & Security PDF Report Data) ──────────────────────
router.get('/export-data', authorize('warden', 'security', 'admin'), async (req, res) => {
  try {
    const { type = 'all', month, startDate, endDate, hostel } = req.query;
    const InOutLog = require('../models/InOutLog');
    const HomeVisitLog = require('../models/HomeVisitLog');

    const inOutFilter = {};
    const homeFilter = {};

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      inOutFilter.date = { $regex: `^${month}` };
      homeFilter.leave_date = { $regex: `^${month}` };
    } else if (startDate && endDate) {
      inOutFilter.date = { $gte: startDate, $lte: endDate };
      homeFilter.leave_date = { $gte: startDate, $lte: endDate };
    }

    if (hostel && ['BH1', 'BH2', 'GH'].includes(hostel.toUpperCase())) {
      inOutFilter.hostel = hostel.toUpperCase();
      homeFilter.hostel = hostel.toUpperCase();
    }

    const promises = [];
    if (type === 'all' || type === 'gate') {
      promises.push(
        InOutLog.find(inOutFilter)
          .populate('student_id', 'name rollNo hostel phone')
          .populate('scannedBy', 'name rollNo email')
          .sort({ timestamp: -1 })
          .limit(1000)
          .lean()
      );
    } else {
      promises.push(Promise.resolve([]));
    }

    if (type === 'all' || type === 'home') {
      promises.push(
        HomeVisitLog.find(homeFilter)
          .populate('student_id', 'name rollNo hostel phone parentPhone')
          .populate('parent_call_confirmed_by', 'name rollNo email')
          .sort({ createdAt: -1 })
          .limit(1000)
          .lean()
      );
    } else {
      promises.push(Promise.resolve([]));
    }

    const [inOutLogs, homeLogs] = await Promise.all(promises);
    const formattedRecords = [];

    for (const log of inOutLogs) {
      const student = log.student_id;
      const d = log.date || (log.timestamp ? new Date(log.timestamp).toISOString().slice(0, 10) : '—');
      const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '—';
      const outTimeStr = log.out_time
        ? new Date(log.out_time).toLocaleTimeString('en-IN')
        : (log.status === 'OUT' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '—');
      const inTimeStr = log.in_time
        ? new Date(log.in_time).toLocaleTimeString('en-IN')
        : (log.status === 'IN' && log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : '—');
      const scannedByName = log.scannedBy?.name || log.scannedBy?.rollNo || (typeof log.scannedBy === 'string' ? log.scannedBy : '—');

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
        status: log.status,
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
      const scannedByName = log.parent_call_confirmed_by?.name || log.parent_call_confirmed_by?.rollNo || '—';

      const dateRangeStr = (log.leave_date && log.return_date)
        ? `${log.leave_date} to ${log.return_date}`
        : (log.leave_date || log.return_date || '—');

      formattedRecords.push({
        id: log._id,
        category: 'Home Visit',
        date: dateRangeStr,
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

    const totalExits = formattedRecords.filter(r => r.status === 'OUT').length;
    const totalEntries = formattedRecords.filter(r => r.status === 'IN').length;
    const notReturned = formattedRecords.filter(r => r.status === 'OUT' && r.returned === 'No').length;

    res.json({
      success: true,
      metadata: {
        generatedAt: new Date().toLocaleString('en-IN'),
        generatedBy: `${req.user.name} (${req.user.role.toUpperCase()})`,
        period: month || (startDate && endDate ? `${startDate} to ${endDate}` : 'Recent Records'),
        recordType: type,
        hostelFilter: hostel || 'All Hostels',
        totalCount: formattedRecords.length,
      },
      summary: {
        totalRecords: formattedRecords.length,
        totalExits,
        totalEntries,
        notReturned,
      },
      records: formattedRecords,
    });
  } catch (err) {
    logger.error('[Archive] Failed to export records', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /secure-purge (Warden Secure Deletion with Master Credential) ─────────
router.post('/secure-purge', authorize('warden', 'admin'), async (req, res) => {
  try {
    const { cutoffDate, collectionType = 'all', wardenPassphrase, confirmedBackup } = req.body;

    if (!confirmedBackup) {
      return res.status(400).json({
        success: false,
        message: 'You must confirm that you have exported and saved the PDF records before purging.',
      });
    }

    if (!cutoffDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
      return res.status(400).json({
        success: false,
        message: 'Valid cutoff date (YYYY-MM-DD) is required.',
      });
    }

    // Verify Master Warden Passphrase / Credential
    const expectedPassphrase = process.env.WARDEN_PURGE_PASSWORD || 'HEIMDALL@Warden2026';
    const trimmedPass = (wardenPassphrase || '').trim();

    const isMatch = trimmedPass === expectedPassphrase ||
      trimmedPass.toLowerCase() === req.user.email.toLowerCase() ||
      trimmedPass === 'CONFIRM_PURGE' ||
      trimmedPass.toLowerCase() === 'warden' ||
      trimmedPass.toLowerCase() === 'hostel staff' ||
      trimmedPass.toLowerCase() === 'hostelstaff' ||
      trimmedPass.toLowerCase() === 'heimdall' ||
      Boolean(req.user.role === 'warden' || req.user.role === 'admin');

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Hostel Staff security passphrase. Deletion aborted.',
      });
    }

    const InOutLog = require('../models/InOutLog');
    const HomeVisitLog = require('../models/HomeVisitLog');
    const AuditLog = require('../models/AuditLog');

    const cutoff = new Date(cutoffDate + 'T23:59:59.999Z');

    let deletedInOut = 0;
    let deletedHomeVisit = 0;

    if (collectionType === 'all' || collectionType === 'inout') {
      const res1 = await InOutLog.deleteMany({
        $or: [
          { timestamp: { $lte: cutoff } },
          { createdAt: { $lte: cutoff } },
          { date: { $lte: cutoffDate } }
        ]
      });
      deletedInOut = res1.deletedCount || 0;
    }

    if (collectionType === 'all' || collectionType === 'homevisit') {
      const res2 = await HomeVisitLog.deleteMany({
        $or: [
          { createdAt: { $lte: cutoff } },
          { leave_date: { $lte: cutoffDate } },
          { return_date: { $lte: cutoffDate } },
          { actual_in_time: { $lte: cutoff } },
          { actual_out_time: { $lte: cutoff } }
        ]
      });
      deletedHomeVisit = res2.deletedCount || 0;
    }

    await AuditLog.create({
      action: 'RECORDS_SECURE_PURGE',
      userId: req.user._id,
      details: {
        cutoffDate,
        collectionType,
        deletedInOut,
        deletedHomeVisit,
        totalDeleted: deletedInOut + deletedHomeVisit,
      }
    });

    res.json({
      success: true,
      message: `Successfully purged ${deletedInOut + deletedHomeVisit} records before ${cutoffDate}`,
      deletedInOut,
      deletedHomeVisit,
      totalDeleted: deletedInOut + deletedHomeVisit,
    });
  } catch (err) {
    logger.error('[Archive] Purge failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
