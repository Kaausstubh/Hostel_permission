/**
 * ErrorBoundary
 * Catches render errors anywhere in the tree and shows a friendly fallback.
 * Prevents the white-screen-of-death on unhandled component exceptions.
 */
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // In production you'd send this to a logging service (e.g. Sentry)
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: 'var(--app-viewport-height)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-base, #0a0a2e)',
            color: 'var(--text-primary, #e2e8f0)',
            fontFamily: 'Inter, sans-serif',
            padding: '2rem',
            textAlign: 'center',
            gap: '1rem',
          }}
        >
          <div style={{ fontSize: 56 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ color: 'var(--text-muted, #94a3b8)', maxWidth: 420, margin: 0 }}>
            An unexpected error occurred. Your data is safe. Try refreshing the
            page or clicking the button below.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre
              style={{
                background: 'rgba(255,0,0,0.08)',
                border: '1px solid rgba(255,0,0,0.2)',
                borderRadius: 8,
                padding: '12px 16px',
                fontSize: 11,
                color: '#f87171',
                maxWidth: '90vw',
                overflowX: 'auto',
                textAlign: 'left',
              }}
            >
              {this.state.error.toString()}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            style={{
              marginTop: 8,
              padding: '10px 28px',
              borderRadius: 99,
              border: 'none',
              background: 'linear-gradient(135deg, #8b5cf6, #22d3ee)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'opacity 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.85')}
            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
          >
            Try Again
          </button>
          <button
            onClick={() => (window.location.href = '/login')}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 99,
              padding: '8px 24px',
              color: 'var(--text-muted, #94a3b8)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Go to Login
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
