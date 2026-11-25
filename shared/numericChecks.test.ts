import { describe, expect, it } from 'vitest';
import { checkAvailabilityNumbers } from './numericChecks.ts';

const kinds = (text: string) => checkAvailabilityNumbers(text).map((i) => i.kind);

describe('availability direction', () => {
  it('catches a target called tighter when its number is looser (regression: live answer, 2026-11-24)', () => {
    const answer =
      'First, I’d find out what customers need—say they need 99.95 % uptime per month. That becomes the SLO we track internally. ' +
      'Then I’d set the SLA a bit tighter than the SLO, adding a safety margin—maybe 99.9 % uptime—so we have room.';
    const issues = checkAvailabilityNumbers(answer);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe('Says SLA (99.9%) is tighter than SLO (99.95%), but 99.95% is the stricter target (less downtime).');
  });

  it('accepts a correct comparison in either wording', () => {
    expect(kinds('The SLO is 99.95% and the SLA is 99.9%, so the SLA is looser than the SLO.')).toEqual([]);
    expect(kinds('Set the SLO to 99.95%. The SLO is stricter than the SLA at 99.9%.')).toEqual([]);
    expect(kinds('99.99% is stricter than 99.9%, by a factor of ten in downtime.')).toEqual([]);
  });

  it('catches direct percentage comparisons the wrong way round', () => {
    expect(kinds('99.9% is a higher target than 99.95%.')).toEqual(['availability_direction']);
    expect(kinds('Moving from 99.99% to 99.9% makes it stricter; 99.9% is stricter than 99.99%.')).toEqual(['availability_direction']);
  });

  it('ignores comparisons it cannot ground in numbers, and non-availability percentages', () => {
    expect(kinds('Keep the SLA looser than the SLO so you have a buffer.')).toEqual([]);
    expect(kinds('CPU at 80% is higher than 60%.')).toEqual([]);
  });
});

describe('downtime arithmetic', () => {
  it('accepts correct downtime figures', () => {
    for (const text of [
      'A 99.9% monthly SLO allows about 43 minutes of downtime per month.',
      '99.95% uptime is roughly 22 minutes a month.',
      '99.99% availability means about 52 minutes per year.',
      'At 99.9% you get about 1.4 minutes of downtime a day.',
    ]) {
      expect(kinds(text), text).toEqual([]);
    }
  });

  it('catches downtime that does not match the percentage', () => {
    const issues = checkAvailabilityNumbers('With 99.99% availability we can afford about four hours, say 4 hours of downtime per month.');
    expect(issues.map((i) => i.message)).toEqual(['99.99% allows about 4.3 minutes of downtime per month, not 4 hours.']);
    expect(kinds('99.9% means roughly 8 minutes of downtime per year.')).toEqual(['downtime_arithmetic']);
  });
});
