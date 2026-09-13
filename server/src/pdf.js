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

// Combined "materials + services" table matching the paper invoice layout:
// № | Артикул | Наименование | Кол-во | Ед. | Вес, кг | Цена | Сумма, ending
// with an "ИТОГО" row rather than a separate summary block. Long names wrap
// onto extra lines (doc.text with a fixed width) rather than overflowing.
function drawItemsTable(doc, { rows, total, currency }) {
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const GAP = 8;
  const cols = [
    { key: 'n', label: '№', slot: 20 },
    { key: 'sku', label: 'Артикул', slot: 65 },
    { key: 'name', label: 'Наименование', slot: usableWidth - 20 - 65 - 45 - 35 - 45 - 85 - 85 },
    { key: 'qty', label: 'Кол-во', slot: 45, align: 'right' },
    { key: 'unit', label: 'Ед.', slot: 35 },
    { key: 'weight', label: 'Вес, кг', slot: 45, align: 'right' },
    { key: 'price', label: 'Цена', slot: 85, align: 'right' },
    { key: 'sum', label: 'Сумма', slot: 85, align: 'right' },
  ];

  function colX(i) {
    return left + cols.slice(0, i).reduce((s, c) => s + c.slot, 0);
  }
  const textWidth = (c) => c.slot - GAP;

  doc.font(FONT_BOLD).fontSize(9);
  const headerY = doc.y;
  cols.forEach((c, i) => doc.text(c.label, colX(i), headerY, { width: textWidth(c), align: c.align || 'left' }));
  doc.moveDown(0.3);
  doc.moveTo(left, doc.y).lineTo(left + usableWidth, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  doc.font(FONT_REGULAR).fontSize(9);
  if (!rows.length) {
    doc.fillColor('#888888').text('Материалы и услуги не добавлены', left, doc.y, { width: usableWidth });
    doc.fillColor('#000000');
  } else {
    rows.forEach((r, idx) => {
      const rowY = doc.y;
      const values = [
        String(idx + 1), r.sku || '', r.name, String(r.qty), r.unit,
        r.weight ? String(r.weight) : '', fmtMoney(r.unitPrice, currency), fmtMoney(r.qty * r.unitPrice, currency),
      ];
      let maxHeight = 0;
      cols.forEach((c, i) => {
        const h = doc.heightOfString(values[i], { width: textWidth(c), align: c.align || 'left' });
        maxHeight = Math.max(maxHeight, h);
      });
      cols.forEach((c, i) => doc.text(values[i], colX(i), rowY, { width: textWidth(c), align: c.align || 'left' }));
      doc.y = rowY + maxHeight + 4;
    });
  }

  doc.moveDown(0.2);
  doc.moveTo(left, doc.y).lineTo(left + usableWidth, doc.y).strokeColor('#000000').stroke();
  doc.moveDown(0.3);

  const totalRowY = doc.y;
  doc.font(FONT_BOLD).fontSize(10);
  doc.text('ИТОГО', colX(2), totalRowY, { width: textWidth(cols[2]), align: 'left' });
  doc.text(fmtMoney(total, currency), colX(7), totalRowY, { width: textWidth(cols[7]), align: 'right' });
  doc.y = totalRowY + doc.heightOfString('ИТОГО', { width: textWidth(cols[2]) }) + 4;
  doc.x = left;
  doc.moveDown(0.8);
}

// Small "Этап | Срок" schedule table listing the order's (non-skipped)
// production stages, mirroring the paper invoice's production-schedule box.
function drawStagesTable(doc, { stages }) {
  if (!stages.length) return;
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cols = [
    { key: 'n', label: '№', slot: 24 },
    { key: 'name', label: 'Этап производства', slot: usableWidth - 24 - 120 },
    { key: 'deadline', label: 'Срок', slot: 120, align: 'right' },
  ];
  function colX(i) {
    return left + cols.slice(0, i).reduce((s, c) => s + c.slot, 0);
  }
  const textWidth = (c) => c.slot - 8;

  doc.font(FONT_BOLD).fontSize(12).text('ГРАФИК ПРОИЗВОДСТВА');
  doc.moveDown(0.3);

  doc.font(FONT_BOLD).fontSize(9);
  const headerY = doc.y;
  cols.forEach((c, i) => doc.text(c.label, colX(i), headerY, { width: textWidth(c), align: c.align || 'left' }));
  doc.moveDown(0.3);
  doc.moveTo(left, doc.y).lineTo(left + usableWidth, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  doc.font(FONT_REGULAR).fontSize(9);
  stages.forEach((st, idx) => {
    const rowY = doc.y;
    const values = [String(idx + 1), st.name, st.deadline ? fmtDate(st.deadline) : '—'];
    let maxHeight = 0;
    cols.forEach((c, i) => {
      const h = doc.heightOfString(values[i], { width: textWidth(c), align: c.align || 'left' });
      maxHeight = Math.max(maxHeight, h);
    });
    cols.forEach((c, i) => doc.text(values[i], colX(i), rowY, { width: textWidth(c), align: c.align || 'left' }));
    doc.y = rowY + maxHeight + 4;
  });

  doc.x = left;
  doc.moveDown(0.5);
}

// Builds the full order PDF and pipes it into `res` (an Express response
// with Content-Type already set to application/pdf by the caller).
export function renderOrderPdf(res, { order, materials, services, stages, client, manager, settings }) {
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
  doc.text(`№ заказа: ${order.productType} #${order.number}`);
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
  const rows = [
    ...materials.map((m) => ({ sku: m.sku, name: m.name, qty: m.qty, unit: m.unit, unitPrice: m.unitPrice, weight: m.weight })),
    ...services.map((s) => ({ sku: '', name: s.name, qty: s.qty, unit: s.unit, unitPrice: s.unitPrice, weight: s.weight })),
  ];
  const total = rows.reduce((s, r) => s + r.qty * r.unitPrice, 0);
  drawItemsTable(doc, { rows, total, currency });

  drawStagesTable(doc, { stages: stages || [] });

  doc.moveDown(1.5);
  doc.font('regular').fontSize(10);
  doc.text('Комментарий: _____________________________________________');
  doc.moveDown(1.5);
  doc.text('Подпись клиента: _______________________');
  doc.moveDown(1.2);
  doc.text('Ответственный: _______________________');

  doc.end();
}
