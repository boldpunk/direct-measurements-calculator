// The frontend's own .xlsx writer (src/xlsx-writer.js). Checks the ZIP is
// well-formed (CRC via node's zlib, independent of the writer's own table)
// and the workbook parts say what we asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildWorkbookBlob } from '../../src/xlsx-writer.js';

async function unzip(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + size);
    assert.equal(zlib.crc32(data), crc, `crc of ${name}`);
    files[name] = data.toString('utf8');
    p += 46 + nameLen;
  }
  return files;
}

test('workbook with two sheets, formats and escaping', async () => {
  const files = await unzip(buildWorkbookBlob([
    { name: 'Финансы', rows: [['Клиент', 'Сумма'], ['A & "B" <c>', 1260000000]], widths: [20, 14], formats: { 1: '#,##0' }, autofilter: true },
    { name: 'Финансы', rows: [['x']] },
  ]));
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(files[part], part);
  }
  assert.match(files['xl/workbook.xml'], /name="Финансы"/);
  assert.match(files['xl/workbook.xml'], /name="Финансы 2"/, 'duplicate sheet names are made unique');
  assert.match(files['xl/styles.xml'], /formatCode="#,##0"/);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<v>1260000000<\/v>/, 'numbers stay numbers');
  assert.match(sheet, /A &amp; &quot;B&quot; &lt;c&gt;/, 'text is escaped');
  assert.match(sheet, /<autoFilter ref="A1:B2"\/>/);
  assert.match(sheet, /<col min="1" max="1" width="20"/);
});

test('sheet names lose characters Excel forbids', async () => {
  const files = await unzip(buildWorkbookBlob([{ name: 'a:b/c?*[d]', rows: [] }]));
  assert.match(files['xl/workbook.xml'], /name="a b c   d"/);
});
