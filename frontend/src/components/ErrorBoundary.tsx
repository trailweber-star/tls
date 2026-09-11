import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/* ------------------------------------------------------------------ *
 * The last line of defence
 *
 * React unmounts the entire tree when a component throws during render.
 * With nothing to catch it that means a white page: no header, no error,
 * no way back, and nothing on screen to tell you what happened or even
 * that anything did. One bad field on one profile took the whole site
 * down and looked, to the person using it, like the site had simply
 * stopped existing.
 *
 * This catches that and keeps the page. It also prints the real error to
 * the console, so the next time something throws there is something to
 * read instead of a guess.
 * ------------------------------------------------------------------ */

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Deliberately noisy. A crash that leaves no trace in the console is
    // a crash nobody can fix.
    console.error("[TLS] A component crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-1 flex-col items-center justify-center px-5 py-20 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-soft text-amber-900">
          <AlertTriangle className="h-7 w-7" strokeWidth={1.75} />
        </span>
        <h1 className="mt-5 font-display text-[24px] font-bold text-ink">Something broke on this page</h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">
          That is a fault on our side, not something you did. The rest of the site is fine — go back and try again, and
          it will usually work.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Try again
          </button>
          <a
            href="/"
            className="rounded-full border border-line px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:bg-paper-muted"
          >
            Back to home
          </a>
        </div>

        {/* In development the actual message is on screen, because
            switching to the console to find out what happened is a step
            nobody should have to take. In production it stays in the
            console — a patient does not need a stack trace. */}
        {import.meta.env.DEV && (
          <pre className="mt-8 max-w-full overflow-x-auto whitespace-pre-wrap rounded-xl bg-paper-muted p-4 text-left text-[12px] leading-relaxed text-ink-muted ring-1 ring-line">
            {error.message}
            {error.stack ? `\n\n${error.stack.split("\n").slice(1, 6).join("\n")}` : ""}
          </pre>
        )}
      </main>
    );
  }
}
