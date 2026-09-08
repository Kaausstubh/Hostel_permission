# HEIMDALL — Automated Data Archival & Cloudflare R2 Historical Store

## 1. Architecture Overview

HEIMDALL utilizes a hybrid storage architecture:

- **Current / Operational Data** (< `ARCHIVE_RETENTION_MONTHS`):
  Stored directly in **MongoDB Atlas** for high-speed indexing, real-time Socket.io dashboards, and immediate gate QR validation (<10ms scan response time).

- **Historical Data** (>= `ARCHIVE_RETENTION_MONTHS`):
  Automated asynchronous pipeline moves historical logs out of MongoDB into **Cloudflare R2** object storage in compressed `.json.gz` format.

```
MongoDB (Operational Logs)
   ↓
BullMQ Queue (`archive-jobs`) + Redis
   ↓
Archive Worker (`archiveService.js`)
   ↓
JSON Export & Streaming Gzip Compression
   ↓
Cloudflare R2 Upload (`2026/01/inout-logs-2026-01.json.gz`)
   ↓
Verify R2 Object Existence & SHA-256 Checksum
   ↓
Mark Archive Manifest `VERIFIED`
   ↓
Safe Batch Deletion from MongoDB
   ↓
Mark Archive Manifest `COMPLETED`
```

---

## 2. Cloudflare R2 Bucket & Credentials Setup

### Step A: Create R2 Bucket
1. Log into your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **R2 Object Storage** > **Create Bucket**.
3. Name the bucket `heimdall-archives` (or your configured `R2_BUCKET_NAME`).
4. Ensure the bucket access policy is **PRIVATE** (do NOT enable Public Access or R2 custom domains).

### Step B: Create R2 API Tokens
1. In Cloudflare R2 Dashboard, click **Manage R2 API Tokens**.
2. Click **Create API Token**.
3. Permissions: Select **Object Read & Write**.
4. Apply to: Specific bucket (`heimdall-archives`).
5. Copy the generated **Access Key ID**, **Secret Access Key**, and **Endpoint URL** (or Account ID).

---

## 3. Environment Configuration

Add the following variables to `backend/.env` (and document in `.env.example`):

```env
# Archival Configuration
ARCHIVE_ENABLED=true
ARCHIVE_RETENTION_MONTHS=3
ARCHIVE_CRON=0 2 1 * *

# Cloudflare R2 Storage Credentials (S3-Compatible)
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=heimdall-archives
R2_ENDPOINT=https://<your_account_id>.r2.cloudflarestorage.com
```

*Note: In local development environments where R2 environment variables are omitted, HEIMDALL gracefully falls back to local disk storage (`backend/public/archives/`) for end-to-end testing.*

---

## 4. Retention Policy

- **Default Retention**: 3 Months (`ARCHIVE_RETENTION_MONTHS=3`).
- **Configurable**: The retention period is dynamically evaluated at runtime.
- **Eligible Collections & Rules**:
  1. `InOutLog`: Archived if date is older than retention threshold AND `returned: true` (unreturned/active out logs are NEVER deleted).
  2. `HomeVisitLog`: Archived if return date is older than retention threshold AND `overall_status` is in `['completed', 'rejected']` AND `qr_used_in: true` (active/pending/approved passes are NEVER deleted).
  3. `Complaint`: Archived if creation timestamp is older than retention threshold AND `status: 'resolved'` (pending/in-progress complaints are NEVER deleted).

---

## 5. Monthly Automation & Timezone Specification

- **Cron Schedule**: Default `ARCHIVE_CRON=0 2 1 * *` (Runs on the 1st day of every month at 02:00 AM).
- **Timezone Handling**:
  - `node-cron` evaluates the cron expression against the process system timezone (`TZ` environment variable, defaulting to `UTC`).
  - In cloud container environments (Docker, Render, AWS ECS), the server clock is UTC. E.g., `0 2 1 * * UTC` executes at 07:30 AM IST on the 1st of every month.
  - To enforce Asia/Kolkata IST explicitly, set `TZ=Asia/Kolkata` in the environment.

---

## 6. Safe 14-Step Verification Workflow

To guarantee zero data loss, HEIMDALL enforces an atomic verification workflow:

1. **Find Eligible Records**: Query MongoDB for eligible historical records matching retention criteria.
2. **Determine Date Range & Manifest**: Generate `archiveId` (e.g. `inout-2026-01`) and `storageKey` (`2026/01/inout-logs-2026-01.json.gz`).
3. **Export Records**: Stream cursor results into JSON.
4. **Calculate Count & Checksum**: Compute record count, uncompressed byte size, and SHA-256 hex checksum.
5. **Gzip Compression**: Compress JSON data via Node `zlib`.
6. **Upload to R2**: Write compressed `.json.gz` to Cloudflare R2 bucket.
7. **Verify R2 Object**: Execute `HeadObjectCommand` against Cloudflare R2.
8. **Verify Manifest Metadata**: Ensure R2 size matches local byte count.
9. **Verify Checksum**: Confirm object integrity.
10. **Mark VERIFIED**: Update `ArchiveJob` status in MongoDB to `VERIFIED`.
11. **Delete from MongoDB**: Execute safe batch deletion of ONLY the verified record IDs.
12. **Verify Deletion Count**: Confirm deleted count matches archived count.
13. **Record Audit Log**: Write `ARCHIVE_DELETE_COMPLETED` to `AuditLog`.
14. **Mark COMPLETED**: Set `ArchiveJob` status to `COMPLETED` with timestamp.

> [!CAUTION]
> **Data Safety Guarantee**: If any failure occurs during export, compression, upload, or metadata verification, the process aborts immediately, records `ARCHIVE_FAILED` in `AuditLog`, and **NEVER** deletes any records from MongoDB.

---

## 7. Admin Archive Dashboard & Historical Retrieval

- **Access Route**: `/archived-records` (Restricted to `warden` and `admin` roles).
- **Features**:
  - Metrics Cards (Total Records Archived, Total Storage Saved MB, Retention Policy, Last Archive Job).
  - Manifests Table: Shows status (`COMPLETED`, `VERIFIED`, `FAILED`), record counts, compressed size, and dates.
  - **Historical Search**: Search archived `.json.gz` files by student name, roll number, or phone number without loading full archives into server memory.
  - **Signed Download Links**: Generates temporary, short-lived (15 min) S3/R2 presigned URLs for secure administrative download.

---

## 8. Disaster Recovery & Manual Restoration

If historical data needs to be restored from R2 back into MongoDB:

1. Download the target `.json.gz` file via Admin Archive Dashboard or Cloudflare R2 console.
2. Decompress using standard CLI tools:
   ```bash
   gunzip -c 2026/01/inout-logs-2026-01.json.gz > inout-logs-2026-01.json
   ```
3. Import into MongoDB using `mongoimport`:
   ```bash
   mongoimport --uri="$MONGODB_URI" --collection=inoutlogs --file=inout-logs-2026-01.json --jsonArray
   ```
