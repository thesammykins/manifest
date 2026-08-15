import { extractSubscriptionPlan } from './subscription-plan';

function jwt(payload: Record<string, unknown>): string {
  return `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;
}

describe('extractSubscriptionPlan', () => {
  it('reads the namespaced ChatGPT plan from an OAuth blob', () => {
    const token = jwt({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'Plus' } });
    const blob = JSON.stringify({ t: token, r: 'refresh', e: Date.now() + 60_000 });
    expect(extractSubscriptionPlan('openai', blob)).toBe('plus');
  });

  it('supports the top-level claim and rejects unsafe or unrelated metadata', () => {
    expect(extractSubscriptionPlan('openai', jwt({ chatgpt_plan_type: 'pro' }))).toBe('pro');
    expect(extractSubscriptionPlan('openai', jwt({ chatgpt_plan_type: '<script>' }))).toBeNull();
    expect(extractSubscriptionPlan('anthropic', jwt({ chatgpt_plan_type: 'plus' }))).toBeNull();
    expect(extractSubscriptionPlan('openai', 'not-a-token')).toBeNull();
  });
});
