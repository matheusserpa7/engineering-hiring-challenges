import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ProgressBar from '../src/components/progress-bar.vue';

function bar(percent: number, raisedCents = 4_305_800, goalCents = 15_000_000) {
  const wrapper = mount(ProgressBar, { props: { percent, raisedCents, goalCents } });
  const meter = wrapper.get('[role="progressbar"]');
  return {
    text: wrapper.text(),
    now: meter.attributes('aria-valuenow'),
    min: meter.attributes('aria-valuemin'),
    max: meter.attributes('aria-valuemax'),
    valueText: meter.attributes('aria-valuetext'),
    fill: wrapper.get('[data-testid="progress-fill"]').attributes('style'),
  };
}

describe('progress-bar', () => {
  it('shows 28% with both amounts in the accessible text', () => {
    const result = bar(28);

    expect(result.text).toContain('28%');
    expect(result.min).toBe('0');
    expect(result.max).toBe('100');
    expect(result.now).toBe('28');
    expect(result.valueText).toBe('28% of goal: $43,058.00 of $150,000.00');
    expect(result.fill).toContain('width: 28%');
  });

  it('reads 0%, never NaN, for an empty campaign', () => {
    const result = bar(0, 0);

    expect(result.text).toContain('0%');
    expect(result.text).not.toContain('NaN');
    expect(result.now).toBe('0');
    expect(result.fill).toContain('width: 0%');
  });

  it('caps the bar, not the number', () => {
    const result = bar(115, 17_250_000);

    expect(result.text).toContain('115%');
    expect(result.now).toBe('100');
    expect(result.fill).toContain('width: 100%');
  });
});
