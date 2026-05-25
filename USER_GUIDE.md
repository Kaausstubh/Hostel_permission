# HEIMDALL Smart Hostel User Guide

This is the markdown version of the **Heimdall Smart Campus Access & Hostel Management System User Guide**. A high-fidelity, professional PDF version of this guide has been pre-rendered and saved at:

📁 **[docs/Heimdall_User_Guide.pdf](file:///Users/kaustubh/Desktop/Hostel_permission-main/docs/Heimdall_User_Guide.pdf)**

---

## 📖 Table of Contents
1. [Executive Overview](#1-executive-overview)
2. [The Student Portal](#2-the-student-portal)
3. [The Guard Scanner Portal](#3-the-guard-scanner-portal)
4. [The Warden Portal](#4-the-warden-portal)
5. [The Admin Analytics & Telemetry Portal](#5-the-admin-analytics--telemetry-portal)
6. [Security & Architectural Safeguards](#6-security--architectural-safeguards)
7. [Default Test Credentials](#7-default-test-credentials)

---

## 1. Executive Overview
Heimdall is a high-availability campus gate control system designed to streamline permission checking, outpasses, and student movement tracking using dynamic QR codes. By integrating real-time Socket.io dashboards, parent-approval WhatsApp automation (via BullMQ queues), and a multi-level role authorization schema, Heimdall bridges the security gap between students, security guards, wardens, and administrative headers.

---

## 2. The Student Portal
The Student Portal acts as the central interface for students living in the campus hostels. The interface uses a dark glassmorphic design system that ensures optimal legibility on mobile screens (at the gates).

### Key Functions:
*   **Dynamic QR Generation**: Displays a unique QR code generated using their encrypted token mixed with a time-based OTP salt. QR codes automatically expire to prevent screenshot sharing or duplicate entries.
*   **Quick Status Indicator**: Displays in real-time whether the student is marked "IN HOSTEL" (green) or "Checked OUT" (orange).
*   **Home Visit Pass Request**: Students submit outpass dates and destinations. This triggers an automated WhatsApp permission SMS to the parent.
*   **Real-Time Logging**: Maintains a live, audit-ready log of the student's individual past entries and exits.

![Student Portal](file:///Users/kaustubh/Desktop/Hostel_permission-main/docs/assets/student_portal.png)

---

## 3. The Guard Scanner Portal
Deployed on terminals at campus entrance and exit gates, this portal allows guards to scan student QR codes in milliseconds. The scanner interface uses a fast native camera view and integrates socket-driven notifications to broadcast entry events immediately.

### Key Functions:
*   **Dynamic Video Feed Scanner**: Connects directly to the guard's camera using a high-fps scanning engine.
*   **Instant Alert Indicators**: Upon scanner capture, a successful scan renders a large neon green "ACCESS GRANTED" banner accompanied by an audible beep.
*   **Access Denied Handling**: Displays a solid red warning when a QR code is expired, already scanned, or invalid. The system blocks double-scanning via an in-memory lock mechanism to prevent crowd gate-crashing.
*   **Live Gate Feed**: Shows the last 5 scanned logs on the left sidebar in real-time.

![Guard Portal](file:///Users/kaustubh/Desktop/Hostel_permission-main/docs/assets/guard_portal.png)

---

## 4. The Warden Portal
The Warden Dashboard focuses on accountability, approvals, and student welfare. Wardens supervise outpasses, verify parental responses, and resolve grievances.

### Key Functions:
*   **Queue Auditing**: Shows all pending home-visit applications with student details, destination, and dates.
*   **WhatsApp Status Tracking**: Displays real-time webhook status updates from parents (PENDING, APPROVED, or REJECTED by parent).
*   **One-Click Override Actions**: Wardens can instantly "Grant Final Pass" to authorize the outpass, or "Reject Pass". This updates the database and releases a valid home-visit QR code to the student.
*   **Analytical Widgets**: Visual charts on weekly outpass volume, request status breakdown, and hostel distribution.

![Warden Portal](file:///Users/kaustubh/Desktop/Hostel_permission-main/docs/assets/warden_portal.png)

---

## 5. The Admin Analytics & Telemetry Portal
The Administrative Console is designed for IT managers and campus directors. It provides high-level telemetry, server performance metrics, and configuration controls.

### Key Functions:
*   **Real-Time Traffic Graphs**: Charts active gate scans per minute to detect peak rush hours.
*   **System Health Gauges**: Displays CPU load and MongoDB connection count. Shows actual database connections (e.g., 5/100 connections) to ensure Atlas Free Tier caps are never exceeded.
*   **Diagnostic Metrics**: Lists system uptime, active server versions, status of Redis caching, and error logs (zero-error status).
*   **Active Campus Count**: Displays counts of students currently logged "IN CAMPUS" versus "OUT OF CAMPUS".

![Admin Portal](file:///Users/kaustubh/Desktop/Hostel_permission-main/docs/assets/admin_portal.png)

---

## 6. Security & Architectural Safeguards
1.  **Anti-Duplicate Lock (`ScanLockService`)**: An atomic locking service that blocks a student's QR code from being scanned twice within a 5-second window to prevent double-read database race conditions.
2.  **Free-Tier DB Optimizations**: MongoDB connection pool capped at 5 in free tier (`MONGODB_TIER=free`) with 15-second idle cleanups.
3.  **Queue-Driven Notifications**: Parent WhatsApp notifications are handled in the background by BullMQ worker threads.
4.  **Dynamic QR Encryption**: QR payloads include JWT structures containing user identifiers signed with an HS256 secret.

---

## 7. Default Test Credentials

| Role | Default Email | Password |
| :--- | :--- | :--- |
| **Admin** | `admin@heimdall.com` | `admin123` |
| **Warden** | `warden@heimdall.com` | `warden123` |
| **Guard** | `guard@heimdall.com` | `guard123` |
| **Student** | `kaustubh@student.com` | `student123` |
