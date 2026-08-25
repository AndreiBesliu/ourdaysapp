import React from 'react';
import { reportError } from '../reportError';

interface State { hasError: boolean; reloadFailed: boolean }

/** Set before a reload, so a second crash can tell the user that reloading did not help. */
const TRIED_KEY = 'app_boundary_reloaded';

// Catches render-time crashes anywhere in the tree, reports them, and shows a
// recovery screen instead of a white page.
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, reloadFailed: false };

  static getDerivedStateFromError(): Partial<State> { return { hasError: true }; }

  componentDidMount() { this.clearMarkIfHealthy(); }
  componentDidUpdate() { this.clearMarkIfHealthy(); }

  /**
   * Cleared only once the app has ACTUALLY rendered. componentDidMount fires even when this
   * boundary mounts showing the error screen — it is the boundary that mounted, not the app — so
   * clearing unconditionally would erase the mark the catch had just read.
   */
  private clearMarkIfHealthy() {
    if (this.state.hasError) return;
    try { sessionStorage.removeItem(TRIED_KEY); } catch { /* private mode */ }
  }

  private reload = () => {
    try { sessionStorage.setItem(TRIED_KEY, '1'); } catch { /* private mode */ }
    window.location.reload();
  };

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try { this.setState({ reloadFailed: sessionStorage.getItem(TRIED_KEY) === '1' }); } catch { /* private mode */ }
    reportError(error?.message || 'Render error', {
      stack: `${error?.stack || ''}\n${info?.componentStack || ''}`.slice(0, 4000),
      context: 'ErrorBoundary',
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-zinc-50 dark:bg-zinc-950">
          <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Something went wrong.</p>
          {/* Reloading cannot fix a crash caused by PERSISTED state — it rehydrates the same
              thing and dies again. So once it has been tried and failed, this stops presenting it
              as the answer: a button that cannot do what it says is the one thing the house rules
              single out as never acceptable. */}
          <p className="text-sm text-zinc-500">
            {this.state.reloadFailed
              ? 'Reloading did not help, so this is not a passing glitch. The error was logged.'
              : 'The error was logged. Try reloading.'}
          </p>
          <button onClick={this.reload} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
            {this.state.reloadFailed ? 'Reload again' : 'Reload'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
