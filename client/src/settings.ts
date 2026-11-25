import { useState } from 'react';

// UI preferences remembered in the browser (localStorage). Only display choices live here, never
// transcripts or answers (SECURITY_PRIVACY: no persistence by default).

export function load(key: string): string | null {
  try {
    return localStorage.getItem(`metor.${key}`);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    localStorage.setItem(`metor.${key}`, value);
  } catch {
    // Private browsing etc.: the choice just isn't remembered.
  }
}

/** A remembered choice, if it's still one of the allowed values. */
export function useSetting<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const stored = load(key);
  const [value, setValue] = useState<T>(allowed.includes(stored as T) ? (stored as T) : fallback);
  return [value, (v: T) => (setValue(v), save(key, v))] as const;
}

/** Answer text size in px and line spacing, for the answers panel and focus mode. */
export const FONT_SIZES = ['14', '16', '18', '20', '24', '28', '32'] as const;
export const LINE_SPACINGS = ['1.3', '1.5', '1.7', '2'] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export type LineSpacing = (typeof LINE_SPACINGS)[number];

export interface AnswerDisplay {
  fontSize: FontSize;
  lineSpacing: LineSpacing;
}

export function useAnswerDisplay() {
  const [fontSize, setFontSize] = useSetting<FontSize>('answerFontSize', FONT_SIZES, '18');
  const [lineSpacing, setLineSpacing] = useSetting<LineSpacing>('answerLineSpacing', LINE_SPACINGS, '1.5');
  return { display: { fontSize, lineSpacing }, setFontSize, setLineSpacing };
}
