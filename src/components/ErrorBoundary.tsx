import React from 'react';
import { reportError } from '../reportError';

interface State { hasError: boolean }

// Catches render-time crashes anywhere in the tree, reports them, and shows a
// recovery screen instead of a white page.
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State { return { hasError: true }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
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
          <p className="text-sm text-zinc-500">The error was logged. Try reloading.</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
