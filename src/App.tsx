import React, { useState, useEffect, useMemo } from "react";

interface Account {
  id: string;
  name: string;
  balance: number;
  is_primary?: boolean;
}

interface Budget {
  id?: string;
  spent: number;
  monthly_limit: number;
  current_month: string;
}

interface Transaction {
  id: string;
  account_id: string;
  account_name: string;
  amount: number;
  type: "debit" | "credit";
  category: string | null;
  message_raw: string;
  created_at: string;
}

export default function App() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [totalNetWorth, setTotalNetWorth] = useState<number>(0);
  const [budget, setBudget] = useState<Budget>({
    spent: 0,
    monthly_limit: 15000,
    current_month: "2026-08",
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Filters
  const [selectedAccountFilter, setSelectedAccountFilter] = useState<string>("all");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals & Forms
  const [showAddAccountModal, setShowAddAccountModal] = useState<boolean>(false);
  const [newAccountName, setNewAccountName] = useState<string>("");
  const [newAccountBalance, setNewAccountBalance] = useState<string>("");

  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editAccName, setEditAccName] = useState<string>("");
  const [editAccBalance, setEditAccBalance] = useState<string>("");

  const [showEditBudgetModal, setShowEditBudgetModal] = useState<boolean>(false);
  const [newBudgetLimit, setNewBudgetLimit] = useState<string>("");

  const [txToDelete, setTxToDelete] = useState<Transaction | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);

  // Toast / Error messages
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // ── Data Fetching ──────────────────────────────────────────────────────────
  const fetchDashboardData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    else setRefreshing(true);

    try {
      const [accRes, budRes, txRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/budget"),
        fetch("/api/transactions?limit=200"),
      ]);

      if (accRes.ok) {
        const accData = await accRes.json();
        setAccounts(accData.accounts || []);
        setTotalNetWorth(accData.total || 0);
      }

      if (budRes.ok) {
        const budData = await budRes.json();
        setBudget(budData);
      }

      if (txRes.ok) {
        const txData = await txRes.json();
        setTransactions(txData.transactions || []);
      }
    } catch (err: any) {
      console.error("Dashboard fetch error:", err);
      showToast("Failed to load live data from server", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // ── Account Actions ────────────────────────────────────────────────────────
  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccountName.trim()) return;

    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newAccountName.trim(),
          balance: Number(newAccountBalance) || 0,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to create account", "error");
        return;
      }

      showToast(`Account "${newAccountName}" created successfully!`);
      setShowAddAccountModal(false);
      setNewAccountName("");
      setNewAccountBalance("");
      fetchDashboardData(true);
    } catch (err: any) {
      showToast(err.message || "Failed to create account", "error");
    }
  };

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;

    try {
      const res = await fetch(`/api/accounts?id=${editingAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editAccName.trim(),
          balance: Number(editAccBalance),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to update account", "error");
        return;
      }

      showToast(`Account "${editAccName}" updated successfully!`);
      setEditingAccount(null);
      fetchDashboardData(true);
    } catch (err: any) {
      showToast(err.message || "Failed to update account", "error");
    }
  };

  const handleSetPrimaryAccount = async (acc: Account) => {
    try {
      const res = await fetch(`/api/accounts?id=${acc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_primary: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to set primary account", "error");
        return;
      }

      showToast(`"${acc.name}" is now your primary account ⭐`);
      fetchDashboardData(true);
    } catch (err: any) {
      showToast(err.message || "Failed to set primary account", "error");
    }
  };

  const handleDeleteAccount = async () => {
    if (!accountToDelete) return;

    try {
      const res = await fetch(`/api/accounts?id=${accountToDelete.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Cannot delete account", "error");
        setAccountToDelete(null);
        return;
      }

      showToast(data.message || `Account "${accountToDelete.name}" deleted`);
      setAccountToDelete(null);
      fetchDashboardData(true);
    } catch (err: any) {
      showToast(err.message || "Failed to delete account", "error");
      setAccountToDelete(null);
    }
  };

  // ── Budget Actions ─────────────────────────────────────────────────────────
  const handleUpdateBudgetLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    const limit = Number(newBudgetLimit);
    if (isNaN(limit) || limit <= 0) return;

    try {
      const res = await fetch("/api/budget", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_limit: limit }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to update budget limit", "error");
        return;
      }

      showToast(`Monthly budget limit updated to ₹${limit.toLocaleString("en-IN")}`);
      setShowEditBudgetModal(false);
      fetchDashboardData(true);
    } catch (err: any) {
      showToast(err.message || "Failed to update budget", "error");
    }
  };

  // ── Transaction Actions ────────────────────────────────────────────────────
  const handleDeleteTransaction = async () => {
    if (!txToDelete) return;

    try {
      const res = await fetch(`/api/transactions?id=${txToDelete.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to delete transaction", "error");
        setTxToDelete(null);
        return;
      }

      showToast(`Transaction reversed & removed! Balance adjusted. 🔄`);
      setTxToDelete(null);
      fetchDashboardData(true);
    } catch (err: any) {
      showToast(err.message || "Failed to delete transaction", "error");
      setTxToDelete(null);
    }
  };

  // ── Computed Categories & Filtered Transactions ────────────────────────────
  const uniqueCategories = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => {
      if (t.category) set.add(t.category.toLowerCase());
    });
    return Array.from(set);
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // Account filter
      if (selectedAccountFilter !== "all" && t.account_id !== selectedAccountFilter) {
        return false;
      }
      // Category filter
      if (selectedCategoryFilter !== "all") {
        if (!t.category || t.category.toLowerCase() !== selectedCategoryFilter.toLowerCase()) {
          return false;
        }
      }
      // Type filter
      if (selectedTypeFilter !== "all" && t.type !== selectedTypeFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesCat = (t.category || "").toLowerCase().includes(q);
        const matchesMsg = (t.message_raw || "").toLowerCase().includes(q);
        const matchesAcc = t.account_name.toLowerCase().includes(q);
        const matchesAmt = t.amount.toString().includes(q);
        if (!matchesCat && !matchesMsg && !matchesAcc && !matchesAmt) return false;
      }
      return true;
    });
  }, [transactions, selectedAccountFilter, selectedCategoryFilter, selectedTypeFilter, searchQuery]);

  // Budget calculations
  const budgetRatio = budget.monthly_limit > 0 ? (budget.spent / budget.monthly_limit) * 100 : 0;
  const isBudgetWarning = budgetRatio >= 80 && budgetRatio < 100;
  const isBudgetExceeded = budgetRatio >= 100;

  // Currency Formatter
  const formatINR = (val: number) => {
    return "₹" + Math.round(val).toLocaleString("en-IN");
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "32px 20px 80px" }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            top: "24px",
            right: "24px",
            zIndex: 9999,
            padding: "14px 22px",
            borderRadius: "var(--radius-md)",
            background: toastMessage.type === "success" ? "#064e3b" : "#881337",
            border: `1px solid ${toastMessage.type === "success" ? "var(--success)" : "var(--danger)"}`,
            color: "#ffffff",
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            fontSize: "0.9rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            animation: "slide-down 0.2s ease-out",
          }}
        >
          <span>{toastMessage.type === "success" ? "✓" : "⚠️"}</span>
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Header Bar */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "36px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.3rem",
              boxShadow: "0 4px 20px rgba(99, 102, 241, 0.4)",
            }}
          >
            💳
          </div>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
              WhatsApp Expense Tracker
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
              <div className="pulse-dot"></div>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                Live Cloud Sync • +91 74288 49276
              </span>
            </div>
          </div>
        </div>

        <button
          className="btn btn-secondary"
          onClick={() => fetchDashboardData(true)}
          disabled={refreshing}
          style={{ opacity: refreshing ? 0.6 : 1 }}
        >
          <span style={{ display: "inline-block", transform: refreshing ? "rotate(180deg)" : "none", transition: "transform 0.4s" }}>
            🔄
          </span>
          {refreshing ? "Syncing..." : "Refresh"}
        </button>
      </header>

      {/* Overview Cards Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "20px",
          marginBottom: "36px",
        }}
      >
        {/* Card 1: Total Net Worth */}
        <div className="glass-panel" style={{ padding: "26px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Total Net Worth
            </span>
            <span style={{ fontSize: "1.2rem" }}>💰</span>
          </div>
          <div style={{ fontSize: "2.4rem", fontWeight: 800, letterSpacing: "-0.03em", color: "#ffffff" }}>
            {formatINR(totalNetWorth)}
          </div>
          <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="badge badge-primary-acc">
              {accounts.length} {accounts.length === 1 ? "Account" : "Accounts"} Active
            </span>
          </div>
        </div>

        {/* Card 2: Monthly Budget Progress */}
        <div className="glass-panel" style={{ padding: "26px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Monthly Budget ({budget.current_month})
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setNewBudgetLimit(budget.monthly_limit.toString());
                setShowEditBudgetModal(true);
              }}
            >
              ✏️ Edit Limit
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
              {formatINR(budget.spent)}
            </div>
            <div style={{ fontSize: "0.95rem", color: "var(--text-muted)", fontWeight: 500 }}>
              of {formatINR(budget.monthly_limit)}
            </div>
          </div>

          {/* Progress Bar */}
          <div
            style={{
              width: "100%",
              height: "10px",
              borderRadius: "999px",
              background: "rgba(255, 255, 255, 0.08)",
              overflow: "hidden",
              margin: "14px 0 8px",
            }}
          >
            <div
              style={{
                width: `${Math.min(budgetRatio, 100)}%`,
                height: "100%",
                borderRadius: "999px",
                background: isBudgetExceeded
                  ? "linear-gradient(90deg, #f43f5e 0%, #e11d48 100%)"
                  : isBudgetWarning
                  ? "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)"
                  : "linear-gradient(90deg, #10b981 0%, #059669 100%)",
                transition: "width 0.5s ease-in-out",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
            <span style={{ color: isBudgetExceeded ? "var(--danger)" : isBudgetWarning ? "var(--warning)" : "var(--success)", fontWeight: 600 }}>
              {isBudgetExceeded ? "⚠️ Budget Exceeded" : isBudgetWarning ? "⚠️ Used 80%+" : "✓ Within Limit"}
            </span>
            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {budgetRatio.toFixed(1)}% spent
            </span>
          </div>
        </div>
      </div>

      {/* Accounts Management Section */}
      <section style={{ marginBottom: "40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Accounts Management</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "2px" }}>
              Configure balances and manage your default primary account
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddAccountModal(true)}>
            ➕ Add Account
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "16px",
          }}
        >
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="glass-panel"
              style={{
                padding: "20px",
                position: "relative",
                borderLeft: acc.is_primary ? "4px solid #6366f1" : "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 700, textTransform: "capitalize" }}>
                    {acc.name}
                  </h3>
                  {acc.is_primary ? (
                    <span className="badge badge-primary-acc" style={{ marginTop: "4px" }}>
                      ⭐ Primary Account
                    </span>
                  ) : (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: "4px", padding: "2px 8px", fontSize: "0.72rem" }}
                      onClick={() => handleSetPrimaryAccount(acc)}
                    >
                      Make Primary
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ padding: "5px 8px" }}
                    title="Edit Account"
                    onClick={() => {
                      setEditingAccount(acc);
                      setEditAccName(acc.name);
                      setEditAccBalance(acc.balance.toString());
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    style={{ padding: "5px 8px" }}
                    title="Delete Account"
                    onClick={() => setAccountToDelete(acc)}
                  >
                    🗑️
                  </button>
                </div>
              </div>

              <div style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "14px" }}>
                {formatINR(acc.balance)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Transactions Section */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Transactions Ledger</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "2px" }}>
              {filteredTransactions.length} of {transactions.length} transactions shown
            </p>
          </div>

          {/* Filters Bar */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            {/* Search Input */}
            <input
              type="text"
              placeholder="Search memo or category..."
              className="input-field"
              style={{ width: "200px", padding: "8px 12px", fontSize: "0.85rem" }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {/* Account Filter */}
            <select
              className="input-field select-field"
              style={{ width: "150px", padding: "8px 12px", fontSize: "0.85rem" }}
              value={selectedAccountFilter}
              onChange={(e) => setSelectedAccountFilter(e.target.value)}
            >
              <option value="all">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            {/* Category Filter */}
            <select
              className="input-field select-field"
              style={{ width: "150px", padding: "8px 12px", fontSize: "0.85rem" }}
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>

            {/* Type Filter */}
            <select
              className="input-field select-field"
              style={{ width: "130px", padding: "8px 12px", fontSize: "0.85rem" }}
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="debit">Debits</option>
              <option value="credit">Credits</option>
            </select>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="glass-panel" style={{ overflowX: "auto" }}>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading ledger data...
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div style={{ padding: "50px", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "2rem", marginBottom: "10px" }}>📭</div>
              No transactions match your current filters.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={{ padding: "16px 20px" }}>Date & Time</th>
                  <th style={{ padding: "16px 20px" }}>Account</th>
                  <th style={{ padding: "16px 20px" }}>Category / Memo</th>
                  <th style={{ padding: "16px 20px" }}>Type</th>
                  <th style={{ padding: "16px 20px", textAlign: "right" }}>Amount</th>
                  <th style={{ padding: "16px 20px", textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.map((tx) => {
                  const dateObj = new Date(tx.created_at);
                  const formattedDate = dateObj.toLocaleDateString("en-IN", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                  const formattedTime = dateObj.toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <tr
                      key={tx.id}
                      style={{
                        borderBottom: "1px solid var(--border-subtle)",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.02)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <td style={{ padding: "16px 20px", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 600 }}>{formattedDate}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                          {formattedTime}
                        </div>
                      </td>
                      <td style={{ padding: "16px 20px" }}>
                        <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{tx.account_name}</span>
                      </td>
                      <td style={{ padding: "16px 20px" }}>
                        <div style={{ fontWeight: 600, color: tx.category ? "var(--text-primary)" : "var(--text-muted)" }}>
                          {tx.category ? tx.category.charAt(0).toUpperCase() + tx.category.slice(1) : "Uncategorized"}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tx.message_raw}
                        </div>
                      </td>
                      <td style={{ padding: "16px 20px" }}>
                        <span className={`badge ${tx.type === "credit" ? "badge-credit" : "badge-debit"}`}>
                          {tx.type === "credit" ? "+ Credit" : "- Debit"}
                        </span>
                      </td>
                      <td style={{ padding: "16px 20px", textAlign: "right", fontWeight: 700, fontSize: "1rem", color: tx.type === "credit" ? "var(--success)" : "#ffffff" }}>
                        {tx.type === "credit" ? "+" : "-"}
                        {formatINR(tx.amount)}
                      </td>
                      <td style={{ padding: "16px 20px", textAlign: "center" }}>
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                          title="Delete and reverse balance effect"
                          onClick={() => setTxToDelete(tx)}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── MODALS ──────────────────────────────────────────────────────────── */}

      {/* Add Account Modal */}
      {showAddAccountModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "420px", padding: "30px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "16px" }}>Add New Account</h3>
            <form onSubmit={handleAddAccount}>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Account Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. HDFC, Savings, Cash"
                  className="input-field"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                />
              </div>
              <div style={{ marginBottom: "22px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Starting Balance (₹)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  className="input-field"
                  value={newAccountBalance}
                  onChange={(e) => setNewAccountBalance(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddAccountModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "420px", padding: "30px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "16px" }}>Edit Account</h3>
            <form onSubmit={handleUpdateAccount}>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Account Name
                </label>
                <input
                  type="text"
                  required
                  className="input-field"
                  value={editAccName}
                  onChange={(e) => setEditAccName(e.target.value)}
                />
              </div>
              <div style={{ marginBottom: "22px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Current Balance (₹)
                </label>
                <input
                  type="number"
                  required
                  className="input-field"
                  value={editAccBalance}
                  onChange={(e) => setEditAccBalance(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingAccount(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Budget Modal */}
      {showEditBudgetModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "420px", padding: "30px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "16px" }}>Update Monthly Budget Limit</h3>
            <form onSubmit={handleUpdateBudgetLimit}>
              <div style={{ marginBottom: "22px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Monthly Spending Limit (₹)
                </label>
                <input
                  type="number"
                  required
                  placeholder="15000"
                  className="input-field"
                  value={newBudgetLimit}
                  onChange={(e) => setNewBudgetLimit(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditBudgetModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Update Budget
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Transaction Confirmation Modal */}
      {txToDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "440px", padding: "30px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "12px", color: "var(--danger)" }}>
              Delete Transaction?
            </h3>
            <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "16px" }}>
              Are you sure you want to delete this {txToDelete.type} of <strong>{formatINR(txToDelete.amount)}</strong> from <strong>{txToDelete.account_name}</strong>?
            </p>
            <div style={{ background: "rgba(244, 63, 94, 0.08)", border: "1px solid var(--danger-border)", padding: "12px 16px", borderRadius: "var(--radius-md)", fontSize: "0.8rem", color: "#fca5a5", marginBottom: "22px" }}>
              🔄 <strong>Ledger Reversal:</strong> Deleting will automatically reverse its effect on your account balance {txToDelete.type === "debit" ? "and reduce your monthly spent budget" : ""}.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setTxToDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDeleteTransaction}>
                Yes, Delete & Reverse
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {accountToDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "440px", padding: "30px" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "12px", color: "var(--danger)" }}>
              Delete Account "{accountToDelete.name}"?
            </h3>
            <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "20px" }}>
              Accounts with existing transactions or active primary status cannot be deleted until reassigned or cleared.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setAccountToDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDeleteAccount}>
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
