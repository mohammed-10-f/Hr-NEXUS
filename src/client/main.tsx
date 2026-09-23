import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Dashboard } from './pages/Dashboard';
import { Employees } from './pages/Employees';
import { EmployeeProfile } from './pages/EmployeeProfile';
import { Organization } from './pages/Organization';
import { ComingSoon } from './pages/ComingSoon';
import { NewEmployee } from './pages/NewEmployee';
import { Login } from './pages/Login';
import { PlatformCompanies } from './pages/PlatformCompanies';
import { ChangePassword } from './pages/ChangePassword';
import { AccessRequests } from './pages/AccessRequests';
import { PlatformCompanyForm } from './pages/PlatformCompanyForm';
import { PlatformCompanyDetails } from './pages/PlatformCompanyDetails';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Routes>
<Route path="/login" element={<Login/>}/><Route path="/change-password" element={<ChangePassword/>}/><Route element={<AppShell/>}>
<Route path="/" element={<Dashboard/>}/><Route path="/platform" element={<PlatformCompanies/>}/><Route path="/platform/companies" element={<PlatformCompanies/>}/><Route path="/platform/companies/new" element={<PlatformCompanyForm/>}/><Route path="/platform/companies/:id" element={<PlatformCompanyDetails/>}/><Route path="/access-requests" element={<AccessRequests/>}/>
<Route path="/employees" element={<Employees/>}/><Route path="/employees/new" element={<NewEmployee/>}/><Route path="/employees/:id" element={<EmployeeProfile/>}/><Route path="/organization" element={<Organization/>}/><Route path="*" element={<ComingSoon/>}/>
</Route></Routes></BrowserRouter></React.StrictMode>);
