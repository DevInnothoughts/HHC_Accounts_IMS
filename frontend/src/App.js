// ============================================================
// FRONTEND: src/App.js — REPLACE WHOLE FILE
// Vendor Master, Phase 2: 3 imports + 4 /vendor-masters routes.
// ============================================================
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import React from "react";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import InvoiceRequests from "./pages/InvoiceRequests.jsx";
import InvoiceDetail from "./pages/InvoiceDetail.jsx";
import CreatePaymentRequest from "./pages/CreatePaymentRequest.jsx";
import EditPaymentRequest from "./pages/EditPaymentRequest.jsx";
import PaymentProcessing from "./pages/PaymentProcessing.jsx";
import PaymentDetail from "./pages/PaymentDetail.jsx";
import Vendors from "./pages/Vendors.jsx";
import VendorForm from "./pages/VendorForm.jsx";
import VendorDetail from "./pages/VendorDetail.jsx";
import VendorMasters from "./pages/VendorMasters.jsx";
import VendorMasterForm from "./pages/VendorMasterForm.jsx";
import VendorMasterDetail from "./pages/VendorMasterDetail.jsx";
import Reports from "./pages/Reports.jsx";
import UserManagement from "./pages/UserManagement.jsx";
import BranchManagement from "./pages/BranchManagement.jsx";
import ExpenseCategories from "./pages/ExpenseCategories.jsx";
import AuditLogs from "./pages/AuditLogs.jsx";
import BudgetManagement from "./pages/BudgetManagement.jsx";
import SLADashboard from "./pages/SLADashboard.jsx";
import PrimaryReports from "./pages/PrimaryReports.jsx";
import FixedPayments from "./pages/FixedPayments.jsx";
import CreditNotes from "./pages/CreditNotes.jsx";

const ProtectedRoute = ({ children, roles }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/dashboard" replace />;
  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter
        basename={process.env.NODE_ENV === "production" ? "/hhc" : "/"}
      >
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Dashboard */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Invoice Processing */}
          <Route
            path="/invoices"
            element={
              <ProtectedRoute>
                <InvoiceRequests />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/new"
            element={
              <ProtectedRoute roles={["branch_user", "accounts"]}>
                <CreatePaymentRequest />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <ProtectedRoute>
                <InvoiceDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/:id/edit"
            element={
              <ProtectedRoute
                roles={["branch_user", "accounts", "super_admin"]}
              >
                <EditPaymentRequest />
              </ProtectedRoute>
            }
          />

          {/* Fixed (recurring) monthly payments */}
          <Route
            path="/fixed-payments"
            element={
              <ProtectedRoute roles={["accounts", "super_admin"]}>
                <FixedPayments />
              </ProtectedRoute>
            }
          />

          {/* Credit notes against approved invoices */}
          <Route
            path="/credit-notes"
            element={
              <ProtectedRoute
                roles={["branch_user", "accounts", "super_admin"]}
              >
                <CreditNotes />
              </ProtectedRoute>
            }
          />

          {/* Payment Processing */}
          <Route
            path="/payments"
            element={
              <ProtectedRoute>
                <PaymentProcessing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payments/:id"
            element={
              <ProtectedRoute>
                <PaymentDetail />
              </ProtectedRoute>
            }
          />

          {/* ✅ Vendor Master — group-level, one record per PAN.
              Static "/new" is declared before "/:id". */}
          <Route
            path="/vendor-masters"
            element={
              <ProtectedRoute roles={["accounts", "super_admin"]}>
                <VendorMasters />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor-masters/new"
            element={
              <ProtectedRoute roles={["accounts", "super_admin"]}>
                <VendorMasterForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor-masters/:id"
            element={
              <ProtectedRoute>
                {/* Any role; the API masks it for branches that don't use it */}
                <VendorMasterDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendor-masters/:id/edit"
            element={
              <ProtectedRoute
                roles={["branch_user", "accounts", "super_admin"]}
              >
                {/* branch_user: only their own draft/rejected record —
                    enforced by the API and the form itself */}
                <VendorMasterForm />
              </ProtectedRoute>
            }
          />

          {/* Vendors */}
          <Route
            path="/vendors"
            element={
              <ProtectedRoute>
                <Vendors />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendors/new"
            element={
              <ProtectedRoute
                roles={["branch_user", "accounts", "super_admin"]}
              >
                <VendorForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendors/:id"
            element={
              <ProtectedRoute>
                <VendorDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendors/:id/edit"
            element={
              <ProtectedRoute
                roles={["branch_user", "accounts", "super_admin"]}
              >
                <VendorForm />
              </ProtectedRoute>
            }
          />

          {/* Admin & Reports */}
          <Route
            path="/reports"
            element={
              <ProtectedRoute
                roles={["accounts", "super_admin", "cluster_head", "director"]}
              >
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/primary"
            element={
              <ProtectedRoute
                roles={["accounts", "super_admin", "director", "cluster_head"]}
              >
                <PrimaryReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute roles={["super_admin", "accounts"]}>
                <UserManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/branches"
            element={
              <ProtectedRoute roles={["super_admin"]}>
                <BranchManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expense-categories"
            element={
              <ProtectedRoute roles={["super_admin", "accounts"]}>
                <ExpenseCategories />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <ProtectedRoute roles={["super_admin", "accounts"]}>
                <AuditLogs />
              </ProtectedRoute>
            }
          />
          <Route
            path="/budgets"
            element={
              <ProtectedRoute roles={["super_admin", "accounts"]}>
                <BudgetManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sla"
            element={
              <ProtectedRoute roles={["super_admin", "accounts"]}>
                <SLADashboard />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
