// Google Apps Script backend for Gmail Hub – Updated Architecture

// ==== Spreadsheet IDs (main and status‑specific tabs) ====
const SPREADSHEET_ID = '13uKQBxLRbF5lc65GeXimDdVTjao-FsqDALVbhLXAHEA';
// Auth sheets
const ADMIN_SHEET_GID = 1453310958;   // Admin & Worker Auth (Cols B: username, C: password, D: status/permission)
const CUSTOMER_SHEET_GID = 599256342; // Customer Auth (Cols B‑D)
// Main data sheet (gid 0 – assumed first sheet)
const MAIN_SHEET_GID = 0; // Main accounts sheet
// Status‑specific sheets
const VERIFY_SHEET_GID = 1740739210;
const PENDING_SHEET_GID = 1538136463;
const SOLD_SHEET_GID = 547968287;

/** Entry point for POST requests */
function doPost(e) {
  const params = e.postData.contents ? JSON.parse(e.postData.contents) : {};
  const action = params.action;
  let result = { success: false, error: 'Invalid request' };

  try {
    switch (action) {
      case 'adminLogin':
        result = adminLogin(params);
        break;
      case 'workerLogin':
        result = workerLogin(params);
        break;
      case 'customerLogin':
        result = customerLogin(params);
        break;
      case 'customerRegister':
        result = customerRegister(params);
        break;
      case 'getAccounts':
        result = getAccounts(params);
        break;
      case 'updateAccount':
        result = updateAccount(params);
        break;
      case 'createAccount':
        result = createAccount(params);
        break;
      case 'deleteAccount':
        result = deleteAccount(params);
        break;
      case 'quickStatus':
        result = quickStatus(params);
        break;
      case 'toggleVisibility':
        result = toggleVisibility(params);
        break;
      case 'syncSheet':
        // Simple sync – returns latest data; real sync logic can be added later
        result = { success: true, message: 'Sheet synchronized' };
        break;
      default:
        result = { success: false, error: 'Unknown action' };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Entry point for GET – maps to POST for compatibility */
function doGet(e) {
  const action = e.parameter.action;
  const params = {
    action: action,
    username: e.parameter.username,
    password: e.parameter.password,
    contact: e.parameter.contact,
    role: e.parameter.role,
    // Pass through any other fields as needed
    ...e.parameter
  };
  const mockEvent = { postData: { contents: JSON.stringify(params) } };
  return doPost(mockEvent);
}

/** Helper: retrieve a sheet by its GID */
function getSheetByGid(gid) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  for (const sh of sheets) {
    if (sh.getSheetId() === gid) return sh;
  }
  throw new Error('Sheet with gid ' + gid + ' not found');
}

/** ---------- Authentication ---------- */
function adminLogin({ username, password }) {
  const sheet = getSheetByGid(ADMIN_SHEET_GID);
  const data = sheet.getRange('B:D').getValues(); // B=username, C=password, D=role/permission
  for (const row of data) {
    const [user, pass, role] = row;
    if (user && user.toString() === username && pass && pass.toString() === password && role && role.toString().toLowerCase() === 'admin') {
      return { success: true, token: Utilities.getUuid(), username, role: 'admin' };
    }
  }
  return { success: false, error: 'Invalid admin credentials' };
}

function workerLogin({ username, password }) {
  const sheet = getSheetByGid(ADMIN_SHEET_GID);
  const data = sheet.getRange('B:D').getValues();
  for (const row of data) {
    const [user, pass, role] = row;
    if (user && user.toString() === username && pass && pass.toString() === password && role && role.toString().toLowerCase() === 'worker') {
      return { success: true, token: Utilities.getUuid(), username, role: 'worker' };
    }
  }
  return { success: false, error: 'Invalid worker credentials' };
}

function customerLogin({ username, password }) {
  const sheet = getSheetByGid(CUSTOMER_SHEET_GID);
  const data = sheet.getRange('B:D').getValues(); // B=username, C=password, D=contact
  for (const row of data) {
    const [user, pass] = row;
    if (user && user.toString() === username && pass && pass.toString() === password) {
      return { success: true, token: Utilities.getUuid(), username, role: 'customer' };
    }
  }
  return { success: false, error: 'Invalid customer credentials' };
}

function customerRegister({ username, password, contact }) {
  if (!username || !password) return { success: false, error: 'Missing username or password' };
  const sheet = getSheetByGid(CUSTOMER_SHEET_GID);
  const data = sheet.getRange('B:B').getValues();
  for (const row of data) {
    const existing = row[0];
    if (existing && existing.toString() === username) {
      return { success: false, error: 'Username already exists' };
    }
  }
  sheet.appendRow([username, password, contact || '']);
  return { success: true, token: Utilities.getUuid(), username, role: 'customer' };
}

/** ---------- Helper: Permission Checks ---------- */
function getWorkerPermission(username) {
  const sheet = getSheetByGid(ADMIN_SHEET_GID);
  const data = sheet.getRange('B:D').getValues(); // B=username, C=password, D=permission string
  for (const row of data) {
    const [user, , perm] = row;
    if (user && user.toString() === username) {
      const permStr = perm ? perm.toString().toLowerCase() : '';
      return permStr.includes('edit'); // true if contains "edit"
    }
  }
  return false;
}

/** ---------- Core Account Operations ---------- */
function getAccounts({ role, username }) {
  // Main data sheet holds the master record set (gid 0)
  const sheet = getSheetByGid(MAIN_SHEET_GID);
  const data = sheet.getRange('A:J').getValues(); // Columns A‑J per architecture
  const accounts = [];
  for (let i = 1; i < data.length; i++) { // skip header row
    const row = data[i];
    const gmail = row[0] ? row[0].toString() : '';
    if (!gmail) continue; // skip empty rows
    const account = {
      id: i,
      gmail: gmail,
      password: row[1] ? row[1].toString() : '',
      twoFactorSecret: row[2] ? row[2].toString() : '',
      recoveryEmail: row[3] ? row[3].toString() : '',
      years: row[4] ? row[4].toString() : '',
      status: row[5] ? row[5].toString() : 'Available',
      editHistory: row[6] ? row[6].toString() : ''
    };
    if (role === 'customer') {
      if (account.status.toLowerCase() !== 'available') continue;
      accounts.push({
        id: account.id,
        gmail: account.gmail,
        password: account.password,
        years: account.years,
        status: account.status
      });
    } else if (role === 'worker') {
      const canEdit = getWorkerPermission(username || '');
      accounts.push({
        ...account,
        canEdit: canEdit
      });
    } else { // admin or unspecified
      accounts.push(account);
    }
  }
  return { success: true, accounts };
}

/** Update an existing account (admin/worker) */
function updateAccount({ id, gmail, password, years, status, twoFactorSecret, recoveryEmail, updater }) {
  const sheet = getSheetByGid(MAIN_SHEET_GID);
  const rowIdx = Number(id);
  if (!rowIdx) return { success: false, error: 'Invalid row id' };

  // Permission enforcement for workers
  if (updater && updater.role === 'worker') {
    const allowed = getWorkerPermission(updater.username);
    if (!allowed) {
      return { success: false, error: "You don't have permission from Admin to edit." };
    }
  }

  // Prepare values respecting column order A‑G (we write up to editHistory column)
  const values = [
    gmail || '',                // A
    password || '',             // B
    twoFactorSecret || '',      // C
    recoveryEmail || '',        // D
    years || '',                // E
    status || 'Available',      // F
    updater && updater.role === 'admin' ? 'Admin' : (updater ? updater.username : '') // G – edit history
  ];

  sheet.getRange(rowIdx + 1, 1, 1, values.length).setValues([values]);

  // Sync status to appropriate sheet if needed
  if (status) {
    moveRowToStatusSheet(rowIdx, status);
  }

  return { success: true };
}

/** Create a new account (admin/worker) */
function createAccount({ gmail, password, years, status, twoFactorSecret, recoveryEmail, creator }) {
  // Permission check for worker creator
  if (creator && creator.role === 'worker') {
    const allowed = getWorkerPermission(creator.username);
    if (!allowed) {
      return { success: false, error: "You don't have permission from Admin to edit." };
    }
  }

  const sheet = getSheetByGid(MAIN_SHEET_GID);
  const editHist = creator && creator.role === 'admin' ? 'Admin' : (creator ? creator.username : '');
  const row = [
    gmail || '',
    password || '',
    twoFactorSecret || '',
    recoveryEmail || '',
    years || '',
    status || 'Available',
    editHist
  ];
  sheet.appendRow(row);
  const newId = sheet.getLastRow();
  if (status) moveRowToStatusSheet(newId, status);
  return { success: true, id: newId };
}

/** Delete an account */
function deleteAccount({ id }) {
  const sheet = getSheetByGid(MAIN_SHEET_GID);
  const rowIdx = Number(id);
  if (!rowIdx) return { success: false, error: 'Invalid id' };
  sheet.deleteRow(rowIdx);
  return { success: true };
}

/** Quick status change (worker/admin) */
function quickStatus({ id, newStatus }) {
  const sheet = getSheetByGid(MAIN_SHEET_GID);
  const rowIdx = Number(id);
  if (!rowIdx) return { success: false, error: 'Invalid id' };
  sheet.getRange(rowIdx, 6).setValue(newStatus); // Column F (status)
  moveRowToStatusSheet(rowIdx, newStatus);
  return { success: true };
}

/** Toggle visibility flags – placeholder (actual columns not present in this architecture) */
function toggleVisibility({ id, field, value }) {
  // No visibility columns defined in current layout; implement as needed.
  return { success: true };
}

/** Move or sync a row to a status‑specific sheet */
function moveRowToStatusSheet(rowIdx, status) {
  const normalized = status.toString().toLowerCase();
  let targetGid;
  if (normalized === 'verify') targetGid = VERIFY_SHEET_GID;
  else if (normalized === 'pending') targetGid = PENDING_SHEET_GID;
  else if (normalized === 'sold') targetGid = SOLD_SHEET_GID;
  else return; // No special sheet for other statuses

  const srcSheet = getSheetByGid(MAIN_SHEET_GID);
  const targetSheet = getSheetByGid(targetGid);

  const rowValues = srcSheet.getRange(rowIdx, 1, 1, srcSheet.getLastColumn()).getValues()[0];
  targetSheet.appendRow(rowValues);
  // Uncomment the next line to delete from the main sheet after moving
  // srcSheet.deleteRow(rowIdx);
}

/** ---------- End of File ---------- */
