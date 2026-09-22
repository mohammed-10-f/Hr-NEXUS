-- HR Nexus next phase: non-destructive company management extension.
-- Keeps the existing companies.status column intact and adds an explicit
-- operational status for the approved Active/Inactive company lifecycle.
PRAGMA foreign_keys = ON;

ALTER TABLE companies ADD COLUMN management_status TEXT NOT NULL DEFAULT 'active'
  CHECK (management_status IN ('active','inactive'));

ALTER TABLE company_access_requests ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE company_users ADD COLUMN display_name TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_management_status ON companies(management_status);
CREATE INDEX IF NOT EXISTS idx_company_users_admin_status ON company_users(company_id,status);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON company_access_requests(status,requested_at);

-- Existing companies are active unless explicitly changed by the new UI/API.
UPDATE companies SET management_status='active' WHERE management_status IS NULL;
