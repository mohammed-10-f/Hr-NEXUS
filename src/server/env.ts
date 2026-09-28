export type Env = {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    SESSION_COOKIE?: string;
    COMPANY_ACCESS_COOKIE?: string;
    SESSION_TTL_SECONDS?: string;
    COMPANY_ACCESS_TTL_SECONDS?: string;
  };
  Variables: {
    session: import('../shared/types').SessionContext | null;
  };
};
