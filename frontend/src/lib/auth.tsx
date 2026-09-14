import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  authApi,
  getAdminToken,
  getToken,
  membersApi,
  setAdminToken,
  setRemembered,
  setToken,
} from "./dashboardApi";
import type { Account, LinkedSpecialist } from "./dashboardApi";

/**
 * Who is really driving.
 *
 * `byName` is the administrator's name as the server reported it from
 * the signed token — not from anything this browser stored — so the
 * banner cannot be made to lie by editing local storage.
 */
export interface Impersonation {
  active: true;
  byUserId: string;
  byName: string;
}

interface AuthState {
  account: Account | null;
  specialist: LinkedSpecialist | null;
  /** True until the stored token has been checked against the server. */
  loading: boolean;
  /** Set when this session is an administrator wearing a member's account. */
  impersonation: Impersonation | null;
  /**
   * Resolves with the account, or with a challenge when the account has
   * two-factor switched on and a code is needed as well. The caller has
   * to handle both — which is the point of returning a union rather
   * than throwing: a second step is not an error.
   */
  signIn: (email: string, password: string, remember?: boolean) => Promise<SignInResult>;
  /** The second half of signing in: a TOTP code, or a recovery code. */
  completeSignIn: (
    challenge: string,
    code: string,
    remember?: boolean
  ) => Promise<{ account: Account; usedRecoveryCode: boolean; recoveryCodesRemaining: number }>;
  signUp: (input: Parameters<typeof authApi.register>[0]) => Promise<Account>;
  signOut: () => void;
  refresh: () => Promise<void>;
  /**
   * Take over a session the server just issued, without a password.
   *
   * Two callers, both from the password screens. Redeeming a reset link
   * returns a signed-in session — the person proved they hold the
   * mailbox, and making them type the password they set four seconds ago
   * proves nothing more. Changing a password returns a replacement token
   * because the change kills every token older than it, this tab's
   * included; swapping it in is what keeps them where they are.
   */
  adoptSession: (token: string, user?: Account) => Promise<Account | null>;
  /** Borrow a member's session. Resolves with the account now being worn. */
  startImpersonation: (memberId: string, reason?: string) => Promise<Account>;
  /** Hand the borrowed session back and return to the admin account. */
  stopImpersonation: () => Promise<Account>;
}

export type SignInResult =
  | { account: Account; challenge?: undefined }
  | { challenge: string; account?: undefined };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [specialist, setSpecialist] = useState<LinkedSpecialist | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState<Impersonation | null>(null);

  /* One session check at a time.
     Two calls that overlap used to destroy a recovering session: the
     first would swap the expired support token for the administrator's
     parked one, and the second — already past that point with nothing
     left parked — would conclude there was no session at all and clear
     both. React's development mode runs mount effects twice, which is
     exactly that race, and it signed the administrator out. Callers all
     share the one in-flight promise instead. */
  const inFlight = useRef<Promise<void> | null>(null);

  // A stored token is only a claim. It is validated against the server on
  // load, so a revoked or expired session doesn't leave a stale-looking
  // signed-in UI.
  const runRefresh = useCallback(async () => {
    const attempted = getToken();
    if (!attempted) {
      setAccount(null);
      setSpecialist(null);
      setImpersonation(null);
      setLoading(false);
      return;
    }
    try {
      const res = await authApi.me();
      setAccount(res.user);
      setSpecialist(res.specialist);
      setImpersonation(res.impersonation ?? null);
      /* A support token lasts thirty minutes. When it expires the /me
         call fails and we land in the catch below — which would sign the
         administrator out entirely. Holding their own token aside means
         the recovery is automatic; see the catch. */
    } catch {
      /* Somebody else changed the token while this check was in the
         air — a sign-in, or another recovery. Theirs is the current
         truth; this stale failure must not clear it. */
      if (getToken() !== attempted) return;

      const parked = getAdminToken();
      if (parked) {
        /* The borrowed session ended. Put the administrator back into
           their own rather than dropping them at the login screen. */
        setAdminToken(null);
        setToken(parked);
        setImpersonation(null);
        try {
          const res = await authApi.me();
          setAccount(res.user);
          setSpecialist(res.specialist);
          return;
        } catch {
          /* The parked token is dead too — genuinely signed out. */
        }
      }
      setToken(null);
      setAccount(null);
      setSpecialist(null);
      setImpersonation(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = runRefresh().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [runRefresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* Shared by both halves of signing in, so the two cannot drift. */
  const adoptLogin = useCallback(async (token: string, user: Account, remember: boolean, email: string) => {
    // A fresh sign-in is never an impersonation; clear any stale parking.
    setAdminToken(null);
    setImpersonation(null);
    /* Recorded before the token is written: setToken reads the
       preference to decide which store the token belongs in. */
    setRemembered(remember, email);
    setToken(token, remember);
    setAccount(user);
    const me = await authApi.me().catch(() => null);
    setSpecialist(me?.specialist ?? null);
    return user;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, remember = true): Promise<SignInResult> => {
      const res = await authApi.login(email, password);
      /* No token means the password was right and a code is needed too.
         Nothing is stored yet — there is no session to store. */
      if (res.mfaRequired) return { challenge: res.challenge };
      return { account: await adoptLogin(res.token, res.user, remember, email) };
    },
    [adoptLogin]
  );

  const completeSignIn = useCallback(
    async (challenge: string, code: string, remember = true) => {
      const res = await authApi.completeLogin(challenge, code);
      const account = await adoptLogin(res.token, res.user, remember, res.user.email);
      return {
        account,
        usedRecoveryCode: res.usedRecoveryCode,
        recoveryCodesRemaining: res.recoveryCodesRemaining,
      };
    },
    [adoptLogin]
  );

  const signUp = useCallback(async (input: Parameters<typeof authApi.register>[0]) => {
    const res = await authApi.register(input);
    setAdminToken(null);
    setImpersonation(null);
    setToken(res.token);
    setAccount(res.user);
    const me = await authApi.me().catch(() => null);
    setSpecialist(me?.specialist ?? null);
    return res.user;
  }, []);

  const adoptSession = useCallback(async (token: string, user?: Account) => {
    /* Whatever this replaces, it is not a borrowed session: the server
       refuses to change a password from inside one, and a reset link
       belongs to the account itself. Clearing the parking is therefore
       correct rather than merely tidy. */
    setAdminToken(null);
    setImpersonation(null);
    setToken(token);
    if (user) setAccount(user);
    const me = await authApi.me().catch(() => null);
    if (me) {
      setAccount(me.user);
      setSpecialist(me.specialist);
    }
    return me?.user ?? user ?? null;
  }, []);

  const signOut = useCallback(() => {
    /* Told to the server as well as forgotten here. Dropping the token
       locally leaves the session live for a week, where it turns up in
       the member's own device list as something they cannot account
       for. Not awaited — signing out must not hang on the network, and
       the token is gone from this browser either way. */
    void authApi.logout().catch(() => null);
    setToken(null);
    setAdminToken(null);
    setAccount(null);
    setSpecialist(null);
    setImpersonation(null);
  }, []);

  /* ------------------------------------------------- impersonation */

  const startImpersonation = useCallback(async (memberId: string, reason?: string) => {
    /* Asked for with the administrator's own token, which is why it is
       read before anything is swapped. If the request fails, nothing has
       changed and they are still themselves. */
    const mine = getToken();
    const res = await membersApi.impersonate(memberId, reason);
    if (mine) setAdminToken(mine);
    setToken(res.token);

    try {
      const me = await authApi.me();
      setAccount(me.user);
      setSpecialist(me.specialist);
      setImpersonation(me.impersonation ?? null);
      return me.user;
    } catch (err) {
      // Could not stand the borrowed session up. Undo the swap rather
      // than leaving the browser holding a token it can't use.
      if (mine) {
        setToken(mine);
        setAdminToken(null);
      }
      throw err;
    }
  }, []);

  const stopImpersonation = useCallback(async () => {
    /* Sent with the borrowed token: the actor claim inside it is what
       tells the server which administrator to hand the session back to.
       The freshly-signed admin token comes back in the response, so an
       expired parked token is not a trap. */
    const res = await membersApi.stopImpersonating();
    setToken(res.token);
    setAdminToken(null);
    setImpersonation(null);
    setAccount(res.account);
    const me = await authApi.me().catch(() => null);
    setSpecialist(me?.specialist ?? null);
    return res.account;
  }, []);

  const value = useMemo(
    () => ({
      account,
      specialist,
      loading,
      impersonation,
      signIn,
      completeSignIn,
      signUp,
      signOut,
      refresh,
      adoptSession,
      startImpersonation,
      stopImpersonation,
    }),
    [
      account,
      specialist,
      loading,
      impersonation,
      signIn,
      completeSignIn,
      signUp,
      signOut,
      refresh,
      adoptSession,
      startImpersonation,
      stopImpersonation,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/**
 * Route guard. Waits for the session check before deciding, so a signed-in
 * user is never bounced to the login page on a refresh, and remembers
 * where they were headed so they land there after signing in.
 */
export function RequireAuth({ role, children }: { role?: "specialist" | "admin"; children: React.ReactNode }) {
  const { account, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-navy-950 text-sm text-white/60">Loading…</div>;
  }
  if (!account) return <Navigate to="/signin" state={{ from: location }} replace />;
  if (role && account.role !== role) {
    // Signed in, wrong workspace: send them to their own rather than a
    // dead end.
    return <Navigate to={account.role === "admin" ? "/admin" : "/dashboard"} replace />;
  }
  return <>{children}</>;
}
