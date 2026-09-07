/**
 * Gmail Hub & Live 2FA Verification Portal - Frontend Controller
 * Complete state preservation, instant role switching, and per-row TOTP generation
 */

// Application State
const API_BASE = 'https://script.google.com/macros/s/AKfycbzdPOjwlwcZLerYM1KStgofzqswB2l4Mqza37ayUU6OiPnRVfbuzNA-E5CKt2DUZaj7WQ/exec';
let currentRole = 'customer'; // 'customer', 'worker', 'admin'
let accounts = [];
let activeFilter = 'ALL';
let searchQuery = '';
let revealedPasswords = new Set();
let tickerInterval = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Restore saved theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    // Initial load
    await loadAccounts();

    // Start real-time 1-second TOTP ticker
    startLive2FATicker();
});

/**
 * Fetch accounts from Backend API
 */
async function loadAccounts() {
    try {
        const res = await fetch(API_BASE, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'getAccounts', role: currentRole })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (payload.success && Array.isArray(payload.accounts)) {
            accounts = payload.accounts;
        } else if (Array.isArray(payload)) {
            accounts = payload;
        } else {
            console.warn('Unexpected getAccounts response', payload);
            accounts = [];
        }
        applyFilters();
        updateFilterCounts();
        updateAdminStats();
    } catch (err) {
        console.error('Failed to load accounts:', err);
        showToast('Error fetching accounts from server', 'error');
    }
}

/**
 * Switch Role (Customer, Worker, Admin)
 * Seamless, immediate role switching without data loss or blocking modals
 */
async function setRole(role) {
    if (role === currentRole) return;
    currentRole = role;

    // Reset status filter to 'ALL' to ensure no accounts are hidden when switching
    activeFilter = 'ALL';
    searchQuery = '';
    const searchEl = document.getElementById('search-input');
    if (searchEl) searchEl.value = '';

    // Update Nav buttons
    document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-role-${role}`)?.classList.add('active');

    // Header Actions: Add Account & Export CSV visible for Worker and Admin
    const btnAdd = document.getElementById('btn-add-account');
    const btnExport = document.getElementById('btn-export-csv');

    if (btnAdd) {
        btnAdd.style.display = (role === 'admin' || role === 'worker') ? 'inline-flex' : 'none';
    }
    if (btnExport) {
        btnExport.style.display = (role === 'admin' || role === 'worker') ? 'inline-flex' : 'none';
    }

    // Admin Stats row & Customer Visibility Column
    const statsRow = document.getElementById('admin-stats-row');
    const thAdminVis = document.getElementById('th-admin-vis');
    if (role === 'admin') {
        if (statsRow) statsRow.style.display = 'grid';
        if (thAdminVis) thAdminVis.style.display = 'table-cell';
    } else {
        if (statsRow) statsRow.style.display = 'none';
        if (thAdminVis) thAdminVis.style.display = 'none';
    }

    // Update Banner Text
    const banner = document.getElementById('portal-banner');
    const bannerText = document.getElementById('banner-text');
    const bannerBadge = document.getElementById('banner-badge-text');

    if (banner) {
        banner.className = `portal-banner ${role}`;
        if (role === 'customer') {
            bannerText.innerHTML = '<strong>Customer Mode:</strong> Passwords are protected. View-only access with live per-row 2FA codes and 1-click copy icons.';
            bannerBadge.innerText = 'Read-Only';
        } else if (role === 'worker') {
            bannerText.innerHTML = '<strong>Worker Mode:</strong> Full edit permissions. View passwords, update statuses, edit account details, and copy fields with 1-click.';
            bannerBadge.innerText = 'Worker Access';
        } else if (role === 'admin') {
            bannerText.innerHTML = '<strong>Admin Panel:</strong> Master control. Full CRUD, toggle customer visibility per row, and sync with Google Sheets.';
            bannerBadge.innerText = 'Administrator';
        }
    }

    // Re-render immediately from in-memory state, then refresh from server
    applyFilters();
    showToast(`Switched to ${role.toUpperCase()} mode`, 'info');

    // Fetch role-specific sanitized/full data in background
    try {
        const res = await fetch(`accounts?role=${currentRole}`);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
                accounts = data;
                applyFilters();
                updateFilterCounts();
                updateAdminStats();
            }
        }
    } catch (e) {
        console.warn('Background refresh warning:', e);
    }
}

/**
 * Filter & Search logic
 */
function setStatusFilter(status) {
    activeFilter = status;
    document.querySelectorAll('.filter-pill').forEach(pill => {
        const pillStatus = pill.getAttribute('data-status') || 'ALL';
        if (pillStatus.toUpperCase() === status.toUpperCase()) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });
    applyFilters();
}

function handleSearch() {
    searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
    applyFilters();
}

function updateFilterCounts() {
    const total = accounts.length;
    const available = accounts.filter(a => (a.status || 'Available').toLowerCase() === 'available').length;
    const active = accounts.filter(a => (a.status || '').toLowerCase() === 'active').length;
    const sold = accounts.filter(a => (a.status || '').toLowerCase() === 'sold').length;
    const pending = accounts.filter(a => (a.status || '').toLowerCase() === 'pending').length;

    const setPillText = (status, label, count) => {
        const pill = document.querySelector(`.filter-pill[data-status="${status}"]`);
        if (pill) pill.innerText = `${label} (${count})`;
    };

    setPillText('ALL', 'All', total);
    setPillText('Available', 'Available', available);
    setPillText('Active', 'Active', active);
    setPillText('Sold', 'Sold', sold);
    setPillText('Pending', 'Pending', pending);
}

function getFilteredAccounts() {
    return accounts.filter(acc => {
        // Status filter
        if (activeFilter !== 'ALL') {
            const accStatus = (acc.status || 'Available').toLowerCase();
            if (accStatus !== activeFilter.toLowerCase()) return false;
        }

        // Search query filter
        if (searchQuery) {
            const serialStr = String(acc.serial || '');
            const gmailStr = (acc.gmail || '').toLowerCase();
            const recStr = (acc.recoveryEmail || '').toLowerCase();
            const notesStr = (acc.notes || '').toLowerCase();

            if (!serialStr.includes(searchQuery) &&
                !gmailStr.includes(searchQuery) &&
                !recStr.includes(searchQuery) &&
                !notesStr.includes(searchQuery)) {
                return false;
            }
        }
        return true;
    });
}

function applyFilters() {
    renderTable();
}

/**
 * Render Accounts Data Table with Inline Per-Row 2FA
 */
function renderTable() {
    const tbody = document.getElementById('accounts-table-body');
    if (!tbody) return;

    const filtered = getFilteredAccounts();
    const nowSec = Math.floor(Date.now() / 1000);

    if (filtered.length === 0) {
        if (accounts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 3rem 1.5rem; color: var(--text-muted);">
                        <div style="font-size: 1.1rem; margin-bottom: 0.5rem;">No accounts loaded yet.</div>
                        <button type="button" class="action-btn primary" onclick="openSyncModal()" style="display: inline-flex;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                            <span>Sync from Google Sheet</span>
                        </button>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
                        <div>No accounts matching filter "<strong>${escapeHtml(activeFilter)}</strong>".</div>
                        <button type="button" class="action-btn" onclick="setStatusFilter('ALL')" style="margin-top: 0.75rem; display: inline-flex;">
                            Show All Accounts (${accounts.length})
                        </button>
                    </td>
                </tr>
            `;
        }
        return;
    }

    tbody.innerHTML = filtered.map(acc => {
        const isPassRevealed = revealedPasswords.has(acc.id);

        // 1. Password Cell
        let passwordCell = '';
        if (currentRole === 'customer') {
            if (acc.hidePasswordFromCustomer) {
                passwordCell = `<span class="pass-hidden-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Hidden</span>`;
            } else {
                passwordCell = `
                    <div class="cell-content">
                        <span class="mono-text">${escapeHtml(acc.password || '••••••••')}</span>
                        <button type="button" class="copy-btn" onclick="copyToClipboard('${escapeJs(acc.password)}', this, 'Password')" title="Copy Password">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </button>
                    </div>`;
            }
        } else {
            // Worker & Admin can view, unmask, and copy password
            const displayPass = isPassRevealed ? escapeHtml(acc.password || '') : '••••••••••••';
            passwordCell = `
                <div class="cell-content">
                    <span class="mono-text ${isPassRevealed ? '' : 'pass-masked'}" id="pass-val-${acc.id}">${displayPass}</span>
                    <button type="button" class="copy-btn" onclick="togglePasswordReveal('${acc.id}')" title="${isPassRevealed ? 'Hide' : 'Reveal'} Password">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${isPassRevealed 
                                ? '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>'
                                : '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'}
                        </svg>
                    </button>
                    <button type="button" class="copy-btn" onclick="copyToClipboard('${escapeJs(acc.password)}', this, 'Password')" title="Copy Password">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    </button>
                </div>
            `;
        }

        // 2. Inline 2FA Display (Calculated from Sheet Column C raw key)
        let live2FACell = '';
        if (!acc.twoFactorSecret || String(acc.twoFactorSecret).trim() === '') {
            live2FACell = `<span class="totp-disabled-tag">-</span>`;
        } else if (currentRole === 'customer' && acc.hide2FaFromCustomer) {
            live2FACell = `<span class="pass-hidden-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Disabled</span>`;
        } else {
            // Compute real-time 6-digit TOTP immediately (synchronous)
            const totpResult = window.TOTPGenerator.generate(acc.twoFactorSecret, nowSec);
            const rem = totpResult.remaining;
            const pct = (rem / 30) * 100;
            const warnClass = rem <= 5 ? 'danger' : rem <= 10 ? 'warning' : '';

            live2FACell = `
                <div class="live-totp-box" id="cell-totp-${acc.id}">
                    <div class="live-totp-row">
                        <span class="totp-digits" id="totp-code-${acc.id}">${totpResult.formatted || '------'}</span>
                        <span class="totp-countdown-pill ${warnClass}" id="totp-rem-${acc.id}">${rem}s</span>
                        <button type="button" class="copy-btn" onclick="copyTOTP('${acc.id}', this)" title="Copy Live 2FA Code">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </button>
                    </div>
                    <div class="totp-mini-bar-bg">
                        <div class="totp-mini-bar ${warnClass}" id="totp-bar-${acc.id}" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }

        // 3. Status Cell (Dropdown for Worker/Admin, static badge for Customer)
        let statusCell = '';
        if (currentRole === 'customer') {
            statusCell = `<span class="status-badge ${escapeHtml(acc.status || 'Available')}">${escapeHtml(acc.status || 'Available')}</span>`;
        } else {
            const currentStatus = acc.status || 'Available';
            statusCell = `
                <select class="form-select" style="padding: 3px 8px; font-size: 0.75rem; border-radius: 6px; cursor: pointer;" onchange="quickChangeStatus('${acc.id}', this.value)">
                    <option value="Available" ${currentStatus === 'Available' ? 'selected' : ''}>Available</option>
                    <option value="Active" ${currentStatus === 'Active' ? 'selected' : ''}>Active</option>
                    <option value="Sold" ${currentStatus === 'Sold' ? 'selected' : ''}>Sold</option>
                    <option value="Pending" ${currentStatus === 'Pending' ? 'selected' : ''}>Pending</option>
                </select>
            `;
        }

        // 4. Customer Visibility Controls (Admin Only)
        let adminVisCell = '';
        if (currentRole === 'admin') {
            adminVisCell = `
                <td>
                    <div class="vis-toggle-group">
                        <button type="button" class="vis-btn ${acc.hidePasswordFromCustomer ? 'is-hidden' : 'is-visible'}" 
                            onclick="toggleVisibility('${acc.id}', 'hidePasswordFromCustomer', ${!acc.hidePasswordFromCustomer})" 
                            title="Toggle Password Visibility for Customers">
                            ${acc.hidePasswordFromCustomer ? '🔒 Pass Hidden' : '👁️ Pass Shown'}
                        </button>
                        <button type="button" class="vis-btn ${acc.hide2FaFromCustomer ? 'is-hidden' : 'is-visible'}" 
                            onclick="toggleVisibility('${acc.id}', 'hide2FaFromCustomer', ${!acc.hide2FaFromCustomer})" 
                            title="Toggle 2FA Code Visibility for Customers">
                            ${acc.hide2FaFromCustomer ? '🚫 2FA Hidden' : '⚡ 2FA Shown'}
                        </button>
                    </div>
                </td>
            `;
        }

        // 5. Actions Column
        let actionButtons = '';
        if (currentRole === 'customer') {
            actionButtons = `
                <button type="button" class="action-btn" onclick="copyAccountSummary('${acc.id}', this)" title="Copy All Details">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    <span>Copy All</span>
                </button>
            `;
        } else if (currentRole === 'worker') {
            actionButtons = `
                <button type="button" class="action-btn primary" onclick="openEditModal('${acc.id}')" title="Edit All Fields">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    <span>Edit</span>
                </button>
            `;
        } else if (currentRole === 'admin') {
            actionButtons = `
                <button type="button" class="action-btn primary" onclick="openEditModal('${acc.id}')" title="Edit All Fields">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    <span>Edit</span>
                </button>
                <button type="button" class="action-btn danger" onclick="deleteAccount('${acc.id}')" title="Delete Account">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
            `;
        }

        return `
            <tr>
                <td style="font-weight: 600; color: var(--text-muted);">${acc.serial || '-'}</td>
                <td>
                    <div class="cell-content">
                        <span class="mono-text" style="font-weight: 500;">${escapeHtml(acc.gmail || '')}</span>
                        <button type="button" class="copy-btn" onclick="copyToClipboard('${escapeJs(acc.gmail)}', this, 'Gmail')" title="Copy Gmail">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </button>
                    </div>
                </td>
                <td>${passwordCell}</td>
                <td>${live2FACell}</td>
                <td>
                    <div class="cell-content">
                        <span class="mono-text" style="color: var(--text-secondary);">${escapeHtml(acc.recoveryEmail || '-')}</span>
                        ${acc.recoveryEmail ? `
                            <button type="button" class="copy-btn" onclick="copyToClipboard('${escapeJs(acc.recoveryEmail)}', this, 'Recovery Mail')" title="Copy Recovery Email">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            </button>
                        ` : ''}
                    </div>
                </td>
                <td>${statusCell}</td>
                ${adminVisCell}
                <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 0.35rem;">
                        ${actionButtons}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Real-Time 2FA Ticker (Updates every 1000ms)
 * Updates live 6-digit codes and countdown timers per row
 */
function startLive2FATicker() {
    if (tickerInterval) clearInterval(tickerInterval);

    tickerInterval = setInterval(() => {
        const nowSec = Math.floor(Date.now() / 1000);
        const remaining = 30 - (nowSec % 30);
        const nowObj = new Date();
        const timeStr = nowObj.toTimeString().split(' ')[0];

        // Update Global Live Time in Header
        const clockText = document.getElementById('live-clock-text');
        if (clockText) clockText.innerText = `Live: ${timeStr}`;

        const pct = (remaining / 30) * 100;
        const warnClass = remaining <= 5 ? 'danger' : remaining <= 10 ? 'warning' : '';

        // Update each row's 2FA elements directly (high performance, zero flicker)
        for (const acc of accounts) {
            if (!acc.twoFactorSecret || String(acc.twoFactorSecret).trim() === '') continue;
            if (currentRole === 'customer' && acc.hide2FaFromCustomer) continue;

            const totpResult = window.TOTPGenerator.generate(acc.twoFactorSecret, nowSec);

            const codeEl = document.getElementById(`totp-code-${acc.id}`);
            const remEl = document.getElementById(`totp-rem-${acc.id}`);
            const barEl = document.getElementById(`totp-bar-${acc.id}`);

            if (codeEl && codeEl.innerText !== totpResult.formatted) {
                codeEl.innerText = totpResult.formatted;
            }
            if (remEl) {
                remEl.innerText = `${remEl ? totpResult.remaining : remaining}s`;
                remEl.className = `totp-countdown-pill ${warnClass}`;
            }
            if (barEl) {
                barEl.style.width = `${pct}%`;
                barEl.className = `totp-mini-bar ${warnClass}`;
            }
        }
    }, 1000);
}

/**
 * Copy 2FA Code from Table Row
 */
function copyTOTP(id, btn) {
    const acc = accounts.find(a => a.id === id);
    if (!acc || !acc.twoFactorSecret) {
        showToast('No 2FA secret key available', 'error');
        return;
    }

    const result = window.TOTPGenerator.generate(acc.twoFactorSecret);
    if (result && result.code && result.code !== '-') {
        // Copy clean 6 digits (without space) directly for instant paste into Google login
        copyToClipboard(result.code, btn, '2FA Code');
    } else {
        showToast('Unable to generate 2FA code', 'error');
    }
}

/**
 * Copy All Details for an Account
 */
function copyAccountSummary(id, btn) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;

    let summary = `Gmail: ${acc.gmail || ''}`;
    if (acc.password) summary += `\nPassword: ${acc.password}`;
    if (acc.recoveryEmail) summary += `\nRecovery: ${acc.recoveryEmail}`;
    
    if (acc.twoFactorSecret) {
        const res = window.TOTPGenerator.generate(acc.twoFactorSecret);
        if (res && res.code && res.code !== '-') {
            summary += `\nLive 2FA Code: ${res.code}`;
        }
    }

    copyToClipboard(summary, btn, 'Account Details');
}

/**
 * Clipboard Copy with Toast Feedback
 */
async function copyToClipboard(text, btnElement, label = 'Text') {
    if (!text) {
        showToast(`Empty ${label}`, 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        showToast(`Copied ${label} to clipboard!`, 'success');

        if (btnElement) {
            btnElement.classList.add('copied');
            const originalHtml = btnElement.innerHTML;
            btnElement.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
            setTimeout(() => {
                btnElement.classList.remove('copied');
                btnElement.innerHTML = originalHtml;
            }, 1500);
        }
    } catch (err) {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(`Copied ${label}!`, 'success');
    }
}

/**
 * Toggle Password Plaintext Reveal
 */
function togglePasswordReveal(id) {
    if (revealedPasswords.has(id)) {
        revealedPasswords.delete(id);
    } else {
        revealedPasswords.add(id);
    }
    renderTable();
}

/**
 * Quick-change status (Worker & Admin)
 * Optimistically updates state and keeps row visible
 */
async function quickChangeStatus(id, newStatus) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;

    // Optimistic update
    acc.status = newStatus;
    updateFilterCounts();
    updateAdminStats();
    showToast(`Status set to ${newStatus}`, 'success');

    // Persist to backend
    try {
        await fetch('accounts/quick-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status: newStatus })
        });
    } catch (err) {
        console.error('Backend status update failed:', err);
    }
}

/**
 * Toggle Visibility Settings (Admin Only)
 */
async function toggleVisibility(id, field, value) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;

    // Optimistic update
    acc[field] = value;
    renderTable();
    updateAdminStats();

    try {
        const res = await fetch('accounts/visibility', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, field, value })
        });
        if (!res.ok) throw new Error('Visibility update failed');
        showToast(`Visibility setting updated`, 'success');
    } catch (err) {
        console.error(err);
        showToast('Error saving visibility setting', 'error');
    }
}

/**
 * Update Admin Dashboard Stats
 */
function updateAdminStats() {
    if (currentRole !== 'admin') return;

    const total = accounts.length;
    const available = accounts.filter(a => (a.status || 'Available') === 'Available').length;
    const active = accounts.filter(a => a.status === 'Active').length;
    const sold = accounts.filter(a => a.status === 'Sold').length;
    const protectedPass = accounts.filter(a => a.hidePasswordFromCustomer).length;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };

    setVal('stat-total', total);
    setVal('stat-available', available);
    setVal('stat-active', active);
    setVal('stat-sold', sold);
    setVal('stat-protected', protectedPass);
}

/**
 * Open Modal: Add Account (Worker & Admin)
 */
function openAddModal() {
    document.getElementById('account-modal-title').innerText = 'Add New Gmail Account';
    document.getElementById('edit-account-id').value = '';
    document.getElementById('edit-serial').value = accounts.length + 1;
    document.getElementById('edit-gmail').value = '';
    document.getElementById('edit-password').value = '';
    document.getElementById('edit-2fa').value = '';
    document.getElementById('edit-recovery').value = '';
    document.getElementById('edit-status').value = 'Available';
    document.getElementById('edit-notes').value = '';

    openModal('account-modal');
}

/**
 * Open Modal: Edit Account (Worker & Admin)
 * Allows editing all fields: Email, Password, Recovery, Status, 2FA Secret Key, Notes
 */
function openEditModal(id) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;

    document.getElementById('account-modal-title').innerText = `Edit Account #${acc.serial || ''} (${acc.gmail || ''})`;
    document.getElementById('edit-account-id').value = acc.id;
    document.getElementById('edit-serial').value = acc.serial || '';
    document.getElementById('edit-gmail').value = acc.gmail || '';
    document.getElementById('edit-password').value = acc.password || '';
    document.getElementById('edit-2fa').value = acc.twoFactorSecret || '';
    document.getElementById('edit-recovery').value = acc.recoveryEmail || '';
    document.getElementById('edit-status').value = acc.status || 'Available';
    document.getElementById('edit-notes').value = acc.notes || '';

    openModal('account-modal');
}

/**
 * Save Account Modal (Worker & Admin)
 * Optimistically saves in memory and persists to backend
 */
async function saveAccountModal() {
    const id = document.getElementById('edit-account-id').value;
    const gmail = document.getElementById('edit-gmail').value.trim();

    if (!gmail) {
        showToast('Gmail address is required', 'error');
        return;
    }

    const payload = {
        id: id || `acc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        serial: parseInt(document.getElementById('edit-serial').value) || (accounts.length + 1),
        gmail: gmail,
        password: document.getElementById('edit-password').value.trim(),
        twoFactorSecret: document.getElementById('edit-2fa').value.trim(),
        recoveryEmail: document.getElementById('edit-recovery').value.trim(),
        status: document.getElementById('edit-status').value,
        notes: document.getElementById('edit-notes').value.trim()
    };

    // Optimistically update or insert into in-memory accounts array
    if (id) {
        const idx = accounts.findIndex(a => a.id === id);
        if (idx !== -1) {
            accounts[idx] = { ...accounts[idx], ...payload };
        }
    } else {
        accounts.push({
            ...payload,
            hidePasswordFromCustomer: true,
            hide2FaFromCustomer: false,
            hideFromCustomer: false
        });
    }

    closeModal('account-modal');
    applyFilters();
    updateFilterCounts();
    updateAdminStats();
    showToast(id ? 'Account updated successfully' : 'Account created successfully', 'success');

    // Persist to backend
    try {
        const endpoint = id ? 'accounts/update' : 'accounts/create';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Server returned error on save');
    } catch (err) {
        console.error('Server save error:', err);
        showToast('Warning: Local changes saved, backend sync in progress', 'warning');
    }
}

/**
 * Delete Account (Admin only)
 */
async function deleteAccount(id) {
    const acc = accounts.find(a => a.id === id);
    const gmailLabel = acc ? acc.gmail : id;

    if (!confirm(`Are you sure you want to permanently delete ${gmailLabel}?`)) return;

    // Optimistic deletion
    accounts = accounts.filter(a => a.id !== id);
    applyFilters();
    updateFilterCounts();
    updateAdminStats();
    showToast('Account deleted successfully', 'success');

    try {
        const res = await fetch('accounts/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (!res.ok) throw new Error('Server delete failed');
    } catch (err) {
        console.error('Server delete error:', err);
    }
}

/**
 * Google Sheet Live Sync
 */
function openSyncModal() {
    // Refresh accounts from backend
    loadAccounts();
    showToast('Accounts refreshed from server', 'success');
}

async function performSheetSync() {
    // Legacy sync removed; simply reload accounts
    await loadAccounts();
    showToast('Accounts reloaded', 'success');
}

/**
 * Export Accounts as CSV
 */
function downloadCSV() {
    // Trigger CSV export via backend action
    window.location.href = `${API_BASE}?action=exportCsv`;
    showToast('Exporting accounts to CSV...', 'info');
}

/**
 * Modal utilities
 */
function openModal(id) {
    document.getElementById(id)?.classList.add('active');
}

function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
}

/**
 * Toast Notifications
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            ${type === 'success' 
                ? '<path d="M20 6 9 17l-5-5"/>' 
                : type === 'error' 
                ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' 
                : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'}
        </svg>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

/**
 * Theme Toggle
 */
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    if (theme === 'light') {
        icon.innerHTML = `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`;
    } else {
        icon.innerHTML = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
    }
}

/**
 * Helpers
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJs(str) {
    if (!str) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
