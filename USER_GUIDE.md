# HEIMDALL Smart Hostel User Guide

This is the comprehensive operational guide for the **Heimdall Smart Campus Access & Hostel Management Platform**.

---

## 📖 Table of Contents
1. [Executive Overview](#1-executive-overview)
2. [The Student Portal](#2-the-student-portal)
3. [The Parent Approval Portal](#3-the-parent-approval-portal)
4. [The Guard Scanner Portal](#4-the-guard-scanner-portal)
5. [The Warden Portal & Night Rounds](#5-the-warden-portal--night-rounds)
6. [The Visitor & Vehicle Management Portal](#6-the-visitor--vehicle-management-portal)
7. [The Admin Analytics & Telemetry Portal](#7-the-admin-analytics--telemetry-portal)
8. [Security & Architectural Safeguards](#8-security--architectural-safeguards)
9. [Default Test Credentials](#9-default-test-credentials)

---

## 1. Executive Overview
Heimdall is a high-availability campus gate control and hostel management system designed to streamline permission checking, outpasses, and student movement tracking using dynamic QR codes. By integrating real-time Socket.io dashboards, zero-cost parent-approval email automation (via Google Apps Script), server-side geofenced attendance verification, and role-based authorization, Heimdall bridges the security gap between students, parents, security guards, wardens, and campus administration.

---

## 2. The Student Portal
The Student Portal acts as the central interface for residential campus students. The interface uses a dark glassmorphic design system optimized for mobile devices at gate terminals.

### Key Functions:
*   **Dynamic QR Gate Pass**: Generates a time-salted, HMAC-signed QR token for quick scanning at gates. Passes automatically expire after their validity period.
*   **Live Status Indicator**: Real-time badge showing whether the student is currently "IN HOSTEL" or "CHECKED OUT".
*   **Home Visit Pass Request**: Interactive chatbot flow allows students to submit leave applications with custom leave and return dates.
*   **1-Tap Overlap Resolution**: If a student has an existing unscanned pass, a dedicated **"⚡ Cancel Previous Request & Create New"** button cancels the old request and creates the new pass in one click.
*   **Guardian Contact Linking**: First-time login prompts students via `StudentGuardianPrompt` to register verified guardian email and phone details.
*   **Geofenced Attendance Verification**: Auto-verifies student GPS location against campus coordinates upon app launch, with live feedback.
*   **Attendance History Modal**: Detailed modal displaying past attendance verification records with date, exact timestamp, and status.

---

## 3. The Parent Approval Portal
The Parent Portal provides a dedicated, accessible interface for guardians with zero app download required.

### Key Functions:
*   **Tokenized Email Approval**: Parents receive an automated approval request email via the Google Apps Script email relay with 1-click "Approve" or "Reject" links (`/parent/home-visit/:token`).
*   **Dedicated Parent Dashboard**: Accessible at `/parent/login` with student leave history, pending requests, and student check-in/out logs.
*   **Instant Pass Activation**: Upon parent approval, the student's Home Visit QR pass is immediately activated and synchronized in real time.

---

## 4. The Guard Scanner Portal
Deployed on mobile devices and gate terminals at campus entrance and exit gates, this portal allows guards to verify student passes in milliseconds.

### Key Functions:
*   **High-FPS Camera Scanner**: Scans student QR passes using `html5-qrcode`.
*   **Instant Audio-Visual Alerts**: Large green banner with an audible confirmation chime for authorized passes; vibrant red banner for expired, invalid, or duplicate passes.
*   **Double-Scan Guard**: Redis-backed atomic lock (`ScanLockService`) prevents double-scanning within 5 seconds.
*   **Live Gate Feed**: Displays recent check-in/check-out logs in real time via Socket.IO.

---

## 5. The Warden Portal & Night Rounds
The Warden Portal focuses on student welfare, room allocation, daily accountability, and leave supervision.

### Key Functions:
*   **Outpass Queue Supervision**: Live list of student home-visit requests with student details, destination, and parent approval status.
*   **Emergency Overrides**: Wardens can grant final approval or reject outpass requests directly.
*   **Room-by-Room Night Attendance Rounds**: Staff can walk room to room on floor rounds, tap "Request Attendance", and verify student platform authenticators without hardware beacons.
*   **Report Generation**: Export comprehensive attendance logs to official Excel (.xlsx) and PDF registers.

---

## 6. The Visitor & Vehicle Management Portal
The Visitor Module provides campus security and warden administration with total control over campus guests, commercial vendors, delivery personnel, and visiting vehicles.

### Key Functions:
*   **Visitor Headcount Tracking**: Tracks exact party size (`visitorCount`: 1 to 20 people) for accurate live campus headcount.
*   **Vehicle Logging & Normalization**: Captures and normalizes vehicle license numbers (e.g. `MH12AB1234`).
*   **Automated Google Form Self Check-In**: Guests can scan a QR code at the main gate to self-register via Google Forms with instant webhook ingestion.
*   **Search & Audit Controls**: Instant search across visitor name, phone, student host, or vehicle plate.
*   **Real-Time Gate Exits**: Guards mark visitors as EXITED with a single click upon exit.
*   **Institutional Reports**: Downloadable Excel and PDF visitor logs with CSV formula injection neutralization.

---

## 7. The Admin Analytics & Telemetry Portal
The Administrative Console is designed for IT managers and campus directors.

### Key Functions:
*   **Live Gate Scan Analytics**: Charts scan traffic per minute to pinpoint rush hour patterns.
*   **System Health Gauges**: Displays active MongoDB connection count, CPU metrics, and Redis cache telemetry.
*   **Guardian & Student Directory**: Review registered student-guardian associations and resend invitation links.
*   **Automated Data Archival**: Monitor Cloudflare R2 archival jobs and verify historical manifest records.

---

## 8. Security & Architectural Safeguards
1.  **Anti-Duplicate Lock (`ScanLockService`)**: Atomic Redis lock blocks repeat scans within a 5-second window.
2.  **Privacy Protection**: Raw student GPS coordinates and visitor contact numbers are sanitized and shielded from public logs.
3.  **Free-Tier Database Optimization**: MongoDB Atlas connection pool capped at 5 in free tier (`MONGODB_TIER=free`) with idle connection reclamation.
4.  **Zero-Budget Email Relay**: Google Apps Script relay (`backend/gas/Code.gs`) dispatches approval notifications without third-party API fees.
5.  **Dynamic QR Encryption**: QR payloads are HMAC-signed tokens with short-lived salt timestamps to prevent screenshot forgery.

---

## 9. Default Test Credentials

| Role | Default Email | Password | Access Portal |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@college.edu` | `admin123` | System Admin Console |
| **Warden** | `warden@college.edu` | `warden123` | Warden Dashboard & Night Rounds |
| **Guard** | `guard@college.edu` | `guard123` | Guard Camera Scanner (`/scan`) |
| **Student** | `student@college.edu` | `student123` | Student Dashboard & Pass Generator |
