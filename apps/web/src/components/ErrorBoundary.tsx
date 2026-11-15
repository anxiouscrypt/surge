// A render crash shows a way out instead of a blank screen (for a caller, that matters).
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Surge UI crashed", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const caller = location.pathname.startsWith("/c");
    return (
      <div className="locked-page">
        <h1>Something went wrong</h1>
        <p>{caller ? "Reload to reconnect. In a real emergency, call 911." : "Reload the dashboard. Calls are kept on the server."}</p>
        <button className="text-button" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
