import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = path.join(__dirname, '../assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '../assets/fonts/DejaVuSans-Bold.ttf');

function fmtMoney(n, currency) {
  return `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ${currency}`;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Renders one "№ | Наименование | Кол-во | Ед. | Цена | Сумма" table with a
// running-total footer row. Long names wrap onto extra lines (doc.text with
// a fixed width) rather than overflowing into the next column.
function drawTable(doc, { rows, total, totalLabel, currency, emptyLabel }) {
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const GAP = 10;
  const cols = [
    { key: 'n', label: '№', slot: 24 },
    { key: 'name', label: 'Наименование', slot: usableWidth - 24 - 55 - 55 - 95 - 95 },
    { key: 'qty', label: 'Кол-во', slot: 55, align: 'right' },
    { key: 'unit', label: 'Ед.', slot: 55 },
    { key: 'price', label: 'Цена', slot: 95, align: 'right' },
    { key: 'sum', label: 'Сумма', slot: 95, align: 'right' },
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
    doc.fillColor('#888888').text(emptyLabel, left, doc.y, { width: usableWidth });
    doc.fillColor('#000000');
  } else {
    rows.forEach((r, idx) => {
      const rowY = doc.y;
      const values = [
        String(idx + 1), r.name, String(r.qty), r.unit,
        fmtMoney(r.unitPrice, currency), fmtMoney(r.qty * r.unitPrice, currency),
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
  doc.moveTo(left, doc.y).lineTo(left + usableWidth, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.4);
  doc.font(FONT_BOLD).fontSize(10).text(`${totalLabel}: ${fmtMoney(total, currency)}`, left, doc.y, { width: usableWidth, align: 'right' });
  doc.moveDown(0.8);
}

// Builds the full order PDF and pipes it into `res` (an Express response
// with Content-Type already set to application/pdf by the caller).
export function renderOrderPdf(res, { order, materials, services, client, manager, settings }) {
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

  doc.font('bold').fontSize(12).text('МАТЕРИАЛЫ');
  doc.moveDown(0.3);
  const materialsTotal = materials.reduce((s, m) => s + m.qty * m.unitPrice, 0);
  drawTable(doc, { rows: materials, total: materialsTotal, totalLabel: 'Итого материалов', currency, emptyLabel: 'Материалы не добавлены' });

  doc.font('bold').fontSize(12).text('УСЛУГИ');
  doc.moveDown(0.3);
  const servicesTotal = services.reduce((s, x) => s + x.qty * x.unitPrice, 0);
  drawTable(doc, { rows: services, total: servicesTotal, totalLabel: 'Итого услуг', currency, emptyLabel: 'Услуги не добавлены' });

  doc.moveDown(0.5);
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveTo(left, doc.y).lineTo(left + usableWidth, doc.y).strokeColor('#000000').stroke();
  doc.moveDown(0.4);
  doc.font('regular').fontSize(10);
  doc.text(`Материалы: ${fmtMoney(materialsTotal, currency)}`, { align: 'right' });
  doc.text(`Услуги: ${fmtMoney(servicesTotal, currency)}`, { align: 'right' });
  doc.moveDown(0.2);
  doc.font('bold').fontSize(14).text(`ИТОГО: ${fmtMoney(materialsTotal + servicesTotal, currency)}`, { align: 'right' });

  doc.moveDown(2.5);
  doc.font('regular').fontSize(10);
  doc.text('Комментарий: _____________________________________________');
  doc.moveDown(1.5);
  doc.text('Подпись клиента: _______________________');
  doc.moveDown(1.2);
  doc.text('Ответственный: _______________________');

  doc.end();
}
