import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a render error in one panel from blanking the whole rack. The synth runs
 * in the worklet, so audio and the persisted session survive a UI crash; a
 * reload picks the session back up.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash-overlay" role="alert">
        <div className="crash-card">
          <h2>Something broke in the interface</h2>
          <p>
            The synth engine is still running. Reloading restores your last saved session, which is
            written a moment after every edit.
          </p>
          <pre className="crash-detail">{error.message}</pre>
          <div className="crash-actions">
            <button type="button" className="start" onClick={() => window.location.reload()}>
              RELOAD
            </button>
            <button
              type="button"
              className="bar-btn"
              onClick={() => this.setState({ error: null })}
            >
              Try to continue
            </button>
          </div>
        </div>
      </div>
    );
  }
}
