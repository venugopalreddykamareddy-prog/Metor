import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, ROLES, ROLE_TEMPLATES, domainLine, newProfile, profileContext, profileContextSchema } from './profile.ts';
import { WHISPER_PROMPT, whisperPrompt } from './vocabulary.ts';

describe('profiles', () => {
  it('has a template for every role, custom starting empty', () => {
    for (const r of ROLES) expect(ROLE_TEMPLATES[r].label.length).toBeGreaterThan(0);
    expect(ROLE_TEMPLATES.custom.topics).toEqual([]);
    expect(newProfile('qa_automation', '', 'p1', 0)).toMatchObject({ name: 'QA Automation Engineer', prefs: DEFAULT_PREFS });
  });

  it('sends only a small, valid context; custom roles use their own name', () => {
    const p = { ...newProfile('custom', 'Data Platform Engineer', 'p2', 0), level: 'Senior', topics: ['Spark', 'Airflow'] };
    const ctx = profileContext(p);
    expect(profileContextSchema.safeParse(ctx).success).toBe(true);
    expect(domainLine(ctx)).toBe('Senior Data Platform Engineer (Spark, Airflow)');
    expect(Object.keys(ctx).sort()).toEqual(['id', 'label', 'level', 'prefs', 'role', 'topics']);
  });
});

describe('whisperPrompt', () => {
  it('keeps the default prompt without terms and stays within the limit with many', () => {
    expect(whisperPrompt(undefined)).toBe(WHISPER_PROMPT);
    expect(whisperPrompt(['Selenium', 'Playwright'])).toBe('Technical interview: Selenium, Playwright.');
    expect(whisperPrompt(Array.from({ length: 60 }, (_, i) => `LongTermNumber${i}Xyz`)).length).toBeLessThanOrEqual(701);
  });
});
