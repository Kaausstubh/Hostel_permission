# BH2 Room Allocation & Attendance Integration Module

## 1. Overview
The **Room Allocation Module** manages student-to-room allocations for hostels (starting with **BH2**), acting as the **single source of truth** for student residence data across the application.
The **Room-by-Room Attendance Module** is directly wired to this allocation engine, dynamically pulling live occupants and room layouts per floor without duplicating or desynchronizing student locations.

---

## 2. Architecture & Data Model

### Core Entities
- [`Hostel`](file:///c:/Campus_Management/Hostel_permission/backend/models/Hostel.js): Represents the hostel entity (code: `BH2`, `BH1`, `GH`).
- [`HostelFloor`](file:///c:/Campus_Management/Hostel_permission/backend/models/HostelFloor.js): Floors within a hostel (`-1` Basement, `0` Ground Floor, `1` 1st Floor, `2` 2nd Floor, `3` 3rd Floor).
- [`HostelRoom`](file:///c:/Campus_Management/Hostel_permission/backend/models/HostelRoom.js): Physical rooms with capacity, gender, and status (`available`, `occupied`, `full`, `maintenance`, `blocked`).
- [`RoomAllocation`](file:///c:/Campus_Management/Hostel_permission/backend/models/RoomAllocation.js): Active and historical student allocations. Contains partial unique index: `{ student_id: 1 }` with `{ status: 'active' }` guaranteeing a student can never hold more than one active room allocation.
- [`RoomAllocationAudit`](file:///c:/Campus_Management/Hostel_permission/backend/models/RoomAllocationAudit.js): Immutable audit log recording every allocation, transfer, and vacate action with actor, reason, and timestamps.
- [`HostelGeofence`](file:///c:/Campus_Management/Hostel_permission/backend/models/HostelGeofence.js): Geofence definition per hostel with center coordinates, 50m radius, and GPS accuracy threshold.

---

## 3. Floor Numbering & BH2 Hierarchy

Based on authoritative BH2 layout data:
| Floor | Floor Number | Label | Room Numbers | Total Rooms | Students Allocated |
| :--- | :---: | :--- | :--- | :---: | :---: |
| **Basement / Wing B** | `-1` | Basement / Wing B | B01 – B13 | 12 | 47 |
| **Ground Floor** | `0` | Ground Floor | 2, 11, 15, 18, 19, 20, 24–30 (Room 30 capacity: 8) | 13 | 48 |
| **1st Floor** | `1` | 1st Floor | 101 – 132 | 30 | 114 |
| **2nd Floor** | `2` | 2nd Floor | 201 – 234 | 33 | 122 |
| **3rd Floor** | `3` | 3rd Floor | 301 – 321 | 21 | 77 |
| **Total** | | | | **109** | **408** |

*Note: Student `KRUNAL BHAVESHBHAI VASOYA` (MIS: 112516050, row 323, blank room) was omitted from initial allocation per administrator directive.*

---

## 4. Hostel GPS Geofences & Validation

Server-side geodesic validation enforces a strict **50-meter radius** centered at:
- **BH2:** `(18.763092, 73.699231)`, Radius: 50m
- **BH1:** `(18.764126, 73.699223)`, Radius: 50m
- **GH:** `(18.765075, 73.699101)`, Radius: 50m

### Rules:
1. `distance <= 50m`: **Allowed** (`inside_geofence: true`).
2. `distance > 50m`: **Rejected** (`code: OUTSIDE_GEOFENCE`). Student response is flagged for staff review.
3. `accuracy > 50m`: **Rejected** (`code: LOW_GPS_ACCURACY`) with retry prompt.
4. Physical separation (~115m between BH2 & BH1, ~106m between BH1 & GH) ensures students cannot approve attendance across hostels.

---

## 5. Attendance Module Integration

1. **Live Room Rosters:**
   - Attendance rounds query `HostelRoom` and `RoomAllocation.find({ room_id, status: 'active' })` dynamically.
   - Any mid-round student transfer immediately updates the room roster for subsequent requests.
2. **Vacant Room Handling:**
   - Unoccupied rooms (`0` active students) are labeled with a **Vacant** chip.
   - "Request Attendance" and "Skip" buttons are disabled for vacant rooms.
   - Vacant rooms never block round completion.
3. **Audit Trail & Response Snapshots:**
   - When students approve attendance, their active `allocation_id` is recorded on the `RequestResponse`.
   - On completion, official `AttendanceRecord`s are upserted with verification method and student link.

---

## 6. API Endpoints

### Allocations (`/api/allocations`)
- `GET /api/allocations/hostels` — Distinct hostels and floors.
- `GET /api/allocations/rooms` — Filterable room inventory with live occupant counts and vacancies.
- `GET /api/allocations/rooms/:id` — Room details with full occupant roster and audit trail.
- `POST /api/allocations/allocate` — Allocate a student to a room (validates capacity & single active allocation).
- `POST /api/allocations/transfer` — Atomically transfer a student to another room.
- `POST /api/allocations/vacate` — Vacate a student from a room.
- `GET /api/allocations/lookup/:identifier` — Search student by rollNo/name/email for Security & Staff gate checks.
- `GET /api/allocations/export` — Export active allocations as CSV.
- `POST /api/allocations/import/preview` — Preview bulk PDF/list allocations before committing.
- `POST /api/allocations/import/confirm` — Commit bulk allocation import.
