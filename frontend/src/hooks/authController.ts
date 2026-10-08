import {
  authApi,
  AuthError,
  type AuthApi,
  type Session,
} from "@/api/auth/authApi";

type Pending = "password" | "google-start" | "complete" | "logout" | null;
export type AuthSnapshot = {
  status: "checking" | "anonymous" | "authenticated" | "error" | "redirecting";
  session: Session | null;
  error: unknown;
  pending: Pending;
  logoutRequired: boolean;
};
export const initialAuthSnapshot: AuthSnapshot = {
  status: "checking",
  session: null,
  error: null,
  pending: null,
  logoutRequired: false,
};

/** One coordinator per browser page. Never abort a mutation to claim its cookie response has settled. */
export function createAuthController(
  api: AuthApi,
  navigateGoogle: (url: string) => void,
) {
  let snapshot = initialAuthSnapshot;
  let generation = 0;
  let operation: { kind: Pending; promise: Promise<void> } | null = null;
  let read: Promise<void> | null = null;
  let logoutTask: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<AuthSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const failure = (error: unknown, quietUnauthorized = false) =>
    set({
      session: null,
      error:
        quietUnauthorized && error instanceof AuthError && error.status === 401
          ? null
          : error,
      status:
        error instanceof AuthError && error.status === 401
          ? "anonymous"
          : "error",
    });

  function refresh(): Promise<void> {
    if (snapshot.logoutRequired || operation)
      return operation?.promise ?? Promise.resolve();
    if (read) return read;
    const revision = ++generation;
    set({ status: "checking", session: null, error: null });
    const task = Promise.resolve()
      .then(() => api.session())
      .then((session) => {
        if (revision === generation)
          set({ status: "authenticated", session, error: null });
      })
      .catch((error: unknown) => {
        if (revision === generation) failure(error, true);
      })
      .finally(() => {
        if (read === task) read = null;
      });
    read = task;
    return task;
  }

  function mutate(
    kind: Exclude<Pending, "logout" | null>,
    action: (active: () => boolean) => Promise<void>,
  ) {
    if (operation || logoutTask || snapshot.logoutRequired)
      return operation?.promise ?? logoutTask ?? Promise.resolve();
    const revision = ++generation;
    read = null;
    set({ pending: kind, error: null, session: null, status: "anonymous" });
    const promise = Promise.resolve()
      .then(() =>
        action(() => revision === generation && !snapshot.logoutRequired),
      )
      .catch((error: unknown) => {
        if (revision === generation && !snapshot.logoutRequired) failure(error);
      })
      .finally(() => {
        operation = null;
        if (!snapshot.logoutRequired) set({ pending: null });
      });
    operation = { kind, promise };
    return promise;
  }

  async function currentIdentity(active: () => boolean) {
    if (!active()) return;
    const session = await api.session();
    if (active()) set({ status: "authenticated", session, error: null });
  }

  function logout(): Promise<void> {
    if (logoutTask) return logoutTask;
    const preceding = operation;
    ++generation;
    read = null;
    // Hide identity immediately, but keep login blocked until final cookie clear succeeds.
    set({
      logoutRequired: true,
      pending: "logout",
      session: null,
      error: null,
      status: "anonymous",
    });
    const task = (async () => {
      if (preceding) {
        // Cancel promptly, then wait for any response that could restore cookies.
        // Final cleanup repeats every logout step and must acknowledge them all.
        await api.logout().catch(() => undefined);
        await preceding.promise;
      }
      await api.logout();
      set({
        status: "anonymous",
        session: null,
        error: null,
        pending: null,
        logoutRequired: false,
      });
    })()
      .catch((error: unknown) => {
        set({
          status: "error",
          error,
          pending: null,
          session: null,
          logoutRequired: true,
        });
      })
      .finally(() => {
        logoutTask = null;
      });
    logoutTask = task;
    return task;
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    refresh,
    login: (email: string, password: string) =>
      mutate("password", async (active) => {
        await api.login(email, password, active);
        await currentIdentity(active);
      }),
    complete: () =>
      mutate("complete", async (active) => {
        if (active()) await api.complete();
        await currentIdentity(active);
      }),
    googleStart: () =>
      mutate("google-start", async (active) => {
        const url = await api.googleStart(active);
        if (active()) {
          set({ status: "redirecting" });
          navigateGoogle(url);
        }
      }),
    callbackError: (error: AuthError) => {
      if (!operation && !snapshot.logoutRequired) {
        ++generation;
        failure(error);
      }
    },
    logout,
  };
}

export const authController = createAuthController(authApi, (url) =>
  window.location.assign(url),
);
