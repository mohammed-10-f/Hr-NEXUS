export type AccessMode = 'platform' | 'company_user' | 'super_admin_company_access';

export type SessionContext = {
  sessionId: string;
  sessionType: 'platform' | 'company';
  platformUserId: string | null;
  companyUserId: string | null;
  activeCompanyId: string | null;
  accessMode: AccessMode;
  roles: string[];
  employeeId: string | null;
  mustChangePassword: boolean;
  company?: { id: string; companyIdentifier: string; displayName: string; legalName: string; status: string };
};
