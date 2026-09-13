import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = path.join(__dirname, '../assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '../assets/fonts/DejaVuSans-Bold.ttf');

function fmtMoney(n, currency) {
  return `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ${currency}`;
}

function fmtDate(value) {
  return new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function bottomLimit(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

// A small Excel-style grid table: bold header row, then data rows each with a
// light horizontal rule underneath and vertical rules between columns. Rows
// that don't fit on the current page start a fresh page and repeat the
// header — without this, PDFKit's own auto-pagination would split a single
// row's cells across two pages (each landing on its own near-blank page).
function drawGridTable(doc, { cols, rows, emptyLabel }) {
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const GAP = 8;

  function colX(i) {
    return left + cols.slice(0, i).reduce((s, c) => s + c.slot, 0);
  }
  const textWidth = (c) => c.slot - GAP;

  function drawHeader() {
    doc.font(FONT_BOLD).fontSize(9);
    const headerY = doc.y;
    let maxHeight = 0;
    cols.forEach((c, i) => {
      doc.text(c.label, colX(i), headerY, { width: textWidth(c), align: c.align || 'left' });
      maxHeight = Math.max(maxHeight, doc.heightOfString(c.label, { width: textWidth(c), align: c.align || 'left' }));
    });
    const lineY = headerY + maxHeight + 4;
    doc.strokeColor('#999999').lineWidth(1);
    doc.moveTo(left, headerY - 2).lineTo(left + usableWidth, headerY - 2).stroke();
    doc.moveTo(left, lineY).lineTo(left + usableWidth, lineY).stroke();
    cols.forEach((c, i) => {
      const x = colX(i);
      doc.moveTo(x, headerY - 2).lineTo(x, lineY).stroke();
    });
    doc.moveTo(left + usableWidth, headerY - 2).lineTo(left + usableWidth, lineY).stroke();
    doc.strokeColor('#000000').lineWidth(1);
    doc.x = left;
    doc.y = lineY + 4;
  }

  function drawRow(values, { bold = false } = {}) {
    doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(9);
    let maxHeight = 0;
    cols.forEach((c, i) => {
      const h = doc.heightOfString(values[i], { width: textWidth(c), align: c.align || 'left' });
      maxHeight = Math.max(maxHeight, h);
    });
    const rowHeight = maxHeight + 8;

    if (doc.y + rowHeight > bottomLimit(doc)) {
      doc.addPage();
      drawHeader();
      doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(9);
    }

    const rowY = doc.y;
    cols.forEach((c, i) => doc.text(values[i], colX(i), rowY, { width: textWidth(c), align: c.align || 'left' }));

    const lineY = rowY + maxHeight + 4;
    doc.strokeColor('#dddddd').lineWidth(0.5);
    doc.moveTo(left, lineY).lineTo(left + usableWidth, lineY).stroke();
    cols.forEach((c, i) => {
      const x = colX(i);
      doc.moveTo(x, rowY - 2).lineTo(x, lineY).stroke();
    });
    doc.moveTo(left + usableWidth, rowY - 2).lineTo(left + usableWidth, lineY).stroke();
    doc.strokeColor('#000000').lineWidth(1);

    doc.x = left;
    doc.y = lineY + 4;
  }

  drawHeader();
  if (!rows.length) {
    doc.font(FONT_REGULAR).fontSize(9).fillColor('#888888').text(emptyLabel, left, doc.y, { width: usableWidth });
    doc.fillColor('#000000');
    doc.x = left;
    doc.moveDown(0.5);
    return;
  }
  rows.forEach((values) => drawRow(values));
  return drawRow;
}

// Builds the full order PDF and pipes it into `res` (an Express response
// with Content-Type already set to application/pdf by the caller).
export function renderOrderPdf(res, { order, materials, services, stages, manufacturing, client, manager, settings }) {
  const currency = settings?.currency || '$';
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.pipe(res);

  doc.font('bold').fontSize(20).text((settings?.companyName || 'MEBELFLOW').toUpperCase());
  doc.font('bold').fontSize(13).fillColor('#444444').text('РАСЧЁТ ЗАКАЗА');
  doc.fillColor('#000000');
  doc.moveDown(0.5);
  doc.font('regular').fontSize(10);
  doc.text(`№ заказа: ${order.productType ? `${order.productType} ` : ''}#${order.number}`);
  doc.text(`Дата: ${fmtDate(order.createdAt)}`);
  doc.moveDown(0.8);

  const clientLines = [];
  if (order.clientName) clientLines.push(['Клиент:', order.clientName]);
  if (order.clientPhone) clientLines.push(['Телефон:', order.clientPhone]);
  if (order.productType) clientLines.push(['Проект:', order.productType]);
  if (order.address) clientLines.push(['Адрес:', order.address]);
  if (manager?.name) clientLines.push(['Ответственный:', manager.name]);
  if (clientLines.length) {
    clientLines.forEach(([label, value]) => {
      doc.font('bold').text(label, { continued: true }).font('regular').text(` ${value}`);
    });
    doc.moveDown(0.8);
  }

  doc.font('bold').fontSize(12).text('МАТЕРИАЛЫ И УСЛУГИ');
  doc.moveDown(0.3);
  const items = [
    ...materials.map((m) => ({ sku: m.sku, name: m.name, qty: m.qty, unit: m.unit, unitPrice: m.unitPrice, weight: m.weight })),
    ...services.map((s) => ({ sku: '', name: s.name, qty: s.qty, unit: s.unit, unitPrice: s.unitPrice, weight: s.weight })),
  ];
  const total = items.reduce((s, r) => s + r.qty * r.unitPrice, 0);

  const itemsUsableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const itemCols = [
    { key: 'n', label: '№', slot: 20 },
    { key: 'sku', label: 'Артикул', slot: 65 },
    { key: 'name', label: 'Наименование', slot: itemsUsableWidth - 20 - 65 - 45 - 35 - 45 - 85 - 85 },
    { key: 'qty', label: 'Кол-во', slot: 45, align: 'right' },
    { key: 'unit', label: 'Ед.', slot: 35 },
    { key: 'weight', label: 'Вес, кг', slot: 45, align: 'right' },
    { key: 'price', label: 'Цена', slot: 85, align: 'right' },
    { key: 'sum', label: 'Сумма', slot: 85, align: 'right' },
  ];
  const itemRows = items.map((r, idx) => [
    String(idx + 1), r.sku || '', r.name, String(r.qty), r.unit,
    r.weight ? String(r.weight) : '', fmtMoney(r.unitPrice, currency), fmtMoney(r.qty * r.unitPrice, currency),
  ]);
  const drawItemRow = drawGridTable(doc, { cols: itemCols, rows: itemRows, emptyLabel: 'Материалы и услуги не добавлены' });
  if (items.length && drawItemRow) {
    drawItemRow(['', '', 'ИТОГО', '', '', '', '', fmtMoney(total, currency)], { bold: true });
  }
  doc.moveDown(0.5);

  if (stages && stages.length) {
    doc.font('bold').fontSize(12).text('ГРАФИК ПРОИЗВОДСТВА');
    doc.moveDown(0.3);
    const stagesUsableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const stageCols = [
      { key: 'n', label: '№', slot: 24 },
      { key: 'name', label: 'Этап производства', slot: stagesUsableWidth - 24 - 120 },
      { key: 'deadline', label: 'Срок', slot: 120, align: 'right' },
    ];
    const stageRows = stages.map((st, idx) => [String(idx + 1), st.name, st.deadline ? fmtDate(st.deadline) : '—']);
    drawGridTable(doc, { cols: stageCols, rows: stageRows, emptyLabel: '' });
    doc.moveDown(0.5);
  }

  if (manufacturing && manufacturing.length) {
    doc.font('bold').fontSize(12).text('ДАТА ИЗГОТОВЛЕНИЯ');
    doc.moveDown(0.3);
    const mfgUsableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const mfgCols = [
      { key: 'n', label: '№', slot: 24 },
      { key: 'name', label: 'Услуга', slot: mfgUsableWidth - 24 - 120 },
      { key: 'date', label: 'Дата', slot: 120, align: 'right' },
    ];
    const mfgRows = manufacturing.map((m, idx) => [String(idx + 1), m.name, m.date ? fmtDate(m.date) : '—']);
    drawGridTable(doc, { cols: mfgCols, rows: mfgRows, emptyLabel: '' });
    doc.moveDown(0.5);
  }

  doc.moveDown(1);
  doc.font('regular').fontSize(10);
  doc.text('Комментарий: _____________________________________________');
  doc.moveDown(1.5);
  doc.text('Подпись клиента: _______________________');
  doc.moveDown(1.2);
  doc.text('Ответственный: _______________________');

  doc.end();
}
