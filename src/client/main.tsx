import React, { Component, type ErrorInfo, type ReactNode } from 'react';
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
import { Users } from './pages/Users';
import { Roles } from './pages/Roles';
import { EmployeeSettings } from './pages/EmployeeSettings';
import { WorkflowAdmin } from './pages/WorkflowAdmin';
import { WorkflowTestEnvironment } from './pages/WorkflowTestEnvironment';
import { WorkflowTestList } from './pages/WorkflowTestList';
import { CompanyTransactions } from './pages/CompanyTransactions';
import { CompanyTransactionsCompany } from './pages/CompanyTransactionsCompany';
import { CompanyTransactionDetail } from './pages/CompanyTransactionDetail';
import { Transactions } from './pages/Transactions';
import { NewTransaction } from './pages/NewTransaction';
import { TransactionDetail } from './pages/TransactionDetail';
import './styles.css';

class AppErrorBoundary extends Component<{children:ReactNode},{hasError:boolean}> {
  state={hasError:false};
  static getDerivedStateFromError(){return {hasError:true};}
  componentDidCatch(error:unknown, info:ErrorInfo){console.error('HR_NEXUS_FRONTEND_ERROR',error,info);}
  render(){
    if(this.state.hasError) return <div className="panel-empty"><h3>تعذر عرض الصفحة</h3><p>حدث خطأ غير متوقع في الواجهة. أعد المحاولة دون فقدان جلسة المستخدم.</p><button className="login-submit" onClick={()=>this.setState({hasError:false})}>إعادة المحاولة</button></div>;
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<AppErrorBoundary><React.StrictMode><BrowserRouter><Routes>
<Route path="/login" element={<Login/>}/><Route path="/change-password" element={<ChangePassword/>}/><Route element={<AppShell/>}>
<Route path="/" element={<Dashboard/>}/><Route path="/platform" element={<PlatformCompanies/>}/><Route path="/platform/companies" element={<PlatformCompanies/>}/><Route path="/platform/companies/new" element={<PlatformCompanyForm/>}/><Route path="/platform/companies/:id" element={<PlatformCompanyDetails/>}/><Route path="/access-requests" element={<AccessRequests/>}/>
<Route path="/employees" element={<Employees/>}/><Route path="/employees/new" element={<NewEmployee/>}/><Route path="/employees/settings" element={<EmployeeSettings/>}/><Route path="/platform/workflows" element={<WorkflowAdmin/>}/><Route path="/platform/workflows/test" element={<WorkflowTestList/>}/><Route path="/platform/workflows/test/:typeId" element={<WorkflowTestEnvironment/>}/><Route path="/platform/company-transactions" element={<CompanyTransactions/>}/><Route path="/platform/company-transactions/:companyId" element={<CompanyTransactionsCompany/>}/><Route path="/platform/company-transactions/:companyId/transactions/:id" element={<CompanyTransactionDetail/>}/><Route path="/transactions" element={<Transactions/>}/><Route path="/transactions/new" element={<NewTransaction/>}/><Route path="/transactions/:id" element={<TransactionDetail/>}/><Route path="/employees/:id" element={<EmployeeProfile/>}/><Route path="/organization" element={<Organization/>}/><Route path="/users" element={<Users/>}/><Route path="/roles" element={<Roles/>}/><Route path="*" element={<ComingSoon/>}/>
</Route></Routes></BrowserRouter></React.StrictMode></AppErrorBoundary>);
