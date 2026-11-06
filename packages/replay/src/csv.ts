// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

/** RFC 4180 CSV → array of header-keyed rows. Quotes, escaped quotes, CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (head === undefined) return [];
  const keys = head.map((h) => h.trim().replace(/^\uFEFF/, ''));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export function parseRows(text: string, fileName: string): Record<string, unknown>[] {
  if (fileName.endsWith('.json') || text.trimStart().startsWith('[')) {
    const v: unknown = JSON.parse(text);
    if (!Array.isArray(v)) throw new Error(`${fileName}: expected a JSON array`);
    return v as Record<string, unknown>[];
  }
  if (fileName.endsWith('.jsonl')) return text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
  return parseCsv(text);
}
