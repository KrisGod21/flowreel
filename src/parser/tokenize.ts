export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasCurrent = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes && ch === '\\') {
      const next = line[i + 1];
      if (next === '"' || next === '\\') {
        current += next;
        hasCurrent = true;
        i++;
        continue;
      }
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      hasCurrent = true;
      continue;
    }

    if (!inQuotes && ch === '#') break;

    if (!inQuotes && /\s/.test(ch)) {
      if (hasCurrent) {
        tokens.push(current);
        current = '';
        hasCurrent = false;
      }
      continue;
    }

    current += ch;
    hasCurrent = true;
  }

  if (inQuotes) throw new Error('Unterminated quote');
  if (hasCurrent) tokens.push(current);

  return tokens;
}
