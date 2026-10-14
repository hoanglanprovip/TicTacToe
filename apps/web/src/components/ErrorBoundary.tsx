import { Component } from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Render error:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <section className="card">
          <div className="card-tape" />
          <h2>
            <span>GIAO DIEN GAP LOI</span>
          </h2>
          <p className="hint">{this.state.error.message}</p>
          <button type="button" className="primary big" onClick={() => window.location.reload()}>
            TAI LAI TRANG
          </button>
        </section>
      </div>
    );
  }
}