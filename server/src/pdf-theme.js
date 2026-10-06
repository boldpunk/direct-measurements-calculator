// Shared look for every generated PDF except the commercial proposal (which
// has its own presentation layout in pdf-proposal.js, built on the same
// palette and fonts).
//
// Before this, the order calculation and the reports were bare grid tables
// in DejaVu Sans with no logo, no footer and no page numbers — next to the
// proposal they looked like a different company's paperwork. Everything here
// draws in Inter (the app's own font) with one accent colour: the company's
// brand colour from Настройки, or the app blue.
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, '../assets/fonts');
export const FONTS = {
  regular: path.join(FONT_DIR, 'Inter-Regular.ttf'),
  medium: path.join(FONT_DIR, 'Inter-Medium.ttf'),
  semibold: path.join(FONT_DIR, 'Inter-SemiBold.ttf'),
  bold: path.join(FONT_DIR, 'Inter-Bold.ttf'),
};

export const INK = '#111827';
export const MUTED = '#6B7280';
export const FAINT = '#9CA3AF';
export const HAIRLINE = '#E5E7EB';
export const SOFT = '#F7F8FA';
export const DARK = '#14161B';
export const DEFAULT_ACCENT = '#2563EB';
export const PAGE_MARGIN = 42;
// Room kept free at the bottom of every page for the footer strip.
const FOOTER_SPACE = 44;

// ---- Formatting ----

// Cents only when there are any; ru-RU grouping; a no-break space before the
// currency so a narrow column never splits "4 200" from "$".
export function fmtMoney(amount, currency) {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.trunc(abs);
  const cents = Math.round((abs - whole) * 100);
  const grouped = whole.toLocaleString('ru-RU');
  return `${negative ? '−' : ''}${cents ? `${grouped},${String(cents).padStart(2, '0')}` : grouped} ${currency}`;
}

export function fmtDate(value) {
  if (!value) return '';
  // Plain yyyy-mm-dd strings are calendar dates: format them without a Date
  // round-trip, which would shift the day in timezones west of UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Phones are stored however they were typed ("+998946085005", "+998 90 777-11-22").
// Uzbek numbers print one way everywhere; anything else is left as entered.
export function fmtPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('998')) {
    return `+998 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
  }
  if (digits.length === 9 && !raw.startsWith('+')) {
    return `+998 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
  }
  return raw;
}

export function safeColor(hex, fallback = DEFAULT_ACCENT) {
  const v = String(hex || '');
  if (!/^#?[0-9a-f]{6}$/i.test(v)) return fallback;
  return v.startsWith('#') ? v : `#${v}`;
}

// Dark colours need light text on top; standard luminance weighting.
export function isDark(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const int = parseInt(m[1], 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) < 150;
}

// Mix a colour toward white (amount 0..1) — a dark brand colour is lifted to
// a readable tint on the dark total card instead of being swapped for white.
export function lighten(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const ch = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => Math.round(c + (255 - c) * amount));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// A data: URI or an http(s) URL → Buffer. Remote images get a short timeout
// so one dead link can't hang the whole document.
export async function loadImage(src) {
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
    // Unreadable image — the caller draws without it.
  }
  return null;
}

// ---- Document ----

export function createDoc(res, { title, settings } = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: { Title: title || '', Author: settings?.companyName || 'MebelFlow', Creator: 'MebelFlow' },
  });
  Object.entries(FONTS).forEach(([name, file]) => doc.registerFont(name, file));
  doc.pipe(res);
  return doc;
}

export function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

export function bottomLimit(doc) {
  return doc.page.height - doc.page.margins.bottom - FOOTER_SPACE;
}

export function ensureSpace(doc, height) {
  if (doc.y + height > bottomLimit(doc)) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }
}

// Logo (or company name + slogan) on the left; on the right a dark badge with
// the document type and, under it, its number and date.
export function drawHeader(doc, { settings, logo, title, number, date, accent }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const top = doc.page.margins.top;

  // A wide logo usually already contains the company name, so it stands
  // alone; a square/emblem logo gets the name and slogan set beside it.
  let textX = left;
  let showName = true;
  if (logo) {
    try {
      const img = doc.openImage(logo);
      if (img.width / img.height >= 2.2) {
        doc.image(img, left, top, { fit: [170, 42], align: 'left', valign: 'top' });
        showName = false;
      } else {
        doc.image(img, left, top, { fit: [42, 42], align: 'left', valign: 'top' });
        textX = left + 54;
      }
    } catch {
      // Not a PNG/JPEG PDFKit can embed — the name alone below.
    }
  }
  if (showName) {
    const nameW = width * 0.55 - (textX - left);
    doc.font('bold').fontSize(16).fillColor(INK)
      .text(settings?.companyName || 'MebelFlow', textX, top + (textX > left ? 3 : 0), { width: nameW, lineBreak: false });
    if (settings?.companySlogan) {
      doc.font('regular').fontSize(8.5).fillColor(MUTED)
        .text(settings.companySlogan, textX, top + (textX > left ? 24 : 21), { width: nameW, lineBreak: false });
    }
  }

  const badgeText = String(title || '').toUpperCase();
  doc.font('semibold').fontSize(7.5);
  const badgeW = Math.min(260, doc.widthOfString(badgeText, { characterSpacing: 0.6 }) + 26);
  const badgeX = left + width - badgeW;
  doc.roundedRect(badgeX, top, badgeW, 21, 6).fill(DARK);
  doc.fillColor('#FFFFFF').text(badgeText, badgeX, top + 6.5, { width: badgeW, align: 'center', characterSpacing: 0.6, lineBreak: false });

  const metaY = top + 30;
  doc.font('semibold').fontSize(9);
  const dateText = date || '';
  const dateW = dateText ? doc.widthOfString(dateText) + 1 : 0;
  if (dateText) {
    doc.fillColor(accent).text(dateText, left + width - dateW, metaY, { width: dateW, lineBreak: false });
  }
  if (number) {
    doc.fillColor(FAINT).text(number, left, metaY, { width: width - dateW - (dateText ? 12 : 0), align: 'right', lineBreak: false });
  }

  const ruleY = top + 58;
  doc.strokeColor(HAIRLINE).lineWidth(1).moveTo(left, ruleY).lineTo(left + width, ruleY).stroke();
  doc.x = left;
  doc.y = ruleY + 16;
}

// Small spaced-out caps label above a block, like the proposal's section heads.
export function sectionTitle(doc, text, { accent, gapBefore = 6 } = {}) {
  ensureSpace(doc, 40);
  doc.y += gapBefore;
  doc.font('semibold').fontSize(7.5).fillColor(accent || MUTED)
    .text(String(text).toUpperCase(), doc.page.margins.left, doc.y, { characterSpacing: 0.9, lineBreak: false });
  doc.y += 14;
}

// One or two soft cards side by side: a coloured caps label, a bold title and
// muted detail lines (empty lines are skipped).
export function drawInfoCards(doc, cards, { accent }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const gap = 12;
  const cardW = cards.length > 1 ? (width - gap) / 2 : width;
  const pad = 13;

  const measure = (card) => {
    let h = pad + 11 + 4;
    doc.font('bold').fontSize(11);
    h += doc.heightOfString(card.title || '—', { width: cardW - pad * 2 }) + 3;
    doc.font('regular').fontSize(8.5);
    (card.lines || []).filter(Boolean).forEach((line) => { h += doc.heightOfString(line, { width: cardW - pad * 2 }) + 2; });
    return h + pad;
  };
  const cardH = Math.max(...cards.map(measure), 64);
  ensureSpace(doc, cardH + 10);
  const top = doc.y;

  cards.forEach((card, i) => {
    const x = left + i * (cardW + gap);
    doc.roundedRect(x, top, cardW, cardH, 8).fillAndStroke(SOFT, HAIRLINE);
    let y = top + pad;
    doc.font('semibold').fontSize(7).fillColor(accent)
      .text(String(card.label || '').toUpperCase(), x + pad, y, { width: cardW - pad * 2, characterSpacing: 0.8, lineBreak: false });
    y += 15;
    doc.font('bold').fontSize(11).fillColor(INK).text(card.title || '—', x + pad, y, { width: cardW - pad * 2 });
    y = doc.y + 3;
    doc.font('regular').fontSize(8.5).fillColor(MUTED);
    (card.lines || []).filter(Boolean).forEach((line) => {
      doc.text(line, x + pad, y, { width: cardW - pad * 2 });
      y = doc.y + 2;
    });
  });

  doc.x = left;
  doc.y = top + cardH + 14;
}

// Row of small stat tiles (report totals).
export function drawStatTiles(doc, tiles, { accent }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const gap = 10;
  const tileW = (width - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 50;
  ensureSpace(doc, tileH + 12);
  const top = doc.y;
  tiles.forEach((tile, i) => {
    const x = left + i * (tileW + gap);
    doc.roundedRect(x, top, tileW, tileH, 8).fillAndStroke(SOFT, HAIRLINE);
    doc.font('medium').fontSize(7.5).fillColor(MUTED)
      .text(tile.label, x + 11, top + 10, { width: tileW - 22, lineBreak: false });
    doc.font('bold').fontSize(13).fillColor(tile.color || (tile.accent ? accent : INK))
      .text(tile.value, x + 11, top + 24, { width: tileW - 22, lineBreak: false });
  });
  doc.x = left;
  doc.y = top + tileH + 16;
}

// A table without vertical rules: accent caps header, hairline between rows,
// header repeated after a page break, and a row never split across pages.
//
// columns: [{ label, width?, align? }] — columns without a width share what's left.
// rows: arrays of cells; a cell is a string or { text, sub, bold, color }.
// total: optional final row drawn bold over a darker rule.
export function drawTable(doc, { columns, rows, total, accent, emptyLabel = 'Нет данных' }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const fixed = columns.reduce((s, c) => s + (c.width || 0), 0);
  const flexCount = columns.filter((c) => !c.width).length || 1;
  const widths = columns.map((c) => c.width || (width - fixed) / flexCount);
  const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((s, w) => s + w, 0));
  const PAD_X = 6;
  const PAD_Y = 7;

  const cellOf = (cell) => (cell && typeof cell === 'object' ? cell : { text: cell == null ? '' : String(cell) });

  const drawHeaderRow = () => {
    const y = doc.y;
    doc.font('semibold').fontSize(7).fillColor(accent);
    columns.forEach((c, i) => {
      doc.text(String(c.label).toUpperCase(), xs[i] + PAD_X, y, {
        width: widths[i] - PAD_X * 2, align: c.align || 'left', characterSpacing: 0.4, lineBreak: false,
      });
    });
    const ruleY = y + 13;
    doc.strokeColor(HAIRLINE).lineWidth(1).moveTo(left, ruleY).lineTo(left + width, ruleY).stroke();
    doc.y = ruleY + 1;
  };

  const rowHeight = (cells, bold) => {
    let h = 0;
    cells.forEach((raw, i) => {
      const cell = cellOf(raw);
      const w = widths[i] - PAD_X * 2;
      doc.font(bold || cell.bold ? 'semibold' : 'regular').fontSize(9);
      let ch = doc.heightOfString(cell.text || ' ', { width: w });
      if (cell.sub) {
        doc.font('regular').fontSize(7.5);
        ch += doc.heightOfString(cell.sub, { width: w }) + 2;
      }
      h = Math.max(h, ch);
    });
    return h + PAD_Y * 2;
  };

  const drawRow = (cells, { bold = false, strongRule = false } = {}) => {
    const h = rowHeight(cells, bold);
    if (doc.y + h > bottomLimit(doc)) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHeaderRow();
    }
    const y = doc.y;
    if (strongRule) {
      doc.strokeColor(INK).lineWidth(1).moveTo(left, y).lineTo(left + width, y).stroke();
    }
    cells.forEach((raw, i) => {
      const cell = cellOf(raw);
      const w = widths[i] - PAD_X * 2;
      const align = columns[i].align || 'left';
      doc.font(bold || cell.bold ? 'semibold' : 'regular').fontSize(9).fillColor(cell.color || INK)
        .text(cell.text || '', xs[i] + PAD_X, y + PAD_Y, { width: w, align });
      if (cell.sub) {
        doc.font('regular').fontSize(7.5).fillColor(MUTED)
          .text(cell.sub, xs[i] + PAD_X, doc.y + 2, { width: w, align });
      }
    });
    const bottom = y + h;
    if (!strongRule) {
      doc.strokeColor(HAIRLINE).lineWidth(0.6).moveTo(left, bottom).lineTo(left + width, bottom).stroke();
    }
    doc.x = left;
    doc.y = bottom;
  };

  ensureSpace(doc, 60);
  drawHeaderRow();
  if (!rows.length) {
    doc.font('regular').fontSize(9).fillColor(FAINT)
      .text(emptyLabel, left + PAD_X, doc.y + PAD_Y, { width: width - PAD_X * 2 });
    doc.y += PAD_Y;
    const ruleY = doc.y;
    doc.strokeColor(HAIRLINE).lineWidth(0.6).moveTo(left, ruleY).lineTo(left + width, ruleY).stroke();
  } else {
    rows.forEach((cells) => drawRow(cells));
    if (total) drawRow(total, { bold: true, strongRule: true });
  }
  doc.x = left;
  doc.y += 14;
}

// Dark card with label/value lines and one large accent total — the same
// "ОБЩАЯ СУММА" card the proposal ends with. Drawn at the right half unless
// `fullWidth`.
export function drawTotalCard(doc, { lines = [], totalLabel, totalValue, accent, fullWidth = false }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const cardW = fullWidth ? width : width / 2 - 6;
  const x = fullWidth ? left : left + width - cardW;
  const pad = 16;
  const cardH = pad * 2 + lines.length * 17 + 28;
  ensureSpace(doc, cardH + 10);
  const top = doc.y;
  doc.roundedRect(x, top, cardW, cardH, 10).fill(DARK);
  let y = top + pad;
  lines.forEach(([label, value]) => {
    doc.font('regular').fontSize(9).fillColor('#B6BBC6').text(label, x + pad, y, { width: cardW * 0.55, lineBreak: false });
    doc.font('medium').fontSize(9).fillColor('#E5E7EB').text(value, x + pad, y, { width: cardW - pad * 2, align: 'right', lineBreak: false });
    y += 17;
  });
  if (lines.length) y += 4;
  doc.font('bold').fontSize(9).fillColor('#FFFFFF').text(String(totalLabel).toUpperCase(), x + pad, y + 6, { width: cardW * 0.5, characterSpacing: 0.4, lineBreak: false });
  doc.font('bold').fontSize(17).fillColor(isDark(accent) ? lighten(accent, 0.45) : accent)
    .text(totalValue, x + pad, y, { width: cardW - pad * 2, align: 'right', lineBreak: false });
  doc.x = left;
  doc.y = top + cardH + 16;
  return { top, height: cardH, x, width: cardW };
}

// Signature lines with a caption under each.
export function drawSignatures(doc, labels) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  ensureSpace(doc, 60);
  const gap = 36;
  const w = (width - gap * (labels.length - 1)) / labels.length;
  const y = doc.y + 26;
  labels.forEach((label, i) => {
    const x = left + i * (w + gap);
    doc.strokeColor('#C9CDD4').lineWidth(0.8).moveTo(x, y).lineTo(x + w, y).stroke();
    doc.font('regular').fontSize(7.5).fillColor(MUTED).text(label, x, y + 5, { width: w, lineBreak: false });
  });
  doc.x = left;
  doc.y = y + 24;
}

// Company footer + page numbers on every page. Called once, after all content
// (needs bufferPages so earlier pages can be revisited).
export function drawFooters(doc, { settings, accent, pageLabel = 'Стр.' }) {
  const range = doc.bufferedPageRange();
  const contacts = [settings?.companyAddress, fmtPhone(settings?.companyPhone), settings?.companyWebsite]
    .filter(Boolean).join('  ·  ');
  const instagram = settings?.companyInstagram ? `@${String(settings.companyInstagram).replace(/^@/, '')}` : '';

  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const y = doc.page.height - doc.page.margins.bottom - 28;
    // Text this low would otherwise trip PDFKit's automatic page break.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.strokeColor(HAIRLINE).lineWidth(1).moveTo(left, y).lineTo(left + width, y).stroke();
    doc.font('semibold').fontSize(8).fillColor(INK)
      .text(settings?.companyName || 'MebelFlow', left, y + 7, { width: width * 0.65, lineBreak: false });
    if (contacts) {
      doc.font('regular').fontSize(7).fillColor(MUTED)
        .text(contacts, left, y + 18, { width: width * 0.65, lineBreak: false });
    }
    if (instagram) {
      doc.font('medium').fontSize(7.5).fillColor(accent)
        .text(instagram, left + width * 0.65, y + 7, { width: width * 0.35, align: 'right', lineBreak: false });
    }
    doc.font('regular').fontSize(7).fillColor(MUTED)
      .text(`${pageLabel} ${i + 1} / ${range.count}`, left + width * 0.65, y + 18, { width: width * 0.35, align: 'right', lineBreak: false });

    doc.page.margins.bottom = savedBottom;
  }
}

// Accent for a company's documents: its brand colour, else the app blue.
export function accentFor(settings) {
  return safeColor(settings?.brandColor, DEFAULT_ACCENT);
}
