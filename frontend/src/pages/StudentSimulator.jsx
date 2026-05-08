/**
 * Student WhatsApp Simulator
 * Renders a pixel-perfect WhatsApp-like chat UI for testing the chatbot.
 * Supports text messages AND QR image messages (like Pune Metro bot).
 */
import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { MdSend, MdSmartphone, MdDownload, MdQrCode2 } from 'react-icons/md';

const WA_GREEN = '#00a884';
const WA_BG = '#0b141a';
const WA_PANEL = '#1f2c34';
const WA_BUBBLE_BOT = '#202c33';
const WA_BUBBLE_USER = '#005c4b';
const WA_TILE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Ccircle cx='30' cy='30' r='1.5' fill='rgba(255,255,255,0.03)'/%3E%3C/svg%3E\")";

export default function StudentSimulator() {
  const [phoneNumber, setPhoneNumber] = useState('+919800011001');
  const [messages, setMessages] = useState([]);
  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [zoomedQR, setZoomedQR] = useState(null);
  const messagesEndRef = useRef(null);

  const fetchMessages = async () => {
    if (!phoneNumber) return;
    try {
      const res = await api.get(
        `/whatsapp/simulated-messages?phone=${encodeURIComponent(phoneNumber)}`
      );
      setMessages(res.data.messages);
    } catch (err) {
      console.error('Failed to fetch simulated messages', err);
    }
  };

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 2000);
    return () => clearInterval(interval);
  }, [phoneNumber]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    setLoading(true);
    const msg = inputVal;
    setInputVal('');
    try {
      await api.post('/whatsapp/test', { phone: phoneNumber, message: msg });
      await fetchMessages();
    } catch (err) {
      toast.error('Failed to send message');
      setInputVal(msg);
    } finally {
      setLoading(false);
    }
  };

  const downloadQR = (dataUrl, filename) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename || 'qr-pass.png';
    a.click();
  };

  // ── Message Bubble Renderer ───────────────────────────────────────────────
  const renderBubble = (m, i) => {
    const isUser = m.sender === 'user';
    const isImage = m.type === 'image';
    const time = new Date(m.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const bubbleStyle = {
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      maxWidth: isImage ? 300 : '75%',
      minWidth: isImage ? 260 : 0,
      backgroundColor: isUser ? WA_BUBBLE_USER : WA_BUBBLE_BOT,
      borderRadius: isUser ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      overflow: 'hidden',
      position: 'relative',
    };

    const tickStyle = {
      marginLeft: 4,
      fontSize: 10,
      color: '#53bdeb',
    };

    if (isImage) {
      // ── QR Image Bubble (like Pune Metro eTicket style) ──────────────────
      return (
        <div key={i} style={{ alignSelf: 'flex-start', maxWidth: 300 }}>
          <div style={bubbleStyle}>
            {/* QR Image */}
            <div
              style={{
                background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                cursor: 'zoom-in',
              }}
              onClick={() => setZoomedQR({ dataUrl: m.qrDataUrl, caption: m.body })}
            >
              {/* Header like Pune Metro */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                color: '#fff', fontSize: 13, fontWeight: 700, width: '100%',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'linear-gradient(135deg, #25d366, #128c7e)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <MdQrCode2 size={18} color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Smart Campus</div>
                  <div style={{ fontSize: 12 }}>Gate Pass</div>
                </div>
              </div>

              {/* QR Image */}
              {m.qrDataUrl ? (
                <img
                  src={m.qrDataUrl}
                  alt="QR Code"
                  style={{
                    width: 200,
                    height: 200,
                    borderRadius: 8,
                    border: '3px solid rgba(255,255,255,0.1)',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{
                  width: 200, height: 200, borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center',
                  padding: 16,
                }}>
                  QR Image<br />(online only)
                </div>
              )}

              {/* Caption */}
              {m.body && (
                <div style={{
                  color: 'rgba(255,255,255,0.75)', fontSize: 11.5,
                  textAlign: 'center', lineHeight: 1.4,
                  whiteSpace: 'pre-line',
                }}>
                  {m.body}
                </div>
              )}
            </div>

            {/* "View / Download" button — like Pune Metro "Book Now" */}
            <button
              id={`download-qr-btn-${i}`}
              onClick={() => downloadQR(m.qrDataUrl, 'gate-pass-qr.png')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6, width: '100%', padding: '10px 16px',
                background: 'rgba(255,255,255,0.06)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                border: 'none', color: '#53bdeb', fontSize: 13.5, fontWeight: 600,
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            >
              <MdDownload size={16} />
              Download Gate Pass
            </button>

            {/* Timestamp */}
            <div style={{
              textAlign: 'right', padding: '0 10px 6px',
              fontSize: 10, color: 'rgba(255,255,255,0.4)',
            }}>
              {time} <span style={tickStyle}>✓✓</span>
            </div>
          </div>
        </div>
      );
    }

    // ── Text Message Bubble ───────────────────────────────────────────────────
    return (
      <div key={i} style={bubbleStyle}>
        <div style={{
          padding: '7px 9px 6px',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.55,
          fontSize: 14.5,
          color: '#e9edef',
          wordBreak: 'break-word',
        }}>
          {m.body}
        </div>
        <div style={{
          textAlign: 'right', padding: '0 8px 5px',
          fontSize: 10, color: 'rgba(255,255,255,0.4)',
        }}>
          {time}
          {isUser && <span style={tickStyle}> ✓✓</span>}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: 'var(--app-viewport-height)', overflow: 'hidden',
      backgroundColor: WA_BG, fontFamily: "'Segoe UI', sans-serif",
    }}>

      {/* ── Header ── */}
      <div style={{
        padding: '10px 16px', backgroundColor: WA_PANEL,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
        zIndex: 10,
      }}>
        {/* Bot Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: `linear-gradient(135deg, ${WA_GREEN}, #128c7e)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <MdSmartphone size={22} color="#fff" />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#e9edef' }}>
            Smart Campus Bot
          </div>
          <div style={{ fontSize: 12, color: '#8696a0' }}>
            Hostel Management System
          </div>
        </div>

        {/* Phone Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#8696a0', whiteSpace: 'nowrap' }}>
            Simulate as:
          </span>
          <input
            id="simulator-phone-input"
            type="text"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            style={{
              padding: '5px 10px', borderRadius: 6, width: 145,
              border: '1px solid rgba(255,255,255,0.12)',
              backgroundColor: 'rgba(255,255,255,0.07)',
              color: '#e9edef', fontSize: 13, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* ── Chat Area ── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px clamp(12px, 4vw, 60px)',
        display: 'flex', flexDirection: 'column', gap: 4,
        backgroundImage: WA_TILE,
        backgroundSize: '60px 60px',
        overscrollBehavior: 'contain',
      }}>
        {messages.length === 0 ? (
          <div style={{
            margin: 'auto', textAlign: 'center',
            background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '24px 32px',
          }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
            <div style={{ color: '#8696a0', fontSize: 14, fontWeight: 600 }}>
              No messages yet
            </div>
            <div style={{ color: '#8696a0', fontSize: 13, marginTop: 4 }}>
              Type <strong style={{ color: WA_GREEN }}>hi</strong> to start
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            // Group date label
            const date = new Date(m.timestamp).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric',
            });
            const prevDate =
              i > 0
                ? new Date(messages[i - 1].timestamp).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })
                : null;
            const showDate = i === 0 || date !== prevDate;

            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {showDate && (
                  <div style={{
                    textAlign: 'center', margin: '10px 0 6px',
                    fontSize: 11.5, color: '#8696a0',
                    background: 'rgba(0,0,0,0.35)', borderRadius: 6,
                    padding: '3px 10px', alignSelf: 'center',
                  }}>
                    {date === new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                      ? 'Today'
                      : date}
                  </div>
                )}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.sender === 'user' ? 'flex-end' : 'flex-start',
                  marginTop: 2,
                }}>
                  {renderBubble(m, i)}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Bar ── */}
      <div style={{
        backgroundColor: WA_PANEL,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '8px 12px',
      }}>
        <form
          onSubmit={handleSend}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <input
            id="simulator-message-input"
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Type a message"
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 24,
              border: 'none', backgroundColor: '#2a3942',
              color: '#e9edef', fontSize: 15, outline: 'none',
            }}
            autoFocus
            disabled={loading}
          />
          <button
            id="simulator-send-btn"
            type="submit"
            disabled={loading || !inputVal.trim()}
            style={{
              width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
              backgroundColor: loading || !inputVal.trim() ? '#2a3942' : WA_GREEN,
              color: '#fff', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: loading || !inputVal.trim() ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {loading ? (
              <div style={{
                width: 18, height: 18, border: '2px solid #fff',
                borderTopColor: 'transparent', borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }} />
            ) : (
              <MdSend size={20} style={{ marginLeft: 3 }} />
            )}
          </button>
        </form>
      </div>

      {/* ── QR Zoom Modal ── */}
      {zoomedQR && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, cursor: 'zoom-out',
          }}
          onClick={() => setZoomedQR(null)}
        >
          <div
            style={{
              background: '#1f2c34', borderRadius: 16, padding: 28,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 16, maxWidth: 380,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, color: '#e9edef' }}>
              🏫 Gate Pass QR Code
            </div>
            {zoomedQR.dataUrl && (
              <img
                src={zoomedQR.dataUrl}
                alt="QR Code"
                style={{ width: 280, height: 280, borderRadius: 12 }}
              />
            )}
            {zoomedQR.caption && (
              <div style={{
                color: '#8696a0', fontSize: 12.5, textAlign: 'center',
                lineHeight: 1.5, whiteSpace: 'pre-line',
              }}>
                {zoomedQR.caption}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              <button
                onClick={() => downloadQR(zoomedQR.dataUrl, 'gate-pass-qr.png')}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8,
                  background: WA_GREEN, border: 'none',
                  color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <MdDownload size={16} /> Download
              </button>
              <button
                onClick={() => setZoomedQR(null)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8,
                  background: 'rgba(255,255,255,0.08)', border: 'none',
                  color: '#e9edef', fontSize: 14, cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
