// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../../app/(admin)/servicos/secretaria/secretary-chat', () => ({
  SecretaryChat: ({ onNavigate, active }: { onNavigate?: () => void; active?: boolean }) => <div data-active={String(active)}>
    <a href="/agenda?date=2026-10-01&appointment=appt-1" onClick={event => { event.preventDefault(); onNavigate?.(); }}>Abrir no formulário da agenda</a>
    <textarea aria-label="Mensagem" defaultValue="rascunho" />
  </div>,
}));
import { SecretaryDock } from '../../app/(admin)/servicos/secretaria/secretary-dock';

/** B6: following a link out of the Secretária closes the dock. On mobile the open dock makes the rest of the app
 * inert, so the agenda would be unusable behind it. The conversation itself stays mounted. */
function viewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
/** The menu item and the phone's tab open her with this event (there is no floating button). */
const openSecretary = () => act(() => { window.dispatchEvent(new Event('everflair:secretary-open')); });
let shell: HTMLDivElement;
beforeEach(() => { shell = document.createElement('div'); shell.className = 'admin-shell'; shell.id = 'main-content'; document.body.append(shell); });
afterEach(() => { cleanup(); shell.remove(); vi.unstubAllGlobals(); });

describe('dock and links', () => {
  it.each([false, true])('desktop=%s: the dock closes and the app is no longer inert; the conversation stays mounted', async desktop => {
    viewport(desktop);
    const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled={false} />);
    openSecretary();
    const dialog = screen.getByRole('dialog', { name: 'Secretária' });
    expect(dialog).toHaveAttribute('data-state', 'open');
    expect(Boolean(shell.inert)).toBe(!desktop);
    await user.click(screen.getByRole('link', { name: 'Abrir no formulário da agenda' }));
    // Closed: kept mounted (forceMount) but hidden.
    expect(dialog).toHaveAttribute('data-state', 'closed'); expect(dialog).toHaveClass('hidden');
    expect(Boolean(shell.inert)).toBe(false);
    // Still mounted (hidden): reopening shows the same conversation.
    expect(document.querySelector('[data-active="false"]')).not.toBeNull();
    openSecretary();
    expect(dialog).toHaveAttribute('data-state', 'open');
    expect(screen.getByLabelText('Mensagem')).toHaveValue('rascunho');
  });
});
