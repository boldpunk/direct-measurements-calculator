// Minimal .xlsx writer for MebelFlow's exports (Финансы, Зарплаты).
//
// Replaces the `xlsx` (SheetJS) npm package: its npm release is frozen at a
// version with known parsing vulnerabilities, it was ~420 KB, and the app
// only ever *writes* simple sheets. An .xlsx file is a ZIP of a few XML
// parts; this builds exactly those, uncompressed ("stored" ZIP entries),
// which every spreadsheet program opens.
//
// Supported: several sheets, a bold header row, column widths, number
// formats per column, an autofilter on the header.
//
//   downloadWorkbook('Отчёт.xlsx', [{
//     name: 'Лист 1',
//     rows: [['Клиент', 'Сумма'], ['Иван', 1200]],
//     widths: [24, 14],                 // in characters
//     formats: { 1: '#,##0' },          // column index -> Excel number format
//     autofilter: true,
//   }]);

const enc = new TextEncoder();

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 forbids would make Excel reject the whole file.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function colName(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Excel sheet names: max 31 chars, none of : \ / ? * [ ], unique.
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((sh, i) => {
    let base = String(sh.name || `Лист ${i + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Лист ${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k += 1) name = `${base.slice(0, 28)} ${k}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Styles: 0 = default, 1 = bold header, then one per distinct number format.
function buildStyles(sheets) {
  const formats = [...new Set(sheets.flatMap((sh) => Object.values(sh.formats || {})))];
  const numFmts = formats.map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(code)}"/>`).join('');
  const xfs = formats.map((_, i) => `<xf numFmtId="${164 + i}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + (formats.length ? `<numFmts count="${formats.length}">${numFmts}</numFmts>` : '')
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${2 + formats.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>${xfs}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
  const styleOf = (code) => (code ? 2 + formats.indexOf(code) : 0);
  return { xml, styleOf };
}

function buildSheet(sheet, styleOf) {
  const rows = sheet.rows || [];
  const width = Math.max(1, ...rows.map((r) => r.length));
  const cols = (sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(w) || 10}" customWidth="1"/>`).join('');
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (v === null || v === undefined || v === '') return '';
      const style = r === 0 ? 1 : styleOf(sheet.formats?.[c]);
      const s = style ? ` s="${style}"` : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const filter = sheet.autofilter && rows.length ? `<autoFilter ref="A1:${colName(width - 1)}${rows.length}"/>` : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${body}</sheetData>${filter}</worksheet>`;
}

function buildParts(sheets) {
  const names = sheetNames(sheets);
  const { xml: styles, styleOf } = buildStyles(sheets);
  const parts = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      + (sheets.some((sh) => sh.autofilter)
        ? `<definedNames>${sheets.map((sh, i) => (sh.autofilter && sh.rows?.length
          ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!$A$1:$${colName(Math.max(1, ...sh.rows.map((r) => r.length)) - 1)}$${sh.rows.length}</definedName>`
          : '')).join('')}</definedNames>`
        : '')
      + '</workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>',
    'xl/styles.xml': styles,
  };
  sheets.forEach((sh, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = buildSheet(sh, styleOf); });
  return parts;
}

// ---- ZIP (stored, no compression) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    // version 20, flags bit 11 = UTF-8 names, method 0 = stored, time/date 0
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034B50), ...common]);
    chunks.push(local, nameBytes, data);
    central.push(new Uint8Array([...u32(0x02014B50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const count = Object.keys(files).length;
  const end = new Uint8Array([...u32(0x06054B50), ...u16(0), ...u16(0), ...u16(count), ...u16(count),
    ...u32(centralSize), ...u32(offset), ...u16(0)]);
  return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function buildWorkbookBlob(sheets) {
  return zip(buildParts(sheets));
}

export function downloadWorkbook(filename, sheets) {
  const url = URL.createObjectURL(buildWorkbookBlob(sheets));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
