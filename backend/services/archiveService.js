/**
 * Archive Service
 * Handles MongoDB record streaming export, gzip compression, Cloudflare R2 upload,
 * metadata verification, safe batch deletion, and historical record retrieval.
 */

const zlib = require('zlib');
const crypto = require('crypto');
const mongoose = require('mongoose');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const Complaint = require('../models/Complaint');
const ArchiveJob = require('../models/ArchiveJob');
const AuditLog = require('../models/AuditLog');
const {
  uploadArchiveObject,
  getArchiveObjectMetadata,
  getArchiveObjectStream,
  getArchiveObjectBuffer,
  getPresignedDownloadUrl,
} = require('./r2Service');
const logger = require('../utils/logger');

const MODEL_MAP = {
  InOutLog: InOutLog,
  HomeVisitLog: HomeVisitLog,
  Complaint: Complaint,
};

const SLUG_MAP = {
  InOutLog: 'inout-logs',
  HomeVisitLog: 'home-visits',
  Complaint: 'complaints',
};

/**
 * Calculate Period Boundaries for a given YYYY-MM month string
 */
const getPeriodBoundaries = (yearMonthStr) => {
  const [year, month] = yearMonthStr.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
};

/**
 * Determine eligible months prior to retention threshold
 */
const getEligibleArchiveMonths = (retentionMonths = 3) => {
  const now = new Date();
  const months = [];
  // Go back up to 24 months, check if month end is older than retention threshold
  const thresholdDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - retentionMonths, 1));

  for (let i = retentionMonths + 1; i <= retentionMonths + 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const yearMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    months.push(yearMonth);
  }
  return months;
};

/**
 * Build MongoDB Query Filter for Eligible Archived Records
 */
const buildEligibilityFilter = (collectionName, periodStart, periodEnd) => {
  if (collectionName === 'InOutLog') {
    // Only completed entries (student came back IN or processed)
    return {
      $or: [
        { timestamp: { $gte: periodStart, $lt: periodEnd } },
        { createdAt: { $gte: periodStart, $lt: periodEnd } },
      ],
      returned: true, // Never archive active/unreturned logs
    };
  }

  if (collectionName === 'HomeVisitLog') {
    // Only finalized home visit passes
    return {
      $or: [
        { createdAt: { $gte: periodStart, $lt: periodEnd } },
        { return_date: { $gte: periodStart.toISOString().split('T')[0], $lt: periodEnd.toISOString().split('T')[0] } },
      ],
      overall_status: { $in: ['completed', 'rejected'] },
      qr_used_in: true, // Never archive active or unreturned passes
    };
  }

  if (collectionName === 'Complaint') {
    // Only resolved complaints
    return {
      $or: [
        { timestamp: { $gte: periodStart, $lt: periodEnd } },
        { createdAt: { $gte: periodStart, $lt: periodEnd } },
      ],
      status: 'resolved', // Never archive pending or in_progress complaints
    };
  }

  throw new Error(`Unsupported collection: ${collectionName}`);
};

/**
 * Format Storage Key: YYYY/MM/<slug>-YYYY-MM.json.gz
 */
const getStorageKey = (collectionName, yearMonthStr) => {
  const [year, month] = yearMonthStr.split('-');
  const slug = SLUG_MAP[collectionName] || collectionName.toLowerCase();
  return `${year}/${month}/${slug}-${yearMonthStr}.json.gz`;
};

/**
 * Format Archive ID: <collection-short>-YYYY-MM
 */
const getArchiveId = (collectionName, yearMonthStr) => {
  const prefix = collectionName.toLowerCase().replace('log', '');
  return `${prefix}-${yearMonthStr}`;
};

/**
 * Create Audit Log Entry
 */
const logAudit = async (event, data = {}) => {
  try {
    await AuditLog.create({
      event,
      archiveId: data.archiveId || null,
      collectionName: data.collectionName || null,
      recordCount: data.recordCount || 0,
      result: data.result || 'SUCCESS',
      error: data.error || null,
      userId: data.userId || null,
      details: data.details || {},
    });
  } catch (err) {
    logger.warn('[Archive Audit] Failed to create audit log', { error: err.message });
  }
};

/**
 * Stream & Compress Records from MongoDB to JSON.gz Buffer
 */
const exportAndCompressRecords = async (Model, filter) => {
  const records = [];
  const cursor = Model.find(filter).lean().cursor();

  for await (const doc of cursor) {
    records.push(doc);
  }

  const recordCount = records.length;
  if (recordCount === 0) {
    return { recordCount: 0, compressedBuffer: null, checksum: null, recordIds: [] };
  }

  const recordIds = records.map((r) => r._id);
  const jsonString = JSON.stringify(records);
  const compressedBuffer = zlib.gzipSync(Buffer.from(jsonString, 'utf-8'));
  const checksum = crypto.createHash('sha256').update(compressedBuffer).digest('hex');

  return {
    recordCount,
    compressedBuffer,
    checksum,
    recordIds,
    uncompressedSize: Buffer.byteLength(jsonString, 'utf-8'),
    compressedSize: compressedBuffer.length,
  };
};

/**
 * Execute Full Safe Archival Workflow
 */
const processArchiveJob = async ({ collectionName, yearMonthStr, userId = null }) => {
  const Model = MODEL_MAP[collectionName];
  if (!Model) throw new Error(`Invalid collection: ${collectionName}`);

  const { start: periodStart, end: periodEnd } = getPeriodBoundaries(yearMonthStr);
  const archiveId = getArchiveId(collectionName, yearMonthStr);
  const storageKey = getStorageKey(collectionName, yearMonthStr);

  // Check existing job status for idempotency
  let job = await ArchiveJob.findOne({ archiveId });

  if (job && job.status === 'COMPLETED') {
    logger.info('[Archive] Job already completed, skipping', { archiveId });
    return job;
  }

  // Handle resume if verification already passed previously
  if (job && (job.status === 'VERIFIED' || job.status === 'DELETING')) {
    logger.info('[Archive] Resuming verified archive deletion', { archiveId });
    return resumeDeletionStage(job, Model, periodStart, periodEnd);
  }

  if (!job) {
    job = await ArchiveJob.create({
      archiveId,
      collectionName,
      periodStart,
      periodEnd,
      status: 'PENDING',
      storageKey,
      startedAt: new Date(),
    });
  }

  job.status = 'PROCESSING';
  job.startedAt = new Date();
  job.failureReason = null;
  await job.save();

  await logAudit('ARCHIVE_STARTED', { archiveId, collectionName, userId });

  try {
    const filter = buildEligibilityFilter(collectionName, periodStart, periodEnd);
    const { recordCount, compressedBuffer, checksum, recordIds, compressedSize } =
      await exportAndCompressRecords(Model, filter);

    if (recordCount === 0) {
      job.status = 'COMPLETED';
      job.completedAt = new Date();
      job.recordCount = 0;
      job.compressedSize = 0;
      job.checksum = 'empty';
      await job.save();
      await logAudit('ARCHIVE_COMPLETED', { archiveId, collectionName, recordCount: 0, userId });
      return job;
    }

    job.recordCount = recordCount;
    job.compressedSize = compressedSize;
    job.checksum = checksum;

    // Upload to Cloudflare R2
    const uploadRes = await uploadArchiveObject({
      storageKey,
      buffer: compressedBuffer,
      contentType: 'application/gzip',
    });

    job.status = 'UPLOADED';
    await job.save();
    await logAudit('ARCHIVE_UPLOADED', { archiveId, collectionName, recordCount, userId });

    // Step 7-10: Verify R2 Object and Metadata
    const metadata = await getArchiveObjectMetadata(storageKey);
    if (!metadata.exists) {
      throw new Error(`R2 upload verification failed — object not found at key ${storageKey}`);
    }

    if (metadata.size !== compressedSize) {
      throw new Error(
        `R2 size mismatch: expected ${compressedSize} bytes, R2 returned ${metadata.size} bytes`
      );
    }

    job.status = 'VERIFIED';
    job.verifiedAt = new Date();
    await job.save();
    await logAudit('ARCHIVE_VERIFIED', { archiveId, collectionName, recordCount, userId });

    // Step 12-14: Delete ONLY successfully verified records
    job.status = 'DELETING';
    await job.save();
    await logAudit('ARCHIVE_DELETE_STARTED', { archiveId, collectionName, recordCount, userId });

    const deleteResult = await deleteArchivedRecordsInBatches(Model, recordIds, filter);

    job.deletedCount = deleteResult.deletedCount;
    job.status = 'COMPLETED';
    job.completedAt = new Date();
    await job.save();

    await logAudit('ARCHIVE_DELETE_COMPLETED', {
      archiveId,
      collectionName,
      recordCount: deleteResult.deletedCount,
      userId,
    });

    await logAudit('ARCHIVE_COMPLETED', {
      archiveId,
      collectionName,
      recordCount,
      userId,
    });

    return job;
  } catch (error) {
    logger.error('[Archive] Archival failed, records preserved in MongoDB', {
      archiveId,
      error: error.message,
    });

    job.status = 'FAILED';
    job.failureReason = error.message;
    job.retryCount = (job.retryCount || 0) + 1;
    await job.save();

    await logAudit('ARCHIVE_FAILED', {
      archiveId,
      collectionName,
      result: 'FAILED',
      error: error.message,
      userId,
    });

    throw error;
  }
};

/**
 * Batch Deletion Helper (Safe and Recoverable)
 */
const deleteArchivedRecordsInBatches = async (Model, recordIds, filter, batchSize = 1000) => {
  let deletedCount = 0;

  if (recordIds && recordIds.length > 0) {
    for (let i = 0; i < recordIds.length; i += batchSize) {
      const chunk = recordIds.slice(i, i + batchSize);
      const res = await Model.deleteMany({ _id: { $in: chunk } });
      deletedCount += res.deletedCount || 0;
    }
  } else {
    const res = await Model.deleteMany(filter);
    deletedCount = res.deletedCount || 0;
  }

  return { deletedCount };
};

/**
 * Resume Deletion for a Verified Job
 */
const resumeDeletionStage = async (job, Model, periodStart, periodEnd) => {
  job.status = 'DELETING';
  await job.save();

  const filter = buildEligibilityFilter(job.collectionName, periodStart, periodEnd);
  const deleteResult = await Model.deleteMany(filter);

  job.deletedCount = (job.deletedCount || 0) + (deleteResult.deletedCount || 0);
  job.status = 'COMPLETED';
  job.completedAt = new Date();
  await job.save();

  await logAudit('ARCHIVE_COMPLETED', {
    archiveId: job.archiveId,
    collectionName: job.collectionName,
    recordCount: job.deletedCount,
  });

  return job;
};

/**
 * Search Historical Records Inside Archived `.json.gz` Files in R2
 */
const searchArchivedRecords = async ({ yearMonthStr, collectionName, searchTarget, userId }) => {
  const storageKey = getStorageKey(collectionName, yearMonthStr);
  const archiveId = getArchiveId(collectionName, yearMonthStr);

  const buffer = await getArchiveObjectBuffer(storageKey);
  const decompressed = zlib.gunzipSync(buffer).toString('utf-8');
  const records = JSON.parse(decompressed);

  const needle = String(searchTarget || '').trim().toLowerCase();
  const matched = needle
    ? records.filter((r) =>
        [r.name, r.rollNo, r.phone, r.email, r.student_id, r.place, r.reason]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(needle))
      )
    : records;

  await logAudit('ARCHIVE_RETRIEVED', {
    archiveId,
    collectionName,
    recordCount: matched.length,
    userId,
    details: { searchTarget, totalInArchive: records.length },
  });

  return {
    archiveId,
    collectionName,
    yearMonthStr,
    totalRecordsInArchive: records.length,
    matchedRecordsCount: matched.length,
    records: matched.slice(0, 200), // Limit returned results
  };
};

module.exports = {
  processArchiveJob,
  getEligibleArchiveMonths,
  getPeriodBoundaries,
  getStorageKey,
  getArchiveId,
  searchArchivedRecords,
  logAudit,
};
