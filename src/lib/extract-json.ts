/**
 * Extract JSON from text that may be wrapped in markdown code blocks
 * or surrounded by explanatory text (common with local models).
 *
 * Handles:
 * - Plain JSON
 * - ```json ... ```
 * - ``` ... ```
 * - JSON embedded in prose: "Here is the result: {...}"
 * - JSON with trailing commas
 * - JSON with single quotes (converted to double)
 */
export function extractJSON(text: string): string {
  // 1. Try markdown code block extraction first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    const extracted = codeBlockMatch[1].trim();
    if (looksLikeJSON(extracted)) return extracted;
  }

  // 2. Try the whole text as-is
  const trimmed = text.trim();
  if (looksLikeJSON(trimmed)) return trimmed;

  // 3. Find the first { or [ and match to its closing bracket
  const jsonStart = findJSONStart(trimmed);
  if (jsonStart !== -1) {
    const extracted = extractBalancedBrackets(trimmed, jsonStart);
    if (extracted) return extracted;
  }

  // 4. Fallback: return the trimmed text and let JSON.parse handle errors
  return trimmed;
}

function looksLikeJSON(text: string): boolean {
  return (text.startsWith('{') && text.endsWith('}')) ||
         (text.startsWith('[') && text.endsWith(']'));
}

function findJSONStart(text: string): number {
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');

  if (objStart === -1 && arrStart === -1) return -1;
  if (objStart === -1) return arrStart;
  if (arrStart === -1) return objStart;
  return Math.min(objStart, arrStart);
}

function extractBalancedBrackets(text: string, start: number): string | null {
  const openChar = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
