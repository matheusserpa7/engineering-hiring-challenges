import { describe, expect, it } from 'vitest';
import { campaignPhase } from '../src/services/campaigns.js';

const startsAt = new Date('2026-08-01T00:00:00.000Z');
const endsAt = new Date('2026-12-31T23:59:59.000Z');
const ms = (d: Date, delta: number): Date => new Date(d.getTime() + delta);
const inside = new Date('2026-10-15T12:00:00.000Z');

describe('campaignPhase', () => {
  it('is closed when the campaign is inactive, even inside its dates', () => {
    expect(campaignPhase({ isActive: false, startsAt, endsAt }, inside)).toBe('closed');
  });

  it('is upcoming 1 ms before startsAt', () => {
    expect(campaignPhase({ isActive: true, startsAt, endsAt }, ms(startsAt, -1))).toBe('upcoming');
  });

  it('is open exactly at startsAt', () => {
    expect(campaignPhase({ isActive: true, startsAt, endsAt }, startsAt)).toBe('open');
  });

  it('is open exactly at endsAt', () => {
    expect(campaignPhase({ isActive: true, startsAt, endsAt }, endsAt)).toBe('open');
  });

  it('is closed 1 ms after endsAt', () => {
    expect(campaignPhase({ isActive: true, startsAt, endsAt }, ms(endsAt, 1))).toBe('closed');
  });

  it('is open when both dates are null', () => {
    expect(campaignPhase({ isActive: true, startsAt: null, endsAt: null }, inside)).toBe('open');
  });

  it('is closed with no start and an end in the past', () => {
    expect(campaignPhase({ isActive: true, startsAt: null, endsAt }, ms(endsAt, 1000))).toBe(
      'closed',
    );
  });

  it('is upcoming with no end and a start in the future', () => {
    expect(campaignPhase({ isActive: true, startsAt, endsAt: null }, ms(startsAt, -1000))).toBe(
      'upcoming',
    );
  });

  it('is open with no end once it has started', () => {
    expect(campaignPhase({ isActive: true, startsAt, endsAt: null }, ms(startsAt, 1000))).toBe(
      'open',
    );
  });
});
