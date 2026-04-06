/**
 * Google Apps Script - Backend para CRM Leads Médicos
 *
 * SETUP:
 * 1. Crea una Google Sheet nueva
 * 2. Ve a Extensiones > Apps Script
 * 3. Pega este código en Code.gs
 * 4. Haz deploy: Implementar > Nueva implementación > App web
 *    - Ejecutar como: tu cuenta
 *    - Quién tiene acceso: Cualquier persona
 * 5. Copia la URL del deploy y pégala en el index.html (variable SHEET_API)
 */

const SHEET_NAME = 'CRM_Data';

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['doctor_id', 'favorited', 'contacted', 'notes', 'updated_at']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  }
  return sheet;
}

function doGet(e) {
  try {
    const sheet = getOrCreateSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);

    const result = {};
    for (const row of rows) {
      const id = row[0];
      if (!id) continue;
      result[id] = {
        favorited: row[1] || '',
        contacted: row[2] || '',
        notes: row[3] || '',
      };
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === 'sync') {
      return handleSync(payload);
    } else if (action === 'update') {
      return handleUpdate(payload);
    } else if (action === 'delete') {
      return handleDelete(payload);
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleUpdate(payload) {
  const sheet = getOrCreateSheet();
  const id = payload.doctor_id;
  const data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) { rowIndex = i + 1; break; }
  }

  const now = new Date().toISOString();

  if (rowIndex > 0) {
    // Update existing row
    if (payload.favorited !== undefined) sheet.getRange(rowIndex, 2).setValue(payload.favorited);
    if (payload.contacted !== undefined) sheet.getRange(rowIndex, 3).setValue(payload.contacted);
    if (payload.notes !== undefined) sheet.getRange(rowIndex, 4).setValue(payload.notes);
    sheet.getRange(rowIndex, 5).setValue(now);
  } else {
    // Insert new row
    sheet.appendRow([
      id,
      payload.favorited || '',
      payload.contacted || '',
      payload.notes || '',
      now
    ]);
  }

  return jsonResponse({ ok: true });
}

function handleDelete(payload) {
  const sheet = getOrCreateSheet();
  const id = payload.doctor_id;
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }

  return jsonResponse({ ok: true });
}

function handleSync(payload) {
  // Bulk sync: receives { favs: {}, contacted: {}, notes: {} }
  const sheet = getOrCreateSheet();
  const existing = sheet.getDataRange().getValues();
  const existingMap = {};

  for (let i = 1; i < existing.length; i++) {
    existingMap[existing[i][0]] = i + 1; // row number (1-indexed)
  }

  const allIds = new Set([
    ...Object.keys(payload.favs || {}),
    ...Object.keys(payload.contacted || {}),
    ...Object.keys(payload.notes || {})
  ]);

  const now = new Date().toISOString();
  const newRows = [];

  for (const id of allIds) {
    const fav = (payload.favs || {})[id] || '';
    const cont = (payload.contacted || {})[id] || '';
    const note = (payload.notes || {})[id] || '';

    if (existingMap[id]) {
      // Update
      const row = existingMap[id];
      sheet.getRange(row, 2).setValue(fav);
      sheet.getRange(row, 3).setValue(cont);
      sheet.getRange(row, 4).setValue(note);
      sheet.getRange(row, 5).setValue(now);
    } else {
      newRows.push([id, fav, cont, note, now]);
    }
  }

  // Batch append new rows
  if (newRows.length > 0) {
    sheet.getRange(existing.length + 1, 1, newRows.length, 5).setValues(newRows);
  }

  return jsonResponse({ ok: true, synced: allIds.size });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
