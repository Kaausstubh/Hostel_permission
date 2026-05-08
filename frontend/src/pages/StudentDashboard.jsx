/**
 * Student Dashboard — In-Portal WhatsApp-Style Chatbot
 *
 * A fully client-side state-machine chatbot that calls the backend
 * student API to perform: in/out requests, home visit requests,
 * complaints, and status checks — all rendered as chat bubbles.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  MdSend, MdLogout, MdQrCode2, MdHome, MdReport,
  MdDashboard, MdPerson, MdDownload, MdLightMode, MdDarkMode, MdDeleteOutline, MdInstallMobile
} from 'react-icons/md';
import { useTheme } from '../context/ThemeContext';

// ── Constants ─────────────────────────────────────────────────────────────────
const BOT = 'bot';
const USER = 'user';

// ── Bot message factory ───────────────────────────────────────────────────────
// NOTE: msgId is created inside the component via useRef to avoid stale IDs
// during React HMR (hot module replacement) in development.
const makeMsg = (id, sender, content, type = 'text', meta = {}) => ({
  id,
  sender,
  type,   // 'text' | 'buttons' | 'qr' | 'status'
  content,
  meta,
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
});

// ── Chatbot State Machine Steps ───────────────────────────────────────────────
const STEPS = {
  IDLE:          'IDLE',
  MENU:          'MENU',
  // In/Out
  INOUT_CONFIRM: 'INOUT_CONFIRM',
  // Home Visit
  HV_REASON:     'HV_REASON',
  HV_LEAVE:      'HV_LEAVE',
  HV_RETURN:     'HV_RETURN',
  // Complaint
  CPL_TYPE:      'CPL_TYPE',
  CPL_TEXT:      'CPL_TEXT',
  // Done
  DONE:          'DONE',
};

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [step, setStep]         = useState(STEPS.IDLE);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [hvData, setHvData]     = useState({});
  const [zoomedQR, setZoomedQR] = useState(null);
  const bottomRef = useRef(null);
  const menuTimerRef = useRef(null);
  const bootTimerRef = useRef(null);
  const lastBotRef = useRef({ content: '', type: '', at: 0 });
  // Safe initial mobile check — avoids SSR/layout-shift issues
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const msgIdRef = useRef(0);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── PWA Install Prompt ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') { setDeferredPrompt(null); toast.success('App installed! 🎉'); }
    } else {
      toast('Already installed or not supported', { icon: 'ℹ️' });
    }
  };

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Boot greeting ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    
    const lastMsg = messages[messages.length - 1];
    const isLastMsgMenu = lastMsg && lastMsg.type === 'buttons' && lastMsg.content && lastMsg.content.includes('What would you like to do today?');
    
    if (!isLastMsgMenu) {
      bootTimerRef.current = setTimeout(() => showMainMenu(), 500);
    } else {
      setStep(STEPS.MENU);
    }

    return () => {
      if (bootTimerRef.current) clearTimeout(bootTimerRef.current);
      if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    };
  }, []); // eslint-disable-line

  // ── Helpers ───────────────────────────────────────────────────────────────
  const push = useCallback((m) => setMessages((prev) => [...prev, m]), []);

  const botSay = useCallback((text, type = 'text', meta = {}) => {
    const now = Date.now();
    // Avoid accidental duplicate bot bubbles caused by rapid clicks/timeouts.
    if (
      lastBotRef.current.content === text &&
      lastBotRef.current.type === type &&
      now - lastBotRef.current.at < 1500
    ) {
      return;
    }
    lastBotRef.current = { content: text, type, at: now };
    const id = ++msgIdRef.current;
    push(makeMsg(id, BOT, text, type, meta));
  }, [push]);

  const userSay = useCallback((text) => {
    const id = ++msgIdRef.current;
    push(makeMsg(id, USER, text));
  }, [push]);

  const pushQrMessage = useCallback((meta = {}) => {
    const id = ++msgIdRef.current;
    push(makeMsg(id, BOT, '', 'qr', meta));
  }, [push]);

  const showMainMenu = () => {
    if (menuTimerRef.current) {
      clearTimeout(menuTimerRef.current);
      menuTimerRef.current = null;
    }
    setStep(STEPS.MENU);
    botSay(`Hi ${user?.name?.split(' ')[0]} 👋  What would you like to do today?\n\n💡 Tip: If you already requested a QR gate-pass or Home Visit pass, click "View My Status" to access it.`, 'buttons', {
      buttons: [
        { id: '1', label: '🔄 In/Out Request',    icon: '🔄' },
        { id: '2', label: '🏠 Home Visit Request', icon: '🏠' },
        { id: '3', label: '🧾 File a Complaint',   icon: '🧾' },
        { id: '4', label: '📊 View My Status',     icon: '📊' },
      ],
    });
  };

  const resetToMenu = () => {
    setHvData({});
    if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    menuTimerRef.current = setTimeout(showMainMenu, 600);
  };

  const exitChat = () => {
    if (menuTimerRef.current) {
      clearTimeout(menuTimerRef.current);
      menuTimerRef.current = null;
    }
    setHvData({});
    setStep(STEPS.IDLE);
    botSay('🚪 Chat exited. Type *menu* or *start* whenever you want to continue.');
  };
  // ── Button click handler ──────────────────────────────────────────────────
  const handleButton = async (id, label) => {
    userSay(label);

    if (id.startsWith('qr_')) {
      const qrDataUrl = hvData?.[id];
      if (qrDataUrl) {
        pushQrMessage({ qrDataUrl });
      } else {
        botSay('❌ QR code not found or expired.');
      }
      return;
    }

    if (step === STEPS.MENU) {
      if (id === '1') {
        setStep(STEPS.INOUT_CONFIRM);
        botSay(
          `🔄 *In/Out Request*\n\nThis will send your gate-pass request to security for approval. The request stays valid for 10 minutes.\n\nShould I send it now?`,
          'buttons',
          { buttons: [{ id: 'yes', label: '✅ Yes, Send Request' }, { id: 'no', label: '❌ Cancel' }] }
        );
      } else if (id === '2') {
        setStep(STEPS.HV_REASON);
        botSay('🏠 *Home Visit Request*\n\nStep 1/3 — Please select a reason below, or type your own:', 'buttons', {
          buttons: [
            { id: 'going_home', label: '🏠 Going Home' },
            { id: 'medical_reason', label: '🏥 Medical Reason' },
            { id: 'family_function', label: '🎉 Family Function' },
            { id: 'hv_other', label: '🛠️ Other Reason' }
          ]
        });
      } else if (id === '3') {
        setStep(STEPS.CPL_TYPE);
        botSay('🧾 *File a Complaint*\n\nSelect complaint type:', 'buttons', {
          buttons: [
            { id: 'electricity', label: '⚡ Electricity' },
            { id: 'wifi', label: '📶 WiFi' },
            { id: 'washing_machine', label: '🧺 Washing Machine' },
            { id: 'others', label: '🛠️ Others' },
          ],
        });
      } else if (id === '4') {
        await fetchStatus();
      }
    } else if (step === STEPS.INOUT_CONFIRM) {
      if (id === 'yes') {
        await submitInOutRequest();
      } else {
        botSay('Cancelled. Here\'s the main menu:');
        resetToMenu();
      }
    } else if (step === STEPS.CPL_TYPE) {
      setHvData((d) => ({ ...d, complaint_type: id }));
      setStep(STEPS.CPL_TEXT);
      const typeLabelMap = {
        electricity: 'Electricity',
        wifi: 'WiFi',
        washing_machine: 'Washing Machine',
        others: 'Others',
      };
      botSay(`📝 Got it — *${typeLabelMap[id] || 'Others'}*.\n\nPlease describe your complaint in detail:`);
    } else if (step === STEPS.HV_REASON) {
      if (id === 'hv_other') {
        botSay('Please type your detailed reason below:');
        return;
      }
      // Use the button label as the reason
      setHvData({ reason: label });
      setStep(STEPS.HV_LEAVE);
      botSay('📅 Step 2/3 — Please select your *date of leaving* using the calendar below:', 'date_picker');
    }
  };

  // ── Text input handler ────────────────────────────────────────────────────
  const handleSend = async (e, forcedText) => {
    if (e) e.preventDefault();
    const text = (forcedText !== undefined ? forcedText : input).trim();
    if (!text || loading) return;
    setInput('');
    userSay(text);
    const t = text.toLowerCase();

    // Global escape hatch: works from any ongoing step.
    if (['exit', 'quit', 'close', 'cancel'].includes(t)) {
      exitChat();
      return;
    }

    if (step === STEPS.HV_REASON) {
      if (text.length < 10 || text.split(/\s+/).length < 2) {
        botSay('❌ That reason is too short or unclear. Please write a genuine, detailed reason for your home visit:');
        return;
      }
      setHvData({ reason: text });
      setStep(STEPS.HV_LEAVE);
      botSay('📅 Step 2/3 — Please select your *date of leaving* using the calendar below:', 'date_picker');
    } else if (step === STEPS.HV_LEAVE) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        botSay('❌ Invalid format. Please use YYYY-MM-DD (e.g., 2025-05-20)');
        return;
      }
      const today = new Date().toISOString().split('T')[0];
      if (text < today) {
        botSay('❌ Leave date cannot be before today. Please enter today\'s date or a future date.');
        return;
      }
      setHvData((d) => ({ ...d, leave_date: text }));
      setStep(STEPS.HV_RETURN);
      botSay('📅 Step 3/3 — Please select your *expected return date* using the calendar below:', 'date_picker');
    } else if (step === STEPS.HV_RETURN) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        botSay('❌ Invalid format. Please use YYYY-MM-DD');
        return;
      }
      const today = new Date().toISOString().split('T')[0];
      if (text < today) {
        botSay('❌ Return date cannot be before today. Please enter today\'s date or a future date.');
        return;
      }
      if (hvData.leave_date && text <= hvData.leave_date) {
        botSay('❌ Return date must be after leave date. Please enter a later date.');
        return;
      }
      await submitHomeVisit({ ...hvData, return_date: text });
    } else if (step === STEPS.CPL_TEXT) {
      if (text.length < 10 || text.split(/\s+/).length < 2) {
        botSay('❌ That description is too short. Please provide a genuine, detailed description of your complaint:');
        return;
      }
      await submitComplaint(text);
    } else {
      // Handle free-text menu triggers
      if (['hi', 'hello', 'menu', 'start'].includes(t)) {
        botSay('Sure! Here\'s the main menu:');
        resetToMenu();
      } else {
        botSay('Type *menu* to see options, or use the buttons above.');
      }
    }
  };

  // ── API Calls ─────────────────────────────────────────────────────────────

  const submitInOutRequest = async () => {
    setLoading(true);
    try {
      const res = await api.post('/student/request-inout');
      const { scan_type, student, expiresIn, qrDataUrl } = res.data;

      botSay(
        `✅ *In/Out Request Sent!*\n\n👤 ${student.name}\n🏢 ${student.hostel || 'N/A'}\n🔄 Type: *${scan_type}*\n⏰ Valid: ${expiresIn}\n\nYour request is now visible on the security dashboard. Show the QR below at the gate so security can scan it.`,
      );
      pushQrMessage({ qrDataUrl, scanType: scan_type, student });
      setStep(STEPS.DONE);
      setTimeout(() => {
        botSay('Need anything else?');
        resetToMenu();
      }, 2000);
    } catch (err) {
      botSay(`❌ ${err.response?.data?.message || 'Failed to send in/out request. Try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const submitHomeVisit = async (data) => {
    setLoading(true);
    try {
      const res = await api.post('/student/home-visit', data);
      botSay(
        `✅ *Home Visit Request Submitted!*\n\n📝 Reason: ${data.reason}\n📅 Leave: ${data.leave_date}\n📅 Return: ${data.return_date}\n\n⏳ The warden will call your parent to confirm permission. Once confirmed, your QR gate pass will be generated.`
      );
      setStep(STEPS.DONE);
      setHvData({});
      resetToMenu();
    } catch (err) {
      botSay(`❌ ${err.response?.data?.message || 'Submission failed. Try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const submitComplaint = async (text) => {
    setLoading(true);
    try {
      await api.post('/student/complaint', {
        // Send hostel as well for backward compatibility with older backend route validation.
        hostel: user?.hostel,
        complaint_type: hvData.complaint_type || 'others',
        complaint_text: text,
      });
      const typeLabelMap = {
        electricity: 'Electricity',
        wifi: 'WiFi',
        washing_machine: 'Washing Machine',
        others: 'Others',
      };
      botSay(
        `✅ *Complaint Filed!*\n\n🏷️ Type: ${typeLabelMap[hvData.complaint_type] || 'Others'}\n📝 "${text.substring(0, 60)}${text.length > 60 ? '…' : ''}"\n\nThe warden will review it shortly.`
      );
      setStep(STEPS.DONE);
      setHvData({});
      resetToMenu();
    } catch (err) {
      botSay(`❌ ${err.response?.data?.message || 'Failed to file complaint.'}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get('/student/status');
      const s = res.data.status;

      let statusMsg = `📊 *Your Current Status*\n\n`;
      statusMsg += `🚦 Right now: *${s.currentStatus}*`;
      if (s.outSince) {
        statusMsg += `\n⏰ Out since: ${new Date(s.outSince).toLocaleTimeString('en-IN')}`;
      }

      if (s.pendingInOutRequest) {
        statusMsg += `\n\n🛂 *Pending In/Out Request:*`;
        statusMsg += `\nType: ${s.pendingInOutRequest.scanType}`;
        if (s.pendingInOutRequest.expiresAt) {
          statusMsg += `\nExpires: ${new Date(s.pendingInOutRequest.expiresAt).toLocaleTimeString('en-IN')}`;
        } else {
          statusMsg += `\nStatus: Same QR is active for return scan`;
        }
      }

      if (s.pendingVisits?.length > 0) {
        statusMsg += `\n\n🏠 *Pending Home Visits:*`;
        s.pendingVisits.forEach((v, i) => {
          statusMsg += `\n${i + 1}. ${v.leave_date} → ${v.return_date} (${v.overall_status})`;
        });
      }

      const statusButtons = [];
      const qrMap = {};

      if (s.approvedVisits?.length > 0) {
        statusMsg += `\n\n✅ *Approved Home Visits:*`;
        s.approvedVisits.forEach((v, i) => {
          statusMsg += `\n${i + 1}. ${v.leave_date} → ${v.return_date} — QR gate pass generated`;
          if (v.qrDataUrl) {
            statusButtons.push({ id: `qr_${v._id}`, label: `View Home Visit QR ${i + 1}`, icon: '📲' });
            qrMap[`qr_${v._id}`] = v.qrDataUrl;
          }
        });
      }

      if (s.recentComplaints?.length > 0) {
        statusMsg += `\n\n🧾 *Recent Complaints:*`;
        s.recentComplaints.forEach((c, i) => {
          const emoji = c.status === 'resolved' ? '✅' : c.status === 'in_progress' ? '🔄' : '⏳';
          statusMsg += `\n${i + 1}. ${emoji} ${c.hostel} — ${c.status}`;
        });
      }

      if (Object.keys(qrMap).length > 0) {
        setHvData(prev => ({ ...prev, ...qrMap }));
      }

      if (statusButtons.length > 0) {
        botSay(statusMsg, 'buttons', { buttons: statusButtons });
      } else {
        botSay(statusMsg);
      }

      // Display QR for pending In/Out request if it exists
      if (s.pendingInOutRequest && s.pendingInOutRequest.qrDataUrl) {
        pushQrMessage({
          qrDataUrl: s.pendingInOutRequest.qrDataUrl,
          scanType: s.pendingInOutRequest.scanType,
          student: user
        });
      }

      // Display QRs for approved home visits
      if (s.approvedVisits?.length > 0) {
        s.approvedVisits.forEach((v) => {
          if (v.qrDataUrl) {
            pushQrMessage({
              qrDataUrl: v.qrDataUrl,
              scanType: 'HOME VISIT',
              student: user
            });
          }
        });
      }

      setStep(STEPS.DONE);
      resetToMenu();
    } catch (err) {
      botSay(`❌ ${err.response?.data?.message || 'Could not fetch status.'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const downloadQR = (dataUrl) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'gate-pass.png';
    a.click();
  };

  // ── Render message bubbles ────────────────────────────────────────────────
  const renderBubble = (m) => {
    const isUser = m.sender === USER;
    const bubbleBase = {
      maxWidth: isMobile ? '92%' : '75%',
      padding: '10px 14px 6px',
      borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
      fontSize: 14,
      lineHeight: 1.55,
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    };

    if (m.type === 'qr') {
      return (
        <div style={{ maxWidth: 280, alignSelf: 'flex-start' }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16, overflow: 'hidden',
            boxShadow: 'var(--shadow-md)',
            border: '1px solid var(--glass-border)',
          }}>
            {/* Header */}
            <div style={{
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
              borderBottom: '1px solid var(--glass-border)',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <MdQrCode2 size={20} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                  🏫 Smart Campus
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Gate {m.meta.scanType} Pass
                </div>
              </div>
            </div>

            {/* QR image */}
            <div style={{
              padding: 16, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 10,
              cursor: 'zoom-in',
            }} onClick={() => setZoomedQR(m.meta.qrDataUrl)}>
              {m.meta.qrDataUrl ? (
                <img src={m.meta.qrDataUrl} alt="QR"
                  style={{ width: 200, height: 200, borderRadius: 10,
                    border: '2px solid var(--glass-border)' }} />
              ) : (
                <div style={{ width: 200, height: 200, background: 'var(--bg-input)',
                  borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#8696a0', fontSize: 12 }}>Loading QR...</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                Tap to zoom · Show to security guard
              </div>
            </div>

            {/* Download button */}
            <button onClick={() => downloadQR(m.meta.qrDataUrl)}
              style={{
                width: '100%', padding: '11px 16px', border: 'none',
                borderTop: '1px solid var(--glass-border)',
                background: 'var(--glass)',
                color: '#818cf8', fontSize: 13.5, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--glass)'}
            >
              <MdDownload size={16} /> Download Gate Pass
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 4 }}>
            {m.time}
          </div>
        </div>
      );
    }

    if (m.type === 'buttons') {
      return (
        <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
          {/* Text bubble */}
          <div style={{
            ...bubbleBase,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}>
            {m.content}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {m.time}
            </div>
          </div>
          {/* Quick-reply buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {m.meta.buttons.map((btn) => (
              <button key={btn.id} id={`btn-${btn.id}`}
                onClick={() => handleButton(btn.id, btn.label)}
                disabled={loading}
                style={{
                  padding: '8px 16px', borderRadius: 999,
                  border: '1px solid var(--primary)',
                  background: 'transparent',
                  color: 'var(--primary-light)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s',
                  opacity: loading ? 0.5 : 1,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--primary)';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--primary-light)';
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (m.type === 'date_picker') {
      const isLatestDatePrompt = m.id === messages.filter(msg => msg.type === 'date_picker').pop()?.id;
      return (
        <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
          {/* Text bubble */}
          <div style={{
            ...bubbleBase,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}>
            {m.content}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {m.time}
            </div>
          </div>
          {/* Date Picker Input */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="date"
              onChange={(e) => {
                if (e.target.value) {
                  handleSend(null, e.target.value);
                }
              }}
              disabled={loading || !isLatestDatePrompt}
              style={{
                padding: '10px 14px', borderRadius: 12,
                border: '1px solid var(--primary)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 14, cursor: 'pointer', outline: 'none',
                opacity: (loading || !isLatestDatePrompt) ? 0.5 : 1,
              }}
            />
          </div>
        </div>
      );
    }

    // Plain text bubble
    return (
      <div style={{
        ...bubbleBase,
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        background: isUser ? 'var(--primary)' : 'var(--bg-card)',
        border: isUser ? 'none' : '1px solid var(--glass-border)',
        color: isUser ? '#fff' : 'var(--text-primary)',
      }}>
        {m.content}
        <div style={{
          fontSize: 10, marginTop: 4, textAlign: 'right',
          color: isUser ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)',
        }}>
          {m.time}
          {isUser && <span style={{ marginLeft: 4 }}>✓✓</span>}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-base)', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Left Sidebar ── */}
      <aside style={{
        width: 240, background: 'var(--bg-surface)',
        borderRight: '1px solid var(--glass-border)',
        display: 'flex', flexDirection: 'column',
        padding: 0, flexShrink: 0,
        ...(isMobile ? { display: 'none' } : {}),
      }}>
        {/* Brand */}
        <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>🏛️ Smart Campus</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Student Portal</div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '12px 0', flex: 1 }}>
          {[
            { icon: <MdDashboard />, label: 'My Chatbot', active: true },
          ].map((item) => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 20px', fontSize: 13.5, fontWeight: 600,
              background: item.active ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: item.active ? 'var(--primary-light)' : 'var(--text-muted)',
              borderLeft: item.active ? '3px solid var(--primary)' : '3px solid transparent',
              cursor: 'pointer',
            }}>
              {item.icon} {item.label}
            </div>
          ))}
        </nav>

        {/* User card */}
        <div style={{
          padding: '16px 20px', borderTop: '1px solid var(--glass-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, color: '#fff', fontSize: 15, flexShrink: 0,
            }}>
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {user?.rollNo} · {user?.hostel}
              </div>
            </div>
          </div>
          <button onClick={handleLogout}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 8,
              border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.08)',
              color: '#f87171', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
            }}>
            <MdLogout size={15} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Chat Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: isMobile ? '10px 12px' : '14px 24px',
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--glass-border)',
          display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14,
          boxShadow: 'var(--shadow-sm)',
          flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MdDashboard size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
              Smart Campus Bot
            </div>
            <div style={{ fontSize: 12, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Online
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* PWA Install */}
            <button
              onClick={handleInstallApp}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
              }}
              aria-label="Install App"
              title="Install App"
            >
              <MdInstallMobile size={18} />
            </button>
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
              }}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <MdDarkMode size={18} /> : <MdLightMode size={18} />}
            </button>
            <div style={{
              padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: 'rgba(99,102,241,0.15)', color: 'var(--primary-light)',
              border: '1px solid rgba(99,102,241,0.3)',
            }}>
              🎓 Student
            </div>
            {isMobile && (
              <button
                onClick={handleLogout}
                style={{
                  padding: '4px 12px',
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700,
                  border: '1px solid rgba(239,68,68,0.35)',
                  background: 'transparent',
                  color: '#fca5a5',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <MdLogout size={12} /> Logout
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: isMobile ? '12px 10px' : '20px 32px',
          display: 'flex', flexDirection: 'column', gap: 8,
          backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(99,102,241,0.03) 0%, transparent 70%)',
        }}>
          {messages.map((m) => (
            <div key={m.id} style={{
              display: 'flex',
              justifyContent: m.sender === USER ? 'flex-end' : 'flex-start',
            }}>
              {renderBubble(m)}
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                padding: '10px 16px', borderRadius: '18px 18px 18px 4px',
                background: 'var(--bg-card)', border: '1px solid var(--glass-border)',
                display: 'flex', gap: 4, alignItems: 'center',
              }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--text-muted)',
                    animation: `bounce 1s ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* Spacer to prevent date picker cutoff */}
          {messages[messages.length - 1]?.type === 'date_picker' && (
            <div style={{ height: 280 }} />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          padding: isMobile ? '10px 10px' : '12px 24px',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--glass-border)',
        }}>
          <form onSubmit={handleSend} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              id="chatbot-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                step === STEPS.HV_REASON  ? 'Type reason for home visit...' :
                step === STEPS.CPL_TEXT   ? 'Describe your complaint...' :
                'Type a message or use buttons above...'
              }
              style={{
                flex: 1, padding: '11px 18px', borderRadius: 24,
                border: '1px solid var(--glass-border)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)', fontSize: 14, outline: 'none',
              }}
              disabled={loading}
              autoFocus
            />
            <button id="chatbot-send" type="submit" disabled={loading || !input.trim()}
              style={{
                width: 44, height: 44, borderRadius: '50%', border: 'none',
                background: loading || !input.trim() ? 'rgba(99,102,241,0.3)' : 'var(--primary)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s', flexShrink: 0,
              }}>
              <MdSend size={18} style={{ marginLeft: 2 }} />
            </button>
          </form>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
            Type <strong>menu</strong> anytime to return to the main menu
          </div>
        </div>
      </div>

      {/* ── QR Zoom Modal ── */}
      {zoomedQR && (
        <div onClick={() => setZoomedQR(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-card)', borderRadius: 20, padding: 32,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            border: '1px solid var(--glass-border)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>
              🏫 Your Gate Pass QR
            </div>
            <img src={zoomedQR} alt="QR"
              style={{ width: 300, height: 300, borderRadius: 12 }} />
            <div style={{ display: 'flex', gap: 12, width: '100%' }}>
              <button onClick={() => downloadQR(zoomedQR)} style={{
                flex: 1, padding: '11px 0', borderRadius: 10,
                background: 'var(--primary)', border: 'none',
                color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <MdDownload size={16} /> Download
              </button>
              <button onClick={() => setZoomedQR(null)} style={{
                flex: 1, padding: '11px 0', borderRadius: 10,
                background: theme === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.07)', border: 'none',
                color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer',
              }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
