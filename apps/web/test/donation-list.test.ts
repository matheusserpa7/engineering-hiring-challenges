import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DonationList from '../src/components/donation-list.vue';
import { donation } from './fixtures';

function render(donations: ReturnType<typeof donation>[]) {
  return mount(DonationList, { props: { donations } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('donation-list', () => {
  it('renders XSS payloads as text', () => {
    const script = '<script>alert(1)</script>';
    const img = '<img src=x onerror="alert(document.cookie)">';

    const wrapper = render([
      donation({ id: '33333333-3333-4333-8333-333333333333', message: script }),
      donation({ id: '44444444-4444-4444-8444-444444444444', message: img }),
    ]);

    expect(wrapper.text()).toContain(script);
    expect(wrapper.text()).toContain(img);
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('renders Devanagari and emoji exactly', () => {
    const emoji = 'Proud of you \u{1F389}\u{1F468}‍\u{1F469}‍\u{1F467}';

    const wrapper = render([
      donation({
        displayName: 'अनिशा गुरुङ',
        dedication: { type: 'in_memory_of', name: 'बुबा' },
        message: 'सधैं सम्झनामा।',
      }),
      donation({ id: '55555555-5555-4555-8555-555555555555', message: emoji }),
    ]);

    const text = wrapper.text();
    expect(text).toContain('अनिशा गुरुङ');
    expect(text).toContain('In memory of बुबा');
    expect(text).toContain('सधैं सम्झनामा।');
    expect(text).toContain(emoji);
  });

  it('does not truncate a long message', () => {
    const message = `${'a'.repeat(280)}END`;

    const wrapper = render([donation({ message })]);

    expect(Array.from(message)).toHaveLength(283);
    expect(wrapper.text()).toContain(message);
  });

  it('renders nothing for a null dedication and a null message', () => {
    const wrapper = render([donation({ dedication: null, message: null })]);

    expect(wrapper.text()).not.toContain('In honor of');
    expect(wrapper.text()).not.toContain('In memory of');
    expect(wrapper.find('[data-testid="donation-message"]').exists()).toBe(false);
  });

  it('shows a dedication as "In honor of"', () => {
    const wrapper = render([donation({ dedication: { type: 'in_honor_of', name: 'Aama' } })]);

    expect(wrapper.text()).toContain('In honor of Aama');
  });

  it('shows the name and the amount', () => {
    const wrapper = render([donation({ displayName: 'The Gurung family', amountCents: 5100 })]);

    expect(wrapper.text()).toContain('The Gurung family');
    expect(wrapper.text()).toContain('$51.00');
  });

  it('shows relative time, with the exact instant in <time>', () => {
    const wrapper = render([donation({ createdAt: '2026-08-26T12:00:00.000Z' })]);

    const time = wrapper.get('time');
    expect(time.text()).toBe('2 months ago');
    expect(time.attributes('datetime')).toBe('2026-08-26T12:00:00.000Z');
    expect(time.attributes('title')).toBeTruthy();
  });

  it('shows the empty-state sentence for no donations', () => {
    const wrapper = render([]);

    expect(wrapper.text()).toContain('No donations yet. Be the first to give.');
    expect(wrapper.find('li').exists()).toBe(false);
  });
});
