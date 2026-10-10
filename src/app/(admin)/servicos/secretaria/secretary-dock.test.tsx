// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const flags = vi.hoisted(() => ({ decision: false, hold: false }));
vi.mock('./secretary-chat', () => ({
  SecretaryChat: ({ active }: { active?: boolean }) => <section data-active={String(active)} data-sec-decision={flags.decision ? 'true' : undefined} data-sec-hold={flags.hold ? 'true' : undefined}>
    <textarea aria-label="Mensagem" />
  </section>,
}));
import { SecretaryDock, SecretaryEntry } from './secretary-dock';

/** Prototype v6 (owner, 08/10/2026): no floating button (the menu item and the phone's tab open her with the event); from
 * 1216 px she sits beside the content, which shrinks; from 1024 px on top of it behind a veil; below, full screen. Only the
 * presentation: the conversation itself is the chat's. */
type Width = 'side' | 'over' | 'full';
function viewport(width: Width) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('1216') ? width === 'side' : query.includes('1024') ? width !== 'full' : false,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
const openSecretary = () => act(() => { window.dispatchEvent(new Event('everflair:secretary-open')); });
let shell: HTMLDivElement, opener: HTMLButtonElement, field: HTMLInputElement;
beforeEach(() => {
  flags.decision = false; flags.hold = false;
  shell = document.createElement('div'); shell.className = 'admin-shell';
  // What the coordinator's menu item does: it dispatches the event.
  opener = document.createElement('button'); opener.textContent = 'Secretária'; opener.addEventListener('click', () => window.dispatchEvent(new Event('everflair:secretary-open')));
  field = document.createElement('input'); field.setAttribute('aria-label', 'Buscar na agenda');
  const main = document.createElement('main'); main.id = 'main-content'; main.tabIndex = -1; main.append(opener, field);
  shell.append(main); document.body.append(shell);
});
afterEach(() => { cleanup(); shell.remove(); vi.unstubAllGlobals(); });

describe('opening and closing', () => {
  it('there is no floating button: the menu event opens her with the focus in the message box, and the close button gives the focus back', async () => {
    viewport('side'); const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled={false} />);
    expect(screen.queryByRole('button', { name: 'Abrir Secretária' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Secretária' });
    expect(dialog).toHaveAttribute('data-state', 'open'); expect(dialog).toHaveAccessibleDescription('Você pede. Revisa. Confirma.');
    expect(screen.getByLabelText('Mensagem')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Fechar Secretária' }));
    expect(dialog).toHaveAttribute('data-state', 'closed'); expect(dialog).toHaveClass('hidden');
    expect(opener).toHaveFocus();
    // Reopening shows the same (still mounted) conversation.
    await user.click(opener);
    expect(dialog).toHaveAttribute('data-state', 'open'); expect(screen.getByLabelText('Mensagem')).toHaveFocus();
  });
  it('a request made before the panel loaded (it loads after the page) opens her once she mounts', () => {
    viewport('side'); document.documentElement.setAttribute('data-secretary-requested', '');
    render(<SecretaryDock voiceEnabled={false} />);
    expect(screen.getByRole('dialog', { name: 'Secretária' })).toHaveAttribute('data-state', 'open');
    expect(document.documentElement).not.toHaveAttribute('data-secretary-requested');
  });
  it('the page /servicos/secretaria keeps its "Abrir Secretária" button, which opens the same panel', async () => {
    viewport('full'); const user = userEvent.setup();
    render(<><SecretaryDock voiceEnabled={false} /><SecretaryEntry /></>);
    await user.click(screen.getByRole('button', { name: 'Abrir Secretária' }));
    expect(screen.getByRole('dialog', { name: 'Secretária' })).toHaveAttribute('data-state', 'open');
  });
  it('without the opener any more, the focus goes back to the content', async () => {
    viewport('side'); const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled={false} />);
    await user.click(opener); opener.remove();
    await user.click(screen.getByRole('button', { name: 'Fechar Secretária' }));
    expect(document.getElementById('main-content')).toHaveFocus();
  });
});

describe('beside the content (1216 px or wider)', () => {
  it('marks the root so the content gives her its width; nothing becomes inert and she is not modal', () => {
    viewport('side'); render(<SecretaryDock voiceEnabled={false} />); openSecretary();
    expect(document.documentElement).toHaveAttribute('data-secretary-open', 'side');
    expect(Boolean(document.getElementById('main-content')!.inert)).toBe(false);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
    expect(document.querySelector('.sec-scrim')).toBeNull();
    act(() => { screen.getByRole('button', { name: 'Fechar Secretária' }).click(); });
    expect(document.documentElement).not.toHaveAttribute('data-secretary-open');
  });
  it('Esc closes her only with the focus in the panel (an Esc used on the screen is the screen\'s)', async () => {
    viewport('side'); const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled={false} />); openSecretary();
    const dialog = screen.getByRole('dialog');
    field.focus(); await user.keyboard('{Escape}');
    expect(dialog).toHaveAttribute('data-state', 'open');
    screen.getByLabelText('Mensagem').focus(); await user.keyboard('{Escape}');
    expect(dialog).toHaveAttribute('data-state', 'closed');
  });
  it('an Esc already handled by something else (a dialog of the page) does not close her', () => {
    viewport('side'); render(<SecretaryDock voiceEnabled={false} />); openSecretary();
    const box = screen.getByLabelText('Mensagem'); box.focus();
    box.addEventListener('keydown', event => event.preventDefault(), { once: true });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'open');
  });
});

describe('on top of the content (1024 to 1215 px)', () => {
  it('opens behind a veil with the rest of the app inert; a click on the veil or Esc closes her', async () => {
    viewport('over'); const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled={false} />); openSecretary();
    const dialog = screen.getByRole('dialog');
    expect(document.documentElement).toHaveAttribute('data-secretary-open', 'over');
    expect(dialog).toHaveAttribute('aria-modal', 'true'); expect(Boolean(document.getElementById('main-content')!.inert)).toBe(true);
    await user.click(document.querySelector('.sec-scrim')!);
    expect(dialog).toHaveAttribute('data-state', 'closed'); expect(Boolean(document.getElementById('main-content')!.inert)).toBe(false);
    expect(document.querySelector('.sec-scrim')).toBeNull();
    openSecretary(); document.body.focus(); await user.keyboard('{Escape}');
    expect(dialog).toHaveAttribute('data-state', 'closed');
  });
  it('while recording or counting down a spoken "confirma", neither the veil nor Esc closes her', async () => {
    viewport('over'); flags.hold = true; const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled />); openSecretary();
    const dialog = screen.getByRole('dialog');
    await user.click(document.querySelector('.sec-scrim')!);
    await user.keyboard('{Escape}');
    expect(dialog).toHaveAttribute('data-state', 'open');
  });
});

describe('the decision window', () => {
  it('while it is open, Esc is its own: the panel stays', async () => {
    viewport('full'); flags.decision = true; const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled={false} />); openSecretary();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'open');
  });
});

describe('phone and tablet (below 1024 px)', () => {
  it('full screen and modal, with the rest of the app inert; Esc closes her', async () => {
    viewport('full'); const user = userEvent.setup();
    render(<SecretaryDock voiceEnabled={false} />); openSecretary();
    expect(document.documentElement).toHaveAttribute('data-secretary-open', 'full');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true'); expect(Boolean(document.getElementById('main-content')!.inert)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'closed');
  });
});
