export type SessionContext = {
  tenantId: string;
  userId: string;
  employeeId: string | null;
  roles: string[];
};

export type EmployeeStatus = 'active' | 'suspended' | 'leave' | 'terminated';

export type EmployeeListItem = {
  id: string;
  employee_number: string;
  name: string;
  job_title: string | null;
  department: string | null;
  manager: string | null;
  status: EmployeeStatus;
  join_date: string | null;
};
