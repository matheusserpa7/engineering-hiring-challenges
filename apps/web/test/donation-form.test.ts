import { DonationRequestSchema, type DonationRequest } from '@aangan/shared';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DonationForm from '../src/components/donation-form.vue';
import { campaign } from './fixtures';

function mountForm(props: { busy?: boolean } = {}): VueWrapper {
  return mount(DonationForm, { props: { campaign: campaign(), ...props } });
}

async function fillValid(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('input[name="fullName"]').setValue('Priya Sharma');
  await wrapper.get('input[name="email"]').setValue('Priya@Example.com');
}

async function chooseCustom(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.get('input[name="amount"][value="custom"]').setValue(true);
  await wrapper.get('input[name="customAmount"]').setValue(text);
}

function emitted(wrapper: VueWrapper): DonationRequest[] {
  return (wrapper.emitted('submit') ?? []).map(([request]) => request as DonationRequest);
}

describe('donation form', () => {
  it('offers the presets from the campaign and a custom amount', () => {
    const wrapper = mountForm();

    const labels = wrapper.findAll('fieldset label').map((label) => label.text());
    expect(labels).toEqual(expect.arrayContaining(['$25.00', '$50.00', '$100.00']));
    expect(wrapper.find('input[name="amount"][value="custom"]').exists()).toBe(true);
  });

  it('defaults privacy to public and explains all three modes in one sentence', () => {
    const wrapper = mountForm();

    const checked = wrapper.get<HTMLInputElement>('input[name="privacyMode"]:checked');
    expect(checked.element.value).toBe('public');
    const sentence = wrapper.get('[data-testid="privacy-explanation"]').text();
    expect(sentence).toMatch(/public/i);
    expect(sentence).toMatch(/anonymous/i);
    expect(sentence).toMatch(/family/i);
  });

  it('shows the dedication fields only when the box is ticked', async () => {
    const wrapper = mountForm();
    expect(wrapper.find('select[name="dedicationType"]').exists()).toBe(false);
    expect(wrapper.find('input[name="dedicationName"]').exists()).toBe(false);

    await wrapper.get('input[name="dedicate"]').setValue(true);

    expect(wrapper.find('select[name="dedicationType"]').exists()).toBe(true);
    expect(wrapper.find('input[name="dedicationName"]').exists()).toBe(true);
  });

  it('counts the message in code points and blocks 281', async () => {
    const wrapper = mountForm();
    await fillValid(wrapper);
    await wrapper.get('input[name="amount"]').setValue(true);

    await wrapper.get('textarea[name="message"]').setValue('😀'.repeat(280));
    expect(wrapper.get('[data-testid="message-count"]').text()).toBe('280 / 280');
    await wrapper.get('form').trigger('submit');
    expect(emitted(wrapper)).toHaveLength(1);

    await wrapper.get('textarea[name="message"]').setValue('😀'.repeat(281));
    expect(wrapper.get('[data-testid="message-count"]').text()).toBe('281 / 280');
    await wrapper.get('form').trigger('submit');
    expect(emitted(wrapper)).toHaveLength(1);
    expect(wrapper.get('[role="alert"], .error').text()).not.toBe('');
  });

  it.each([
    ['0.99', false],
    ['25000.01', false],
    ['25,000', false],
    ['abc', false],
    ['', false],
    ['1.00', 100],
    ['25000.00', 2_500_000],
  ])('custom amount %s', async (text, expected) => {
    const wrapper = mountForm();
    await fillValid(wrapper);
    await chooseCustom(wrapper, text);

    await wrapper.get('form').trigger('submit');

    if (expected === false) {
      expect(emitted(wrapper)).toHaveLength(0);
      expect(wrapper.get('[data-testid="amount-error"]').text()).not.toBe('');
    } else {
      expect(emitted(wrapper)[0]?.amountCents).toBe(expected);
    }
  });

  it('tells a comma to use digits only', async () => {
    const wrapper = mountForm();
    await fillValid(wrapper);
    await chooseCustom(wrapper, '1,000');

    await wrapper.get('form').trigger('submit');

    expect(wrapper.get('[data-testid="amount-error"]').text()).toContain('digits only');
  });

  it('sends exactly the contract: integer cents, normalised keys, no extras', async () => {
    const wrapper = mountForm();
    await fillValid(wrapper);
    await wrapper.get('input[name="dedicate"]').setValue(true);
    await wrapper.get('select[name="dedicationType"]').setValue('in_memory_of');
    await wrapper.get('input[name="dedicationName"]').setValue('Aama');
    await wrapper.get('textarea[name="message"]').setValue('With love');
    await wrapper.get('input[name="privacyMode"][value="anonymous"]').setValue(true);
    await wrapper.get('select[name="paymentToken"]').setValue('tok_decline');
    await chooseCustom(wrapper, '51.5');

    await wrapper.get('form').trigger('submit');

    const [request] = emitted(wrapper);
    expect(request).toEqual({
      campaignSlug: 'aangan-courtyard',
      amountCents: 5150,
      donor: { fullName: 'Priya Sharma', email: 'priya@example.com' },
      dedication: { type: 'in_memory_of', name: 'Aama' },
      message: 'With love',
      privacyMode: 'anonymous',
      isRecurring: false,
      paymentToken: 'tok_decline',
    });
    expect(DonationRequestSchema.safeParse(request).success).toBe(true);
    expect(Number.isInteger(request?.amountCents)).toBe(true);
  });

  it('sends a preset amount in cents', async () => {
    const wrapper = mountForm();
    await fillValid(wrapper);
    await wrapper.get('input[name="amount"][value="5000"]').setValue(true);

    await wrapper.get('form').trigger('submit');

    expect(emitted(wrapper)[0]?.amountCents).toBe(5000);
  });

  it('refuses to submit without an amount, a name or an email', async () => {
    const wrapper = mountForm();

    await wrapper.get('form').trigger('submit');

    expect(emitted(wrapper)).toHaveLength(0);
    expect(wrapper.get('[data-testid="amount-error"]').text()).not.toBe('');
    expect(wrapper.get('[data-testid="fullName-error"]').text()).not.toBe('');
    expect(wrapper.get('[data-testid="email-error"]').text()).not.toBe('');
  });

  it('disables the button while a request is in flight', () => {
    const wrapper = mountForm({ busy: true });

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
  });

  it('labels every input and groups the radios under legends', () => {
    const wrapper = mountForm();

    for (const input of wrapper.findAll('input[type="text"], input[type="email"], textarea')) {
      expect(wrapper.find(`label[for="${input.attributes('id') ?? ''}"]`).exists()).toBe(true);
    }
    expect(wrapper.findAll('fieldset legend').length).toBeGreaterThanOrEqual(2);
  });
});
