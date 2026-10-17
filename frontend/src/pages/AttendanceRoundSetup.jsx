/**
 * Attendance Setup Screen: Select Hostel & Session
 * Unified Start Round with strict building geofence verification.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import toast from "react-hot-toast";
import {
  MdMeetingRoom,
  MdCalendarToday,
  MdApartment,
  MdCheckCircle,
  MdLocationOn,
  MdPlayArrow,
  MdLayers,
} from "react-icons/md";
import Navbar from "../components/Navbar";

// Standard 4 Campus Hostels (Instant render, zero latency)
const DEFAULT_HOSTELS = [
  {
    hostel: "BH1",
    name: "Boys' Hostel 1",
    subtitle: "Brahmaputra Building",
    coords: "18°45'50.8\"N 73°41'57.4\"E",
    studentCount: 0,
    floors: [
      "All Floors",
      "Floor 1",
      "Floor 2",
      "Basement / Wing B",
      "Ground Floor",
      "1st Floor",
      "2nd Floor",
      "3rd Floor",
    ],
  },
  {
    hostel: "BH2",
    name: "Boys' Hostel 2",
    subtitle: "Krishna Building",
    coords: "18°45'47.1\"N 73°41'57.7\"E",
    studentCount: 0,
    floors: [
      "All Floors",
      "Floor 1",
      "Floor 2",
      "Basement / Wing B",
      "Ground Floor",
      "1st Floor",
      "2nd Floor",
      "3rd Floor",
    ],
  },
  {
    hostel: "GH1",
    name: "Girls' Hostel 1",
    subtitle: "Indrayani Building",
    coords: "18°45'54.4\"N 73°41'56.8\"E",
    studentCount: 0,
    floors: [
      "All Floors",
      "Floor 1",
      "Floor 2",
      "Ground Floor",
      "1st Floor",
      "2nd Floor",
      "3rd Floor",
    ],
  },
  {
    hostel: "GH2",
    name: "Girls' Hostel 2",
    subtitle: "Sindhu Building",
    coords: "18°45'54.4\"N 73°41'56.8\"E",
    studentCount: 0,
    floors: [
      "All Floors",
      "Floor 1",
      "Floor 2",
      "Ground Floor",
      "1st Floor",
      "2nd Floor",
      "3rd Floor",
    ],
  },
];

export default function AttendanceRoundSetup() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Instant render with default 4 hostels
  const [hostels, setHostels] = useState(DEFAULT_HOSTELS);
  const [selectedHostel, setSelectedHostel] = useState("BH2");
  const selectedFloor = "All Floors";
  const [sessionName, setSessionName] = useState("Night Attendance");
  const [submitting, setSubmitting] = useState(false);

  const todayStr = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const fetchHostels = async () => {
    try {
      const res = await api.get("/attendance/hostels");
      let loadedHostels = [];
      if (res.data?.success && res.data.hostels?.length > 0) {
        loadedHostels = res.data.hostels.filter(
          (h) => !h.hostel.toLowerCase().startsWith("test")
        );
      }

      // Map legacy GH to GH1
      loadedHostels = loadedHostels.map((h) => {
        if (h.hostel === "GH") {
          return { ...h, hostel: "GH1", name: "Girls' Hostel 1 (Indrayani)" };
        }
        return h;
      });

      const merged = DEFAULT_HOSTELS.map((st) => {
        const found = loadedHostels.find((lh) => lh.hostel === st.hostel);
        if (!found) return st;
        const combinedFloors = Array.from(
          new Set(["All Floors", ...(found.floors || []), ...(st.floors || [])])
        );
        return {
          ...st,
          ...found,
          floors: combinedFloors,
          studentCount: found.studentCount || st.studentCount,
        };
      });

      setHostels(merged);

      // Select user assigned hostel or default to BH2
      const matched = merged.find(
        (h) => h.hostel === user?.hostel || h.hostel === selectedHostel
      ) || merged[1];

      if (matched && !selectedHostel) {
        setSelectedHostel(matched.hostel);
      }
    } catch {
      // Fallback stays seamlessly on DEFAULT_HOSTELS
    }
  };

  useEffect(() => {
    fetchHostels();
  }, []);

  // Floor selection is permanently fixed to "All Floors" across all buildings

  // Single Unified Action Button: Starts the round and triggers attendance
  const handleStartRound = async () => {
    if (!selectedHostel) {
      toast.error("Please select a hostel");
      return;
    }
    try {
      setSubmitting(true);
      const res = await api.post("/attendance/rounds/quick-request-all", {
        hostel: selectedHostel,
        floor: selectedFloor || "All Floors",
        session_name: sessionName,
      });

      if (res.data?.success) {
        const floorLabel = selectedFloor?.toLowerCase().includes("all")
          ? "All Floors"
          : selectedFloor || "All Floors";
        toast.success(
          `⚡ Attendance round started for ${selectedHostel} (${floorLabel})! ${res.data.totalStudentsNotified || res.data.requestedRoomsCount || 0} students notified.`,
          { duration: 5000 }
        );
        navigate(`/attendance/round/${res.data.round._id}`);
      }
    } catch (err) {
      // Fallback: standard round creation
      try {
        const fallbackRes = await api.post("/attendance/rounds", {
          hostel: selectedHostel,
          floor: selectedFloor || "All Floors",
          session_name: sessionName,
        });
        if (fallbackRes.data?.success) {
          navigate(`/attendance/round/${fallbackRes.data.round._id}`);
          return;
        }
      } catch {}
      toast.error(err.response?.data?.message || "Failed to start attendance round");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in">
      <Navbar title="Room-by-Room Attendance" />
      <div className="page-area">
        <div style={{ maxWidth: 860, margin: "0 auto", paddingBottom: 40 }}>
          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "var(--radius-md)",
                  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 24,
                  boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
                }}
              >
                <MdMeetingRoom />
              </div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "var(--text-primary)" }}>
                  Room-by-Room Attendance
                </h1>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  1-Click Student Geofence Verification & Floor Rounds
                </span>
              </div>
            </div>
          </div>

          {/* Main Setup Card */}
          <div
            className="card"
            style={{
              padding: 24,
              borderRadius: "var(--radius-lg)",
              marginBottom: 20,
              background: "var(--bg-card, #ffffff)",
              border: "1px solid var(--border-color, rgba(148, 163, 184, 0.25))",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.05)",
            }}
          >
            {/* Step 1: Select Hostel */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                  <MdApartment style={{ color: "var(--primary, #6366f1)", fontSize: 18 }} /> Step 1: Select Hostel Building
                </label>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>30m Strict Building Geofence</span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                {hostels.map((h) => {
                  const isSelected = selectedHostel === h.hostel;
                  return (
                    <div
                      key={h.hostel}
                      onClick={() => setSelectedHostel(h.hostel)}
                      style={{
                        padding: "16px 14px",
                        borderRadius: 14,
                        border: isSelected
                          ? "2px solid var(--primary, #6366f1)"
                          : "1px solid var(--border-color, rgba(148, 163, 184, 0.25))",
                        background: isSelected
                          ? "rgba(99, 102, 241, 0.08)"
                          : "var(--bg-card, #ffffff)",
                        boxShadow: isSelected
                          ? "0 4px 16px rgba(99, 102, 241, 0.18)"
                          : "0 2px 6px rgba(0,0,0,0.03)",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        position: "relative",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: 18,
                            color: isSelected ? "var(--primary, #6366f1)" : "var(--text-primary)",
                          }}
                        >
                          {h.hostel}
                        </span>
                        {isSelected ? (
                          <MdCheckCircle style={{ color: "var(--primary, #6366f1)", fontSize: 20 }} />
                        ) : (
                          <span
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: "50%",
                              border: "2px solid var(--border-color, #cbd5e1)",
                            }}
                          />
                        )}
                      </div>

                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 2 }}>
                        {h.subtitle || h.name}
                      </div>

                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-secondary)",
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          marginTop: 6,
                          fontFamily: "monospace",
                        }}
                      >
                        <MdLocationOn size={12} style={{ color: "var(--primary, #6366f1)", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.coords}
                        </span>
                      </div>

                      {h.studentCount > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            marginTop: 6,
                            paddingTop: 6,
                            borderTop: "1px dashed var(--border-color, rgba(148,163,184,0.2))",
                          }}
                        >
                          {h.studentCount} students
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Session Details */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
                  <MdCalendarToday size={15} /> Session Date
                </label>
                <div
                  style={{
                    padding: "12px 14px",
                    background: "var(--bg-input, rgba(0,0,0,0.03))",
                    borderRadius: 10,
                    border: "1px solid var(--border-color, rgba(148, 163, 184, 0.25))",
                    color: "var(--text-primary)",
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {todayStr} (Today)
                </div>
              </div>

              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
                  Session Name (Permanent)
                </label>
                <div
                  style={{
                    padding: "12px 14px",
                    background: "var(--bg-input, rgba(0,0,0,0.03))",
                    borderRadius: 10,
                    border: "1px solid var(--border-color, rgba(148, 163, 184, 0.25))",
                    color: "var(--text-primary)",
                    fontWeight: 700,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>🌙</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>Night Attendance</span>
                  </div>
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "rgba(99, 102, 241, 0.15)",
                      color: "var(--primary, #6366f1)",
                      textTransform: "uppercase",
                      fontWeight: 800,
                      letterSpacing: 0.5,
                    }}
                  >
                    Permanent Standard
                  </span>
                </div>
              </div>
            </div>

            {/* Single Unified Action Button */}
            <div>
              <button
                type="button"
                onClick={handleStartRound}
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "16px 24px",
                  borderRadius: 14,
                  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 16,
                  border: "none",
                  cursor: submitting ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  boxShadow: "0 6px 20px rgba(99, 102, 241, 0.4)",
                  transition: "all 0.2s ease",
                }}
              >
                <MdPlayArrow size={24} />
                {submitting ? (
                  "Starting Round…"
                ) : (
                  <>Start Round ({selectedHostel} · {selectedFloor})</>
                )}
              </button>
            </div>
          </div>

          {/* Helpful Hint Card */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: "rgba(99, 102, 241, 0.05)",
              border: "1px solid rgba(99, 102, 241, 0.18)",
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
            }}
          >
            💡 <strong>Hostel Floor Round:</strong> Select a hostel, then click <em>&quot;Start Round&quot;</em> to open the mobile room list. From there, you can tap each room to inspect students, trigger inline Request Attendance, or Skip Room with a mandatory reason.
          </div>
        </div>
      </div>
    </div>
  );
}
