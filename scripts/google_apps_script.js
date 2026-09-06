/**
 * Google Apps Script for Gmail Management Portal
 *
 * Instructions:
 * 1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/13uKQBxLRbF5lc65GeXimDdVTjao-FsqDALVbhLXAHEA/
 * 2. Click "Extensions" > "Apps Script".
 * 3. Replace any code with this file.
 * 4. Click "Deploy" > "New deployment" > Select type: "Web app".
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 * 5. Copy the Web App URL and paste it into your Portal settings if you want live two-way writeback!
 */

function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Customer") || SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1]) continue; // skip if Gmail is empty
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    rows.push(obj);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: "success", count: rows.length, data: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Customer") || SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    
    // Action: update or append
    if (payload.action === "update") {
      var data = sheet.getDataRange().getValues();
      var found = false;
      for (var i = 1; i < data.length; i++) {
        if (data[i][1] === payload.gmail) { // Gmail column
          if (payload.password) sheet.getRange(i + 1, 3).setValue(payload.password);
          if (payload.status) sheet.getRange(i + 1, 6).setValue(payload.status);
          found = true;
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success", updated: found }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === "add") {
      sheet.appendRow([
        payload.serial || sheet.getLastRow(),
        payload.gmail,
        payload.password || "",
        payload.twoFactorSecret || "",
        payload.recoveryEmail || "",
        payload.status || "Available"
      ]);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", added: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
