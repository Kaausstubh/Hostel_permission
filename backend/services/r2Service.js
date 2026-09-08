/**
 * Cloudflare R2 Storage Service (S3-Compatible)
 * Encapsulates bucket operations using AWS S3 SDK v3.
 *
 * Configured with:
 *  - R2_ACCOUNT_ID
 *  - R2_ACCESS_KEY_ID
 *  - R2_SECRET_ACCESS_KEY
 *  - R2_BUCKET_NAME (default: heimdall-archives)
 *  - R2_ENDPOINT (default: https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com)
 *
 * Features:
 *  - Upload gzipped buffer / stream to R2
 *  - Head object to verify size and presence
 *  - Download stream for historical search / retrieval
 *  - Generate short-lived presigned URL (15 min) for secure admin download
 *  - Graceful local filesystem fallback for development when R2 env vars are omitted
 */

const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'heimdall-archives';

const hasR2Credentials = () => {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT)
  );
};

let s3ClientInstance = null;

const getS3Client = () => {
  if (!hasR2Credentials()) return null;
  if (s3ClientInstance) return s3ClientInstance;

  const endpoint =
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  s3ClientInstance = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  return s3ClientInstance;
};

// Local fallback directory for dev testing without R2 credentials
const LOCAL_ARCHIVE_DIR = path.join(__dirname, '..', 'public', 'archives');

const ensureLocalArchiveDir = (storageKey) => {
  const fullPath = path.join(LOCAL_ARCHIVE_DIR, storageKey);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return fullPath;
};

/**
 * Upload a compressed buffer to Cloudflare R2 (or local dev fallback)
 */
const uploadArchiveObject = async ({ storageKey, buffer, contentType = 'application/gzip' }) => {
  const client = getS3Client();

  if (client) {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: storageKey,
      Body: buffer,
      ContentType: contentType,
    });
    const response = await client.send(command);
    logger.info('[R2] Object uploaded successfully', { storageKey, bucket: BUCKET_NAME });
    return { storageKey, size: buffer.length, etag: response.ETag };
  }

  // Local fallback
  const filePath = ensureLocalArchiveDir(storageKey);
  await fs.promises.writeFile(filePath, buffer);
  logger.info('[R2 Fallback] Object saved to local disk', { storageKey, filePath });
  return { storageKey, size: buffer.length, etag: 'local-file' };
};

/**
 * Verify existence and metadata of an object in R2 (or local fallback)
 */
const getArchiveObjectMetadata = async (storageKey) => {
  const client = getS3Client();

  if (client) {
    try {
      const command = new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: storageKey,
      });
      const res = await client.send(command);
      return {
        exists: true,
        size: res.ContentLength,
        etag: res.ETag,
        lastModified: res.LastModified,
      };
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return { exists: false, size: 0 };
      }
      throw err;
    }
  }

  // Local fallback check
  const filePath = path.join(LOCAL_ARCHIVE_DIR, storageKey);
  try {
    const stat = await fs.promises.stat(filePath);
    return {
      exists: true,
      size: stat.size,
      etag: 'local-file',
      lastModified: stat.mtime,
    };
  } catch {
    return { exists: false, size: 0 };
  }
};

/**
 * Download readable stream of an archive object from R2 (or local fallback)
 */
const getArchiveObjectStream = async (storageKey) => {
  const client = getS3Client();

  if (client) {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: storageKey,
    });
    const response = await client.send(command);
    return response.Body; // ReadableStream / Node stream
  }

  // Local fallback
  const filePath = path.join(LOCAL_ARCHIVE_DIR, storageKey);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Local archive object not found: ${storageKey}`);
  }
  return fs.createReadStream(filePath);
};

/**
 * Download entire object as Buffer
 */
const getArchiveObjectBuffer = async (storageKey) => {
  const stream = await getArchiveObjectStream(storageKey);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Generate a short-lived (15 min) presigned download URL for Admin
 */
const getPresignedDownloadUrl = async (storageKey, expiresInSeconds = 900) => {
  const client = getS3Client();

  if (client) {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: storageKey,
    });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  // Local fallback URL
  const PUBLIC_BASE = process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${PUBLIC_BASE}/api/archive/local-download?key=${encodeURIComponent(storageKey)}`;
};

module.exports = {
  hasR2Credentials,
  uploadArchiveObject,
  getArchiveObjectMetadata,
  getArchiveObjectStream,
  getArchiveObjectBuffer,
  getPresignedDownloadUrl,
  BUCKET_NAME,
};
