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
 * 5. Copia la URL del deploy y pégala en index.html (variable SHEET_API)
 *
 * IMPORTANTE: Cada vez que cambies este código debes hacer un NUEVO deploy
 * (Implementar > Gestionar implementaciones > Editar > Nueva versión)
 */

const SHEET_NAME = 'CRM_Data';
const HEADERS = ['doctor_id', 'doctor_name', 'favorited', 'contacted', 'notes', 'status', 'updated_at'];

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  // Migration: if old sheet has 5 columns, add the new ones
  const lastCol = sheet.getLastColumn();
  if (lastCol === 5) {
    sheet.insertColumnAfter(1);
    sheet.getRange(1, 2).setValue('doctor_name');
    sheet.insertColumnAfter(5);
    sheet.getRange(1, 6).setValue('status');
    const numRows = sheet.getLastRow() - 1;
    if (numRows > 0) {
      const range = sheet.getRange(2, 6, numRows, 1);
      const values = range.getValues().map(() => ['active']);
      range.setValues(values);
    }
  }
  return sheet;
}

// ===== GET: return all CRM data =====
function doGet(e) {
  try {
    const sheet = getOrCreateSheet();
    const data = sheet.getDataRange().getValues();
    const rows = data.slice(1);

    const result = {};
    for (const row of rows) {
      const id = row[0];
      if (!id) continue;
      result[id] = {
        doctor_name: row[1] || '',
        favorited: row[2] || '',
        contacted: row[3] || '',
        notes: row[4] || '',
        status: row[5] || 'active',
        updated_at: row[6] || '',
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

// ===== POST: handle all write actions =====
function doPost(e) {
  try {
    let payload;
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.payload) {
      payload = JSON.parse(e.parameter.payload);
    }

    if (!payload) return jsonResponse({ ok: false, error: 'No payload' });

    const action = payload.action;
    if (action === 'sync') return handleSync(payload);
    if (action === 'update') return handleUpdate(payload);
    if (action === 'softdelete') return handleSoftDelete(payload);
    if (action === 'restore') return handleRestore(payload);

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ===== UPDATE: upsert a single doctor row =====
function handleUpdate(payload) {
  const sheet = getOrCreateSheet();
  const id = payload.doctor_id;
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) { rowIndex = i + 1; break; }
  }

  if (rowIndex > 0) {
    if (payload.doctor_name !== undefined) sheet.getRange(rowIndex, 2).setValue(payload.doctor_name);
    if (payload.favorited !== undefined) sheet.getRange(rowIndex, 3).setValue(payload.favorited);
    if (payload.contacted !== undefined) sheet.getRange(rowIndex, 4).setValue(payload.contacted);
    if (payload.notes !== undefined) sheet.getRange(rowIndex, 5).setValue(payload.notes);
    sheet.getRange(rowIndex, 6).setValue('active');
    sheet.getRange(rowIndex, 7).setValue(now);
  } else {
    sheet.appendRow([
      id,
      payload.doctor_name || '',
      payload.favorited || '',
      payload.contacted || '',
      payload.notes || '',
      'active',
      now
    ]);
  }

  return jsonResponse({ ok: true });
}

// ===== SOFT DELETE: mark row as deleted =====
function handleSoftDelete(payload) {
  const sheet = getOrCreateSheet();
  const id = payload.doctor_id;
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, 6).setValue('deleted');
      sheet.getRange(rowIndex, 7).setValue(now);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ ok: true, message: 'not found' });
}

// ===== RESTORE: reactivate soft-deleted row =====
function handleRestore(payload) {
  const sheet = getOrCreateSheet();
  const id = payload.doctor_id;
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, 6).setValue('active');
      sheet.getRange(rowIndex, 7).setValue(now);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ ok: true, message: 'not found' });
}

// ===== BULK SYNC: push all local data to sheet =====
function handleSync(payload) {
  const sheet = getOrCreateSheet();
  const existing = sheet.getDataRange().getValues();
  const existingMap = {};

  for (let i = 1; i < existing.length; i++) {
    existingMap[existing[i][0]] = i + 1;
  }

  const allIds = new Set([
    ...Object.keys(payload.favs || {}),
    ...Object.keys(payload.contacted || {}),
    ...Object.keys(payload.notes || {})
  ]);

  const now = new Date().toISOString();
  const names = payload.names || {};
  const newRows = [];

  for (const id of allIds) {
    const fav = (payload.favs || {})[id] || '';
    const cont = (payload.contacted || {})[id] || '';
    const note = (payload.notes || {})[id] || '';
    const name = names[id] || '';

    if (existingMap[id]) {
      const row = existingMap[id];
      if (name) sheet.getRange(row, 2).setValue(name);
      sheet.getRange(row, 3).setValue(fav);
      sheet.getRange(row, 4).setValue(cont);
      sheet.getRange(row, 5).setValue(note);
      sheet.getRange(row, 6).setValue('active');
      sheet.getRange(row, 7).setValue(now);
    } else {
      newRows.push([id, name, fav, cont, note, 'active', now]);
    }
  }

  if (newRows.length > 0) {
    sheet.getRange(existing.length + 1, 1, newRows.length, HEADERS.length).setValues(newRows);
  }

  return jsonResponse({ ok: true, synced: allIds.size });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
