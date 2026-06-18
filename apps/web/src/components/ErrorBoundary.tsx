"use client";

import type { ReactNode } from "react";
import { Component } from "react";
import { Button } from "@/components/Button";

type Props = {
  children: ReactNode;
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
};

type State = { error: Error | null };

// Class component is required by the React error boundary API.
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(_error: Error, _info: React.ErrorInfo): void {
    // Intentionally silent: logging is handled by the caller or a monitoring sink.
    // Avoid console.error here, the linter and security policy both forbid it.
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;

    if (error !== null) {
      if (this.props.fallback) {
        return this.props.fallback({ error, reset: this.reset });
      }

      return (
        <div className="flex min-h-svh flex-1 items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-xl border border-down/40 bg-down/10 p-6">
            <h2 className="text-lg font-semibold text-down mb-2">Something went wrong</h2>
            <p className="text-sm text-cream-soft mb-4">{error.message}</p>
            <Button variant="primary" className="w-full" onClick={this.reset}>
              Try again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
