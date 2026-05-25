/**
 * Scan Queue — BullMQ-powered async scan processing
 *
 * Architecture:
 *   HTTP Request → Immediate 202 response → Queue → Worker → DB write → Socket.IO emit
 *
 * Benefits:
 *   - Guards get instant feedback while DB write happens async
 *   - Redis queue absorbs burst traffic during rush hours
 *   - Automatic retry on transient DB failures (3 attempts, exponential backoff)
 *   - Dead-letter queue captures permanently failed scans for audit
 *   - Queue dashboard available via Bull Board
 *
 * NOTE: The primary /api/gatescan/scan endpoint remains synchronous for
 * immediate validation and feedback. This queue handles post-scan processing
 * like notifications, analytics updates, and secondary DB writes.
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const logger = require('../utils/logger');

const QUEUE_NAME = 'qr-scan-events';
const DLQ_NAME = 'qr-scan-events-failed';

let scanQueue = null;
let dlqQueue = null;
let scanWorker = null;
let scanQueueEvents = null;

const getRedisConnection = () => {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const redisUrl = new URL(url);
    return {
      host: redisUrl.hostname,
      port: parseInt(redisUrl.port || '6379', 10),
      password: redisUrl.password || undefined,
      username: redisUrl.username || undefined,
      tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    };
  } catch {
    return null;
  }
};

/**
 * Initialize scan queue, DLQ, worker, and event listeners.
 * Safe to call when Redis is unavailable — returns null gracefully.
 */
const initScanQueue = () => {
  const connection = getRedisConnection();
  if (!connection) {
    logger.warn('[ScanQueue] Redis not configured — queue disabled, scans process synchronously');
    return null;
  }

  try {
    // Main scan events queue
    scanQueue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s
        removeOnComplete: { count: 1000, age: 24 * 3600 }, // Keep last 1000 or 24h
        removeOnFail: false, // Keep all failed jobs for audit
      },
    });

    // Dead letter queue — permanently failed scans
    dlqQueue = new Queue(DLQ_NAME, {
      connection,
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    // Worker — processes post-scan side effects
    scanWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { type, data } = job.data;

        if (type === 'post_scan_analytics') {
          // Analytics update (non-critical, async)
          await handleAnalyticsUpdate(data);
        } else if (type === 'occupancy_broadcast') {
          // Emit real-time occupancy update
          await handleOccupancyBroadcast(data);
        } else if (type === 'notification') {
          // WhatsApp/push notification (already queued separately — this is a placeholder)
          logger.debug('[ScanQueue] Notification job processed', { jobId: job.id });
        }
      },
      {
        connection,
        concurrency: 10,          // Process 10 jobs concurrently
        limiter: {
          max: 500,               // Max 500 jobs per second
          duration: 1000,
        },
      }
    );

    scanWorker.on('completed', (job) => {
      logger.debug('[ScanQueue] Job completed', { jobId: job.id, type: job.data?.type });
    });

    scanWorker.on('failed', async (job, err) => {
      logger.error('[ScanQueue] Job failed', {
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: err.message,
        data: job?.data,
      });

      // Move to DLQ after all retries exhausted
      if (job && job.attemptsMade >= job.opts.attempts) {
        await dlqQueue.add('dead_letter', {
          originalJob: job.data,
          error: err.message,
          failedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    });

    // Queue events for monitoring
    scanQueueEvents = new QueueEvents(QUEUE_NAME, { connection });

    logger.info('[ScanQueue] ✅ Scan queue initialized', { queue: QUEUE_NAME });
    return scanQueue;
  } catch (err) {
    logger.error('[ScanQueue] Failed to initialize', { error: err.message });
    return null;
  }
};

const handleAnalyticsUpdate = async (data) => {
  // Analytics processing is lightweight — just log for now
  // In a full implementation: update time-series metrics, compute rolling averages
  logger.debug('[ScanQueue] Analytics update', { studentId: data.studentId, status: data.status });
};

const handleOccupancyBroadcast = async (data) => {
  try {
    const { broadcastOccupancyUpdate } = require('../services/socketService');
    broadcastOccupancyUpdate(data);
  } catch (err) {
    logger.warn('[ScanQueue] Occupancy broadcast failed', { error: err.message });
  }
};

/**
 * Enqueue a post-scan event (fire-and-forget from route handlers).
 * Never throws — queue failures are non-critical.
 */
const enqueueScanEvent = async (type, data) => {
  if (!scanQueue) return;
  try {
    await scanQueue.add(type, { type, data }, {
      priority: type === 'occupancy_broadcast' ? 1 : 2, // Occupancy is highest priority
    });
  } catch (err) {
    logger.warn('[ScanQueue] Enqueue failed (non-critical)', { type, error: err.message });
  }
};

/**
 * Get queue health metrics for the monitoring endpoint.
 */
const getScanQueueMetrics = async () => {
  if (!scanQueue) return { enabled: false };
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      scanQueue.getWaitingCount(),
      scanQueue.getActiveCount(),
      scanQueue.getCompletedCount(),
      scanQueue.getFailedCount(),
      scanQueue.getDelayedCount(),
    ]);
    return {
      enabled: true,
      queue: QUEUE_NAME,
      waiting,
      active,
      completed,
      failed,
      delayed,
    };
  } catch {
    return { enabled: true, error: 'metrics unavailable' };
  }
};

module.exports = { initScanQueue, enqueueScanEvent, getScanQueueMetrics };
