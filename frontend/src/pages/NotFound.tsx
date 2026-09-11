import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <Seo title="Page not found" description="The page you were looking for doesn't exist." noIndex />
      <h1 className="text-2xl font-bold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link to="/" className="mt-6 rounded-full bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700">
        Back home
      </Link>
    </main>
  );
}
