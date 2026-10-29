import { createHash } from 'node:crypto';

export const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
export interface Chunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  heading: string;
  text: string;
}

/** Line numbers refer to the original file; headings inside fences are plain text. */
export function chunkDocument(path: string, text: string): Chunk[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chunks: Chunk[] = [];
  let start = 0;
  let size = 0;
  let heading = '';
  const headings: string[] = [];
  let fence: { char: string; length: number } | undefined;
  const flush = (end: number) => {
    const content = lines.slice(start, end).join('\n');
    const hasBody = content.split('\n').some(line => line.trim() && !/^ {0,3}#{1,6}\s/.test(line));
    if (hasBody) chunks.push({
      id: hash(`${path}\0${start + 1}\0${end}\0${heading}\0${content}`).slice(0, 24),
      path, startLine: start + 1, endLine: end, heading, text: content,
    });
    start = end;
    size = 0;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 4000) throw new Error(`Line ${i + 1} in ${path} exceeds 4,000 characters`);
    const title = !fence && /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (title) {
      flush(i);
      headings.length = title[1]!.length;
      headings[title[1]!.length - 1] = title[2]!;
      heading = headings.filter(Boolean).join(' / ');
    }
    if (size + line.length > 6000 || i - start >= 60) flush(i);
    size += line.length + 1;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { char: marker[1]![0]!, length: marker[1]!.length };
      else if (marker[1]![0] === fence.char && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined;
    }
  }
  flush(lines.length);
  return chunks;
}
