import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { KebabMenu, DeleteRuleModal, RemoveProviderModal } from '../../src/components/LimitModals';
import type { NotificationRule } from '../../src/services/api';

vi.mock('../../src/components/LimitRuleTable.js', () => ({
  formatThreshold: (r: any) =>
    r.metric_type === 'cost' ? `$${Number(r.threshold).toFixed(2)}` : `${r.threshold} tokens`,
  PERIOD_LABELS: { hour: 'Per hour', day: 'Per day', week: 'Per week', month: 'Per month' } as Record<string, string>,
}));

const makeRule = (overrides: Partial<NotificationRule> = {}): NotificationRule => ({
  id: 'rule-1',
  agent_name: 'agent',
  metric_type: 'tokens',
  threshold: 1000,
  period: 'day',
  action: 'notify',
  is_active: true,
  trigger_count: 0,
  created_at: '2026-01-01',
  ...overrides,
});

describe('KebabMenu', () => {
  it('renders menu with role="menu" and role="menuitem"', () => {
    const rule = makeRule();
    render(() => (
      <KebabMenu
        openMenuId="rule-1"
        menuPos={{ top: 100, left: 200 }}
        rules={[rule]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    ));
    expect(screen.getByRole('menu')).toBeTruthy();
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBe(2);
  });

  it('renders SVGs with aria-hidden', () => {
    const rule = makeRule();
    render(() => (
      <KebabMenu
        openMenuId="rule-1"
        menuPos={{ top: 0, left: 0 }}
        rules={[rule]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    ));
    const svgs = document.body.querySelectorAll('svg');
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('does not render when openMenuId is null', () => {
    render(() => (
      <KebabMenu
        openMenuId={null}
        menuPos={{ top: 0, left: 0 }}
        rules={[makeRule()]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    ));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('DeleteRuleModal', () => {
  it('renders dialog with aria-labelledby', () => {
    const rule = makeRule();
    render(() => (
      <DeleteRuleModal
        target={rule}
        confirmed={false}
        deleting={false}
        onConfirmChange={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />
    ));
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(dialog!.getAttribute('aria-labelledby')).toBe('delete-rule-modal-title');
    expect(document.getElementById('delete-rule-modal-title')).not.toBeNull();
  });

  it('shows rule details in description', () => {
    const rule = makeRule({ metric_type: 'cost', threshold: 10 });
    render(() => (
      <DeleteRuleModal
        target={rule}
        confirmed={false}
        deleting={false}
        onConfirmChange={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />
    ));
    expect(screen.getByRole('heading', { name: 'Delete rule' })).toBeDefined();
  });

  it('does not render when target is null', () => {
    render(() => (
      <DeleteRuleModal
        target={null}
        confirmed={false}
        deleting={false}
        onConfirmChange={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />
    ));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('RemoveProviderModal', () => {
  it('renders dialog with aria-labelledby', () => {
    render(() => (
      <RemoveProviderModal
        open={true}
        hasEmailRules={false}
        removing={false}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-labelledby')).toBe('remove-provider-modal-title');
    expect(document.getElementById('remove-provider-modal-title')).not.toBeNull();
  });

  it('does not render when closed', () => {
    render(() => (
      <RemoveProviderModal
        open={false}
        hasEmailRules={false}
        removing={false}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
