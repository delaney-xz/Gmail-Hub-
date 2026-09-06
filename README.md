# Gmail Hub & Live 2-Step Verification Portal

A complete, enterprise-grade account management portal built specifically to manage and display Gmail accounts for **Customers**, **Workers**, and **Administrators** with real-time RFC 6238 TOTP 2-step verification codes, 1-click copy icons, and live Google Sheets synchronization.

---

## 🚀 Quick Start (Localhost)

1. Double-click **`start_server.bat`** (or run `powershell -ExecutionPolicy Bypass -File server.ps1`).
2. Your browser will open automatically at:
   👉 **`http://localhost:5000`**

---

## 🌟 Portals & Permissions

### 1. 👤 Customer Portal (Default Public View)
- **View-Only Access:** Customers **cannot edit** any data or change statuses.
- **Protected Passwords:** Passwords are hidden (`🔒 Hidden`) by default unless specifically unlocked by the Admin.
- **Live 2FA Spotlight:** Real-time 6-digit verification code with animated 30s countdown bar and system clock.
- **Copy Icons:** One-click copy buttons for visible fields (Gmail, Recovery Email, 2FA code).
- **Search & Filters:** Filter by Available, Active, Sold, Pending, or search by text.

### 2. 🛠️ Worker / Employee Portal
- **Passcode:** `worker123`
- **View All Passwords:** Workers can see all passwords and reveal/hide plaintext using the eye icon.
- **Full Edit Permissions:** Workers can:
  - Edit account credentials (password, recovery email, 2FA seed).
  - Quick-change account status via the inline dropdown (`Available`, `Active`, `Sold`, `Pending`).
  - Add new accounts via the **+ Add Account** button.
- **Fast Workflow:** 1-click copy icon next to every single cell (Gmail, Password, 2FA, Recovery).
- **Safety Restriction:** Workers cannot delete accounts or alter customer visibility toggles (reserved for Admin).

### 3. 👑 Admin Panel
- **Credentials:** Username: `admin` | Password: `admin123`
- **Full Master Permissions:**
  - Add, edit, and delete any account record.
  - Per-row Customer Visibility switches:
    - `🔒 Pass Hidden` / `👁️ Pass Shown`: Hide or show password to customers for any account.
    - `🚫 2FA Hidden` / `⚡ 2FA Shown`: Hide or show live 2FA codes to customers for any account.
  - Live Analytics Cards (Total, Available, Active, Sold, Protected Passwords).

---

## 🔄 Google Sheets Live Synchronization

The portal is connected to your Google Sheet:
`https://docs.google.com/spreadsheets/d/13uKQBxLRbF5lc65GeXimDdVTjao-FsqDALVbhLXAHEA/edit?gid=0#gid=0`

### How to Sync:
1. Click the **"Sync Sheet"** button in the header.
2. Select the Tab to sync:
   - **Customer Sheet (gid=0)** — *Default, where your accounts are stored!*
   - Worker Sheet (gid=1740739210)
   - Admin Sheet (gid=1453310958)
3. Choose Sync Mode:
   - **Merge:** Updates existing accounts and adds new rows from the sheet while keeping existing local settings.
   - **Fresh Replace:** Replaces all local accounts with the live data from the sheet.
4. Click **"Fetch & Sync Live"**.

### Exporting Back to Google Sheets:
- Click the **"Export CSV"** button in the Worker or Admin header to download the updated accounts formatted exactly as the Google Sheet columns (`Serial number, Gmail, Password, live 2fa code, Recovery mails, Status`).

---

## ⏱️ Real-Time 2-Step Verification (TOTP)
- Implements RFC 6238 TOTP using native Web Crypto API (`crypto.subtle`).
- Works with 16/32-character Base32 seeds (e.g., `znv2 szqq y4tn m5k5 skwk lpk3 nbvp mhl5`) as well as direct codes.
- Codes dynamically recalculate every second and refresh every 30 seconds with animated countdown bars and warnings.
