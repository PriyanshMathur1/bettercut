// A crash guard: if one part of the editor throws while drawing, only that part is replaced by a
// message, and the rest keeps working. Edits are saved as you make them, so nothing is lost.
import React from "react";

export class Guard extends React.Component<{ name: string; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`BetterCut: ${this.props.name} crashed`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="guard" role="alert">
        <b>{this.props.name} hit a problem.</b>
        <p>Your edits are saved as you make them. Try again, or reload the page if it keeps happening.</p>
        <small>{error.message}</small>
        <div className="row end">
          <button onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
