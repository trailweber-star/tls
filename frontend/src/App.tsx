import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { AuthProvider, RequireAuth } from "./lib/auth";
import Home from "./pages/Home";
import Search from "./pages/Search";
import SpecialistProfile from "./pages/SpecialistProfile";
import ClinicProfile from "./pages/ClinicProfile";
import FacilityProfile from "./pages/FacilityProfile";
import NotFound from "./pages/NotFound";
import Pricing from "./pages/Pricing";
import Claim from "./pages/Claim";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import SignIn from "./pages/SignIn";
import Register from "./pages/Register";
import DashboardOverview from "./pages/dashboard/Overview";
import ProfileEditor from "./pages/dashboard/ProfileEditor";
import Enquiries from "./pages/dashboard/Enquiries";
import Reviews from "./pages/dashboard/Reviews";
import ComingSoon from "./pages/dashboard/ComingSoon";
import DashboardArticles from "./pages/dashboard/Articles";
import Billing from "./pages/dashboard/Billing";
import AdminOverview from "./pages/admin/AdminOverview";
import Verifications from "./pages/admin/Verifications";
import ReviewModeration from "./pages/admin/ReviewModeration";
import AdminSpecialists from "./pages/admin/AdminSpecialists";
import AdminMembers from "./pages/admin/AdminMembers";
import AdminAudit from "./pages/admin/AdminAudit";
import AdminMessages from "./pages/admin/AdminMessages";
import AdminArticles from "./pages/admin/AdminArticles";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { BarChart3, CalendarDays, MessageSquare, Settings } from "lucide-react";

/**
 * The public site is chrome-wrapped (header, footer, paper background).
 * The workspace and the auth screens are not — they bring their own
 * shell — so they sit outside that layout rather than inside it.
 */
function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <Header />
      {/* Inside the shell, so a page that throws keeps the header and
          footer and the person keeps a way out. Outside it, the crash
          would take the whole chrome with it — which is exactly the
          white page this exists to prevent. */}
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
      <Footer />
    </div>
  );
}

/** /articles/:slug kept alive, carrying the slug across to /blog/:slug. */
function ArticleRedirect() {
  const { slug = "" } = useParams();
  return <Navigate to={`/blog/${slug}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      {/* The outer net catches the dashboard and auth screens, which
          bring their own shell and sit outside PublicLayout. */}
      <ErrorBoundary>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          {/* The wordings people type or link by habit, so neither a
              cookie banner nor an old email lands on the 404. */}
          <Route path="/privacy-policy" element={<Navigate to="/privacy" replace />} />
          <Route path="/terms-of-use" element={<Navigate to="/terms" replace />} />
          <Route path="/terms-and-conditions" element={<Navigate to="/terms" replace />} />
          <Route path="/cookies" element={<Navigate to="/privacy#cookies" replace />} />
          {/* Named /blog, but the earlier copy and the ClinWell document
              both say "articles" — one redirect is cheaper than a 404 a
              year from now. */}
          <Route path="/articles" element={<Navigate to="/blog" replace />} />
          <Route path="/articles/:slug" element={<ArticleRedirect />} />
          <Route path="/specialists/:slug" element={<SpecialistProfile />} />
          <Route path="/clinics/:slug" element={<ClinicProfile />} />
          {/* The places directory and the specialist directory are one
              search now; the old path still resolves so nothing that was
              already linked or indexed breaks. */}
          <Route path="/facilities" element={<Navigate to="/search?type=hospital" replace />} />
          <Route path="/facilities/:slug" element={<FacilityProfile />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="/signin" element={<SignIn />} />
        <Route path="/register" element={<Register />} />
        <Route path="/claim/:slug" element={<Claim />} />

        {/* ------------------------------------ specialist workspace */}
        <Route
          path="/dashboard"
          element={
            <RequireAuth role="specialist">
              <Outlet />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardOverview />} />
          <Route path="profile" element={<ProfileEditor />} />
          <Route path="enquiries" element={<Enquiries />} />
          <Route path="reviews" element={<Reviews />} />
          <Route path="articles" element={<DashboardArticles />} />
          <Route
            path="appointments"
            element={
              <ComingSoon
                icon={CalendarDays}
                instead={{ to: "/dashboard/enquiries", label: "See your enquiries" }}
                title="Appointments"
                description="Your schedule, once patients can book through the platform."
                needs={[
                  "An appointment model, so bookings exist as records rather than emails",
                  "Availability rules — the days and hours you consult",
                  "A booking form on your public profile",
                ]}
              />
            }
          />
          <Route
            path="analytics"
            element={
              <ComingSoon
                icon={BarChart3}
                instead={{ to: "/dashboard", label: "Your 30-day figures are on the dashboard" }}
                title="Analytics"
                description="Where your profile views and enquiries come from."
                needs={[
                  "Profile views are already being counted — the 30-day figure on your dashboard is real",
                  "Referrer and search-term capture, to show how patients found you",
                  "A longer retention window than the current in-memory store",
                ]}
              />
            }
          />
          <Route
            path="messages"
            element={
              <ComingSoon
                icon={MessageSquare}
                instead={{ to: "/dashboard/enquiries", label: "Answer patient enquiries" }}
                title="Messages"
                description="Threaded conversations with patients."
                needs={[
                  "A message thread model — enquiries are currently single messages with one reply",
                  "Read receipts and unread counts",
                  "Email delivery, so replies reach patients who don't sign in",
                ]}
              />
            }
          />
          <Route
            path="settings"
            element={
              <ComingSoon
                icon={Settings}
                instead={{ to: "/dashboard/billing", label: "Plan and billing" }}
                title="Settings"
                description="Account, notifications and privacy."
                needs={[
                  "Password change and email change with confirmation",
                  "Notification preferences per event type",
                  "Account closure, which has to unpublish your profile too",
                ]}
              />
            }
          />
          <Route path="billing" element={<Billing />} />
          {/* Older links pointed here before the billing screen existed. */}
          <Route path="upgrade" element={<Navigate to="/dashboard/billing" replace />} />
        </Route>

        {/* ---------------------------------------------- admin */}
        <Route
          path="/admin"
          element={
            <RequireAuth role="admin">
              <Outlet />
            </RequireAuth>
          }
        >
          <Route index element={<AdminOverview />} />
          <Route path="members" element={<AdminMembers />} />
          <Route path="verifications" element={<Verifications />} />
          {/* Claims are a queue inside the verifications screen; the
              sidebar links straight to that tab rather than to a second
              page showing the same table. */}
          <Route path="claims" element={<Navigate to="/admin/verifications?tab=claims" replace />} />
          <Route path="articles" element={<AdminArticles />} />
          <Route path="specialists" element={<AdminSpecialists />} />
          <Route path="reviews" element={<ReviewModeration />} />
          <Route path="audit" element={<AdminAudit />} />
          <Route path="messages" element={<AdminMessages />} />
        </Route>
      </Routes>
      {/* Outside the routes on purpose: a borrowed session has to be
          visible on the public site too, not only in the workspace. */}
      <ImpersonationBanner />
      </ErrorBoundary>
    </AuthProvider>
  );
}
