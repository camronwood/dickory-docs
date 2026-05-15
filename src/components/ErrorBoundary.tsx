import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ error, errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[120px] bg-slack-bg border border-slack-border rounded p-4 text-slack-text">
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-slack-textMuted mb-3">
            An unexpected error occurred. You can try to recover or reload the page.
          </p>
          <p className="font-mono text-xs text-red-400 break-all mb-4">
            {this.state.error?.message || "Unknown error"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-3 py-1.5 text-sm rounded bg-slack-accent text-white hover:bg-slack-accentHover"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-3 py-1.5 text-sm rounded bg-slack-bgHover text-slack-text border border-slack-border"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
