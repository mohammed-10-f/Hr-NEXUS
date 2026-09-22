export type Env = {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    SESSION_COOKIE?: string;
  };
  Variables: {
    session: import('../shared/types').SessionContext | null;
  };
};
