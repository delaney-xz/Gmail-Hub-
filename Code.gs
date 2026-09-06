// Google Apps Script backend for Gmail Hub
// Spreadsheet ID containing Admin/Worker and Customer tabs
const SPREADSHEET_ID = '13uKQBxLRbF5lc65GeXimDdVTjao-FsqDALVbhLXAHEA';
const ADMIN_SHEET_GID = 1453310958; // "Admin" sheet (cols B: username, C: password, D: status)
const CUSTOMER_SHEET_GID = 599256342; // "Customer" sheet (cols B: username, C: password, D: email/phone)

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
        result = getAccounts();
        break;
      case 'syncSheet':
        // In this simple implementation, sync just returns the latest data.
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

function doGet(e) {
  // Allow GET for simple read actions (e.g., getAccounts) – treat similarly to POST.
  const action = e.parameter.action;
  const params = {
    action: action,
    username: e.parameter.username,
    password: e.parameter.password,
    contact: e.parameter.contact
  };
  // Re‑use doPost logic for consistency.
  const mockEvent = { postData: { contents: JSON.stringify(params) } };
  return doPost(mockEvent);
}

/** Helper to obtain sheets by GID */
function getSheetByGid(gid) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  for (const sh of sheets) {
    if (sh.getSheetId() === gid) return sh;
  }
  throw new Error('Sheet with gid ' + gid + ' not found');
}

/** Admin login – only users with status "admin" are allowed */
function adminLogin({ username, password }) {
  const sheet = getSheetByGid(ADMIN_SHEET_GID);
  const data = sheet.getRange('B:D').getValues(); // columns B,C,D
  for (const row of data) {
    const [user, pass, role] = row;
    if (user && user.toString() === username && pass && pass.toString() === password && role && role.toString().toLowerCase() === 'admin') {
      return { success: true, token: Utilities.getUuid(), username, role: 'admin' };
    }
  }
  return { success: false, error: 'Invalid admin credentials' };
}

/** Worker login – status must be "worker" */
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

/** Customer login – no role column, any match is accepted */
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

/** Customer registration – prevents duplicate usernames */
function customerRegister({ username, password, contact }) {
  if (!username || !password) return { success: false, error: 'Missing username or password' };
  const sheet = getSheetByGid(CUSTOMER_SHEET_GID);
  const data = sheet.getRange('B:B').getValues(); // only usernames column
  for (const row of data) {
    const existing = row[0];
    if (existing && existing.toString() === username) {
      return { success: false, error: 'Username already exists' };
    }
  }
  // Append new row: B=username, C=password, D=contact (or empty string)
  sheet.appendRow([username, password, contact || '']);
  return { success: true, token: Utilities.getUuid(), username, role: 'customer' };
}

/** Return list of customer accounts (username + contact) */
function getAccounts() {
  const sheet = getSheetByGid(CUSTOMER_SHEET_GID);
  const data = sheet.getRange('B:D').getValues();
  const accounts = [];
  for (const row of data) {
    const [username, , contact] = row;
    if (username) {
      accounts.push({ username: username.toString(), contact: (contact || '').toString() });
    }
  }
  return { success: true, accounts };
}
