// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../../app/(admin)/servicos/secretaria/secretary-chat', () => ({
  SecretaryChat: ({ voiceEnabled }: { voiceEnabled?: boolean }) => <div>
    <textarea aria-label="Mensagem" />
    {voiceEnabled && <button type="button" data-secretary-mic="" aria-label="Falar com a Secretária">Falar</button>}
  </div>,
}));
import { SecretaryDock } from '../../app/(admin)/servicos/secretaria/secretary-dock';

/** Voice for real use (03/10/2026): on the phone sheet with voice on, opening the Secretária focuses the microphone, so the
 * keyboard does not open over the conversation. The desktop panel (and voice off) keeps the text box focused. */
function viewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
let shell: HTMLDivElement;
beforeEach(() => { shell = document.createElement('div'); shell.className = 'admin-shell'; document.body.append(shell); });
afterEach(() => { cleanup(); shell.remove(); vi.unstubAllGlobals(); });

describe('focus when the Secretária opens', () => {
  it.each([[false, true, 'Falar com a Secretária'], [true, true, 'Mensagem'], [false, false, 'Mensagem']])('desktop=%s, voice=%s: %s takes the focus', async (desktop, voice, focused) => {
    viewport(desktop);
    const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled={voice} />);
    await user.click(screen.getByRole('button', { name: 'Abrir Secretária' }));
    expect(screen.getByLabelText(focused)).toHaveFocus();
  });
});
