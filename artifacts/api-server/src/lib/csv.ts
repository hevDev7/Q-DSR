/**
 * A small CSV reader and writer.
 *
 * Evidence bundles are the one input a stranger controls, so parsing is strict:
 * ragged rows and non-numeric cells are reported with their line number rather
 * than coerced. A silently mis-parsed matrix would produce a confident, wrong verdict.
 */

export class CsvParseError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = 'CsvParseError';
    this.line = line;
  }
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

function splitLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) throw new CsvParseError(1, 'file is empty');

  const header = splitLine(lines[0]!);
  const rows: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!);
    if (cells.length !== header.length) {
      throw new CsvParseError(
        i + 1,
        `expected ${header.length} columns to match the header, found ${cells.length}`,
      );
    }
    rows.push(cells);
  }

  if (rows.length === 0) throw new CsvParseError(2, 'file has a header but no data rows');
  return { header, rows };
}

function toNumber(raw: string, line: number, column: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new CsvParseError(line, `column "${column}" is not a finite number: ${JSON.stringify(raw)}`);
  }
  return value;
}

export interface ReturnsSeries {
  timestamps: string[];
  returns: number[];
  column: string;
}

/**
 * Reads a returns file.
 *
 * Accepts any two-or-more column CSV whose first column is a label and whose
 * chosen column is numeric, so exports from pandas, Excel or a custom backtester
 * all work without a conversion step.
 */
export function parseReturns(text: string, preferredColumn?: string): ReturnsSeries {
  const { header, rows } = parseCsv(text);
  if (header.length < 2) {
    throw new CsvParseError(1, 'returns file needs a timestamp column and a return column');
  }

  const index = preferredColumn ? header.indexOf(preferredColumn) : 1;
  if (index < 1) {
    throw new CsvParseError(
      1,
      preferredColumn
        ? `column "${preferredColumn}" not found; available: ${header.slice(1).join(', ')}`
        : 'no return column found',
    );
  }

  const timestamps: string[] = [];
  const returns: number[] = [];
  rows.forEach((cells, i) => {
    timestamps.push(cells[0]!);
    returns.push(toNumber(cells[index]!, i + 2, header[index]!));
  });

  return { timestamps, returns, column: header[index]! };
}

export interface TrialsMatrix {
  columns: string[];
  /** T rows x N columns. */
  matrix: number[][];
  /** True when the first column held labels rather than returns. */
  hasLabelColumn: boolean;
}

/**
 * Reads a trials matrix — every configuration explored during optimisation.
 *
 * The first column is treated as a label only if it is non-numeric, so both
 * "timestamp,cfg1,cfg2" and a bare numeric matrix are accepted.
 */
export function parseTrials(text: string): TrialsMatrix {
  const { header, rows } = parseCsv(text);
  const firstCellNumeric = Number.isFinite(Number(rows[0]![0]!));
  const start = firstCellNumeric ? 0 : 1;

  const columns = header.slice(start);
  if (columns.length < 1) throw new CsvParseError(1, 'trials file has no configuration columns');

  const matrix = rows.map((cells, i) => {
    const row = new Array<number>(columns.length);
    for (let n = 0; n < columns.length; n++) {
      row[n] = toNumber(cells[start + n]!, i + 2, columns[n]!);
    }
    return row;
  });

  return { columns, matrix, hasLabelColumn: !firstCellNumeric };
}

/** Serialises a matrix back to CSV — used by the sample generator. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header.join(',')];
  for (const row of rows) lines.push(row.join(','));
  return `${lines.join('\n')}\n`;
}
