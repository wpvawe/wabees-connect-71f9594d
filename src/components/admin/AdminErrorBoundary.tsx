import { Component, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { WbButton } from "@/components/wb/WbButton";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Prevents an uncaught render error inside any admin section from blanking
 * the whole admin route. Shows a recovery card + reload button instead.
 */
export class AdminErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[AdminErrorBoundary]", error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <FontAwesomeIcon icon={faTriangleExclamation} className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          Something went wrong in the admin panel
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {this.state.error.message || "An unexpected error occurred."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <WbButton onClick={this.reset}>Try again</WbButton>
          <WbButton variant="secondary" onClick={() => window.location.reload()}>
            Reload page
          </WbButton>
        </div>
      </div>
    );
  }
}