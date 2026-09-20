// Коммерческое предложение / Tijorat taklifi — a presentation document, not
// an ERP table print-out. Layout follows the reference sample: logo header
// with a dark badge, customer / prepared-by cards, a partner-brands row,
// photo item cards, then a deadline + grand-total block and a brand footer.
//
// Everything is driven by the proposal's own data: language (ru/uz) swaps
// every label, themeColor drives accents, and the currency symbol is
// whatever the proposal was saved with.
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = path.join(__dirname, '../assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '../assets/fonts/DejaVuSans-Bold.ttf');

const STRINGS = {
  ru: {
    title: 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ',
    customer: 'ЗАКАЗЧИК',
    preparedBy: 'КП ПОДГОТОВИЛ',
    partners: 'ПАРТНЁРЫ ПРОЕКТА',
    colPhoto: 'Фото',
    colName: 'Наименование / Описание',
    colQty: 'Кол-во',
    colPrice: 'Цена',
    colSum: 'Сумма',
    deadline: 'СРОК ИЗГОТОВЛЕНИЯ',
    itemsTotal: 'Изделия:',
    grandTotal: 'ОБЩАЯ СУММА',
    project: 'Проект',
    phone: 'Тел.',
    regards: 'С уважением,',
    responsible: 'Ответственный сотрудник',
    client: 'Клиент',
    empty: 'Позиции не добавлены',
    page: 'Стр.',
  },
  uz: {
    title: 'TIJORAT TAKLIFI',
    customer: 'BUYURTMACHI',
    preparedBy: 'TAKLIF TAYYORLADI',
    partners: 'LOYIHADAGI HAMKORLARIMIZ',
    colPhoto: 'Surat',
    colName: 'Mahsulot nomi / Tavsif',
    colQty: 'Soni',
    colPrice: 'Narxi',
    colSum: 'Umumiy',
    deadline: 'TOPSHIRISH MUDDATI',
    itemsTotal: 'Mahsulotlar:',
    grandTotal: 'UMUMIY QIYMAT',
    project: 'Loyiha',
    phone: 'Tel.',
    regards: 'Hurmat bilan,',
    responsible: "Mas'ul xodim",
    client: 'Mijoz',
    empty: "Mahsulotlar qo'shilmagan",
    page: 'Sahifa',
  },
};

const PAGE_MARGIN = 42;
const INK = '#161618';
const MUTED = '#8A8A92';
const HAIRLINE = '#E6E6EA';

function fmtMoney(amount, currency) {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  const whole = Math.trunc(rounded);
  const cents = Math.round(Math.abs(rounded - whole) * 100);
  const grouped = whole.toLocaleString('ru-RU').replace(/ /g, ' ');
  return `${cents ? `${grouped},${String(cents).padStart(2, '0')}` : grouped} ${currency}`;
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Dark accent colours need light text on top of them; derived from the
// standard sRGB luminance so any user-picked HEX stays readable.
function isDark(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const int = parseInt(m[1], 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) < 150;
}

function safeColor(hex, fallback = '#E8913A') {
  return /^#?[0-9a-f]{6}$/i.test(String(hex || '')) ? (String(hex).startsWith('#') ? hex : `#${hex}`) : fallback;
}

// Accepts a data: URI or an http(s) URL. Remote images are fetched with a
// short timeout so one unreachable host can't hang the whole render; a
// failure just means that card renders without a photo.
async function loadImage(src) {
  if (!src) return null;
  try {
    if (src.startsWith('data:')) {
      const base64 = src.split(',')[1];
      return base64 ? Buffer.from(base64, 'base64') : null;
    }
    if (/^https?:\/\//i.test(src)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(src, { signal: controller.signal });
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    // Unreadable image — fall through and render the card without it.
  }
  return null;
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bottomLimit(doc) {
  // Leave room for the footer strip on every page.
  return doc.page.height - doc.page.margins.bottom - 46;
}

function drawHeader(doc, { proposal, settings, logo, t, accent }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const top = doc.y;

  // Dark badge with the document type — sized to its own text so the longer
  // Russian title doesn't spill out of a fixed-width pill.
  const badgeFont = 8;
  doc.font('bold').fontSize(badgeFont);
  const badgeW = Math.min(230, doc.widthOfString(t.title, { characterSpacing: 0.6 }) + 28);
  const badgeH = 22;
  const badgeX = left + width - badgeW;
  doc.roundedRect(badgeX, top, badgeW, badgeH, 4).fill(INK);
  doc.fillColor('#FFFFFF')
    .text(t.title, badgeX, top + 7, { width: badgeW, align: 'center', characterSpacing: 0.6, lineBreak: false });

  // Number and date share one right-aligned line; the date is measured first
  // so the number can be placed just left of it instead of overlapping.
  const dateText = fmtDate(proposal.date);
  const numberText = `#${proposal.number}`;
  doc.font('bold').fontSize(9);
  const dateW = doc.widthOfString(dateText) + 2;
  const lineY = top + badgeH + 8;
  doc.fillColor(accent).text(dateText, left + width - dateW, lineY, { width: dateW, align: 'right', lineBreak: false });
  doc.fillColor(MUTED).text(numberText, left, lineY, { width: width - dateW - 10, align: 'right', lineBreak: false });

  const textLimit = badgeX - left - 16;
  let textX = left;
  if (logo) {
    try {
      doc.image(logo, left, top, { fit: [64, 46], align: 'left', valign: 'top' });
      textX = left + 76;
    } catch {
      // Unsupported image format (PDFKit handles JPEG/PNG only) — skip it.
    }
  }

  const textW = Math.max(120, textLimit - (textX - left));
  doc.font('bold').fontSize(13).fillColor(INK)
    .text(settings?.companyName || 'MEBELFLOW', textX, top, { width: textW });
  if (settings?.companySlogan) {
    doc.font('regular').fontSize(8.5).fillColor(MUTED)
      .text(settings.companySlogan, textX, doc.y + 1, { width: textW });
  }
  if (settings?.companyPhone) {
    doc.font('regular').fontSize(8.5).fillColor(MUTED)
      .text(settings.companyPhone, textX, doc.y + 1, { width: textW });
  }

  const headerBottom = Math.max(doc.y, top + 62);
  doc.y = headerBottom + 10;
  doc.strokeColor(HAIRLINE).lineWidth(1).moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
  doc.y += 14;
  doc.x = left;
}

function drawInfoCards(doc, { proposal, settings, responsible, t, accent }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const gap = 12;
  const cardW = (width - gap) / 2;
  const top = doc.y;
  const pad = 12;

  const customerLines = [
    proposal.clientName && { bold: true, size: 11, text: proposal.clientName },
    proposal.clientPhone && { text: `${t.phone} ${proposal.clientPhone}` },
    proposal.clientAddress && { text: proposal.clientAddress },
    proposal.projectName && { text: `${t.project}: ${proposal.projectName}` },
  ].filter(Boolean);

  const preparedLines = [
    responsible?.name && { bold: true, size: 11, text: responsible.name },
    settings?.companyName && { text: settings.companyName },
    responsible?.phone && { text: `${t.phone} ${responsible.phone}` },
  ].filter(Boolean);

  // Measure both columns first so the two cards share one height.
  const measure = (lines) => {
    let h = pad + 13;
    for (const line of lines) {
      doc.font(line.bold ? 'bold' : 'regular').fontSize(line.size || 9);
      h += doc.heightOfString(line.text, { width: cardW - pad * 2 }) + 2;
    }
    return h + pad;
  };
  const cardH = Math.max(measure(customerLines), measure(preparedLines), 64);

  const drawCard = (x, label, lines) => {
    doc.roundedRect(x, top, cardW, cardH, 6).fillAndStroke('#FAFAFB', HAIRLINE);
    doc.font('bold').fontSize(7).fillColor(accent)
      .text(label, x + pad, top + pad, { width: cardW - pad * 2, characterSpacing: 0.8 });
    let y = top + pad + 13;
    for (const line of lines) {
      doc.font(line.bold ? 'bold' : 'regular').fontSize(line.size || 9)
        .fillColor(line.bold ? INK : MUTED)
        .text(line.text, x + pad, y, { width: cardW - pad * 2 });
      y = doc.y + 2;
    }
  };

  drawCard(left, t.customer, customerLines);
  drawCard(left + cardW + gap, t.preparedBy, preparedLines);

  doc.y = top + cardH + 16;
  doc.x = left;
}

function drawBrands(doc, { brands, t, brandLogos }) {
  if (!brands.length) return;
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  doc.font('bold').fontSize(7).fillColor(MUTED)
    .text(t.partners, left, doc.y, { width, characterSpacing: 0.8 });
  doc.y += 8;

  const cellW = 104;
  const cellH = 30;
  const perRow = Math.max(1, Math.floor(width / cellW));
  let x = left;
  let y = doc.y;
  let col = 0;

  for (const brand of brands) {
    const logo = brandLogos.get(brand.id);
    if (logo) {
      try {
        doc.image(logo, x, y, { fit: [cellW - 12, cellH - 6], align: 'left', valign: 'center' });
      } catch {
        doc.font('bold').fontSize(9).fillColor(INK).text(brand.name, x, y + 9, { width: cellW - 12 });
      }
    } else {
      doc.font('bold').fontSize(9).fillColor(INK).text(brand.name, x, y + 9, { width: cellW - 12, ellipsis: true });
    }
    col += 1;
    if (col >= perRow) {
      col = 0;
      x = left;
      y += cellH + 6;
    } else {
      x += cellW;
    }
  }

  doc.y = (col === 0 ? y : y + cellH) + 12;
  doc.x = left;
  doc.strokeColor(HAIRLINE).lineWidth(1).moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
  doc.y += 14;
}

// Column geometry is shared between the header row and every item card so
// the photo/name/qty/price/sum stay aligned across page breaks.
function itemColumns(doc) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const photo = 92;
  const qty = 56;
  const price = 76;
  const sum = 82;
  return {
    left,
    width,
    photoX: left,
    photoW: photo,
    nameX: left + photo + 14,
    nameW: width - photo - 14 - qty - price - sum,
    qtyX: left + width - qty - price - sum,
    qtyW: qty,
    priceX: left + width - price - sum,
    priceW: price,
    sumX: left + width - sum,
    sumW: sum,
  };
}

function drawItemsHeader(doc, { t, accent }) {
  const c = itemColumns(doc);
  const y = doc.y;
  doc.font('bold').fontSize(7.5).fillColor(accent);
  doc.text(t.colPhoto, c.photoX, y, { width: c.photoW, characterSpacing: 0.5 });
  doc.text(t.colName, c.nameX, y, { width: c.nameW, characterSpacing: 0.5 });
  doc.text(t.colQty, c.qtyX, y, { width: c.qtyW, align: 'center', characterSpacing: 0.5 });
  doc.text(t.colPrice, c.priceX, y, { width: c.priceW, align: 'right', characterSpacing: 0.5 });
  doc.text(t.colSum, c.sumX, y, { width: c.sumW, align: 'right', characterSpacing: 0.5 });
  doc.y = y + 14;
  doc.strokeColor(HAIRLINE).lineWidth(1).moveTo(c.left, doc.y).lineTo(c.left + c.width, doc.y).stroke();
  doc.y += 12;
  doc.x = c.left;
}

function drawItemCard(doc, { item, image, currency, t, accent }) {
  const c = itemColumns(doc);

  // Work out the card height before drawing anything, so the row can be
  // moved to a fresh page whole rather than split across the break.
  doc.font('bold').fontSize(10);
  const nameH = doc.heightOfString(item.name || '', { width: c.nameW });
  doc.font('regular').fontSize(8.5);
  const descH = item.description ? doc.heightOfString(item.description, { width: c.nameW }) : 0;
  const dimsH = item.dimensions ? doc.heightOfString(item.dimensions, { width: c.nameW }) : 0;
  const textH = nameH + (descH ? descH + 5 : 0) + (dimsH ? dimsH + 4 : 0);
  const photoH = image ? 68 : 0;
  const rowH = Math.max(textH, photoH, 34) + 18;

  if (doc.y + rowH > bottomLimit(doc)) {
    doc.addPage();
    drawItemsHeader(doc, { t, accent });
  }

  const top = doc.y;

  if (image) {
    try {
      // fit[] preserves the aspect ratio — images are never stretched.
      doc.image(image, c.photoX, top, { fit: [c.photoW, 68], align: 'center', valign: 'top' });
    } catch {
      // Unsupported format; the card simply has no photo.
    }
  }

  doc.font('bold').fontSize(10).fillColor(INK)
    .text(item.name || '', c.nameX, top, { width: c.nameW });
  let textY = doc.y;
  if (item.description) {
    doc.font('regular').fontSize(8.5).fillColor(MUTED)
      .text(item.description, c.nameX, textY + 4, { width: c.nameW });
    textY = doc.y;
  }
  if (item.dimensions) {
    doc.font('regular').fontSize(8.5).fillColor(INK)
      .text(item.dimensions, c.nameX, textY + 3, { width: c.nameW });
  }

  const qty = Number(item.quantity) || 0;
  const qtyText = Number.isInteger(qty) ? String(qty) : String(qty).replace('.', ',');
  doc.font('bold').fontSize(10).fillColor(INK)
    .text(qtyText, c.qtyX, top + 2, { width: c.qtyW, align: 'center' });
  doc.font('regular').fontSize(7.5).fillColor(MUTED)
    .text(item.unit || '', c.qtyX, doc.y + 1, { width: c.qtyW, align: 'center' });

  doc.font('regular').fontSize(9.5).fillColor(MUTED)
    .text(fmtMoney(item.unitPrice, currency), c.priceX, top + 2, { width: c.priceW, align: 'right' });
  doc.font('bold').fontSize(10.5).fillColor(INK)
    .text(fmtMoney(item.total, currency), c.sumX, top + 2, { width: c.sumW, align: 'right' });

  doc.y = top + rowH;
  doc.strokeColor(HAIRLINE).lineWidth(0.5).moveTo(c.left, doc.y - 8).lineTo(c.left + c.width, doc.y - 8).stroke();
  doc.x = c.left;
}

function drawTotals(doc, { proposal, t, accent, currency }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const gap = 12;
  const leftW = (width - gap) * 0.46;
  const rightW = width - gap - leftW;
  const boxH = 74;

  if (doc.y + boxH > bottomLimit(doc)) doc.addPage();
  const top = doc.y + 6;

  if (proposal.deadline) {
    doc.roundedRect(left, top, leftW, boxH, 6).fillAndStroke('#FAFAFB', HAIRLINE);
    doc.font('bold').fontSize(7).fillColor(MUTED)
      .text(t.deadline, left + 14, top + 14, { width: leftW - 28, characterSpacing: 0.8 });
    doc.font('bold').fontSize(17).fillColor(accent)
      .text(proposal.deadline, left + 14, top + 30, { width: leftW - 28 });
  }

  // Grand total sits on a dark card so the accent colour reads as premium
  // rather than washing out on white.
  const rx = left + leftW + gap;
  doc.roundedRect(rx, top, rightW, boxH, 6).fill(INK);
  doc.font('regular').fontSize(9).fillColor('#B8B8C0')
    .text(t.itemsTotal, rx + 14, top + 14, { width: rightW - 28 });
  doc.font('regular').fontSize(9).fillColor('#B8B8C0')
    .text(fmtMoney(proposal.subtotal, currency), rx + 14, top + 14, { width: rightW - 28, align: 'right' });
  doc.font('bold').fontSize(9).fillColor('#FFFFFF')
    .text(t.grandTotal, rx + 14, top + 44, { width: rightW - 28 });
  // A dark accent would disappear against the dark card — fall back to white.
  doc.font('bold').fontSize(16).fillColor(isDark(accent) ? '#FFFFFF' : accent)
    .text(fmtMoney(proposal.total, currency), rx + 14, top + 38, { width: rightW - 28, align: 'right' });

  doc.y = top + boxH + 16;
  doc.x = left;
}

function drawClosing(doc, { proposal, responsible, t }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  if (proposal.finalText) {
    if (doc.y + 50 > bottomLimit(doc)) doc.addPage();
    doc.font('regular').fontSize(9.5).fillColor(INK)
      .text(proposal.finalText, left, doc.y, { width, align: 'left' });
    doc.y += 14;
  }

  if (doc.y + 62 > bottomLimit(doc)) doc.addPage();
  const top = doc.y + 4;
  const colW = (width - 40) / 2;

  doc.font('regular').fontSize(9).fillColor(MUTED).text(t.regards, left, top, { width: colW });
  doc.strokeColor(HAIRLINE).lineWidth(1)
    .moveTo(left, top + 34).lineTo(left + colW - 20, top + 34).stroke();
  doc.font('regular').fontSize(8).fillColor(MUTED)
    .text(responsible?.name || t.responsible, left, top + 38, { width: colW });

  const rx = left + colW + 40;
  doc.strokeColor(HAIRLINE).lineWidth(1)
    .moveTo(rx, top + 34).lineTo(rx + colW - 20, top + 34).stroke();
  doc.font('regular').fontSize(8).fillColor(MUTED)
    .text(t.client, rx, top + 38, { width: colW });

  doc.y = top + 56;
  doc.x = left;
}

// Drawn onto every page at the very end, once the total page count is known.
function decoratePages(doc, { settings, t, accent }) {
  const range = doc.bufferedPageRange();
  const contacts = [settings?.companyAddress, settings?.companyWebsite].filter(Boolean).join('  ·  ');
  const socials = [settings?.companyInstagram && `@${String(settings.companyInstagram).replace(/^@/, '')}`]
    .filter(Boolean).join('  ');

  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const y = doc.page.height - doc.page.margins.bottom - 30;

    doc.strokeColor(HAIRLINE).lineWidth(1).moveTo(left, y).lineTo(left + width, y).stroke();
    doc.font('bold').fontSize(8).fillColor(INK)
      .text(settings?.companyName || '', left, y + 7, { width: width * 0.6, lineBreak: false });
    if (contacts) {
      doc.font('regular').fontSize(7).fillColor(MUTED)
        .text(contacts, left, y + 18, { width: width * 0.6, lineBreak: false });
    }
    if (socials) {
      doc.font('regular').fontSize(7.5).fillColor(accent)
        .text(socials, left + width * 0.6, y + 7, { width: width * 0.4, align: 'right', lineBreak: false });
    }
    doc.font('regular').fontSize(7).fillColor(MUTED)
      .text(`${t.page} ${i + 1} / ${range.count}`, left + width * 0.6, y + 18, { width: width * 0.4, align: 'right', lineBreak: false });
  }
}

export async function renderProposalPdf(res, { proposal, settings, responsible, brands = [] }) {
  const t = STRINGS[proposal.language === 'uz' ? 'uz' : 'ru'];
  const accent = safeColor(proposal.themeColor);
  const currency = proposal.currency || settings?.currency || '$';

  // Fetch every image up front: PDFKit's drawing API is synchronous, so all
  // remote/base64 decoding has to be resolved before the layout starts.
  const [logo, ...itemImages] = await Promise.all([
    loadImage(settings?.logoUrl),
    ...proposal.items.map((item) => loadImage(item.imageUrl)),
  ]);
  const brandLogos = new Map();
  await Promise.all(brands.map(async (b) => {
    const img = await loadImage(b.logoUrl);
    if (img) brandLogos.set(b.id, img);
  }));

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.pipe(res);

  drawHeader(doc, { proposal, settings, logo, t, accent });
  drawInfoCards(doc, { proposal, settings, responsible, t, accent });
  drawBrands(doc, { brands, t, brandLogos });

  drawItemsHeader(doc, { t, accent });
  if (!proposal.items.length) {
    doc.font('regular').fontSize(9).fillColor(MUTED).text(t.empty, doc.page.margins.left, doc.y);
    doc.y += 16;
  }
  proposal.items.forEach((item, i) => {
    drawItemCard(doc, { item, image: itemImages[i], currency, t, accent });
  });

  drawTotals(doc, { proposal, t, accent, currency });
  drawClosing(doc, { proposal, responsible, t });
  decoratePages(doc, { settings, t, accent });

  doc.end();
}
