// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActionSummary, parseActionSummary } from '../../app/(admin)/servicos/secretaria/action-summary';

/** Owner 06/10 (mobile): the action's text is laid out to be scanned; the words stay the preview's own and nothing else changes. */
afterEach(cleanup);
const reschedule = 'REMARCAR AGENDAMENTO\nIsabela Mattos\nManicure\nJuliana Takeda\nANTES: sáb, 17/10 às 10h–10h45\nDEPOIS: sex, 09/10 às 10h–10h45\nPreço mantido: R$ 35,00\nLista de espera: ninguém.';

describe('the action summary', () => {
  it('splits a rescheduling preview into title, subject, details, ANTES, DEPOIS and the remaining facts', () => {
    expect(parseActionSummary(reschedule)).toEqual({ title: 'REMARCAR AGENDAMENTO', heading: ['Isabela Mattos', 'Manicure', 'Juliana Takeda'],
      before: 'sáb, 17/10 às 10h–10h45', after: 'sex, 09/10 às 10h–10h45', notes: ['Preço mantido: R$ 35,00', 'Lista de espera: ninguém.'] });
  });
  it('reads a cancellation (ANTES only) and a block (no ANTES) without inventing a DEPOIS', () => {
    const cancel = parseActionSummary('CANCELAR AGENDAMENTO\nBianca\nSobrancelha\nRaíssa\nANTES: qua, 07/10 às 9h\nMotivo: cliente viajou\nLista de espera: ninguém.');
    expect(cancel).toMatchObject({ before: 'qua, 07/10 às 9h', notes: ['Motivo: cliente viajou', 'Lista de espera: ninguém.'] });
    expect(cancel?.after).toBeUndefined();
    const block = parseActionSummary('BLOQUEAR AGENDA\nOtávio\nqui, 08/10 das 14h às 16h\nNenhum agendamento nesse período.');
    expect(block).toEqual({ title: 'BLOQUEAR AGENDA', heading: ['Otávio'], notes: ['qui, 08/10 das 14h às 16h', 'Nenhum agendamento nesse período.'] });
  });
  it('shows ANTES muted and DEPOIS emphasized, with the same values, and every other line once', () => {
    render(<ActionSummary text={reschedule} />);
    expect(screen.getByText('REMARCAR AGENDAMENTO')).toBeVisible();
    expect(screen.getByText('Isabela Mattos')).toBeVisible();
    expect(screen.getByText('Manicure · Juliana Takeda')).toBeVisible();
    expect(screen.getByText('Antes').nextElementSibling).toHaveTextContent('sáb, 17/10 às 10h–10h45');
    expect(screen.getByText('Depois').nextElementSibling).toHaveTextContent('sex, 09/10 às 10h–10h45');
    expect(screen.getByText('sex, 09/10 às 10h–10h45')).toHaveClass('font-semibold');
    expect(screen.getByText('sáb, 17/10 às 10h–10h45')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('Preço mantido:').parentElement).toHaveTextContent('Preço mantido: R$ 35,00');
    expect(screen.getAllByText(/Lista de espera/)).toHaveLength(1);
  });
  it('highlights "antes → depois" inside a fact (price, duration) without changing it', () => {
    render(<ActionSummary text={'ALTERAR AGENDAMENTO\nLuz\nANTES: Corte com Otávio — sex, 09/10 às 10h\nDEPOIS: Corte e Barba com Otávio — sex, 09/10 às 10h\nDuração: 30 min → 60 min\nPreço: R$ 40,00 → R$ 70,00'} />);
    expect(screen.getByText('Duração:').parentElement).toHaveTextContent('Duração: 30 min para 60 min');
    expect(screen.getByText('R$ 70,00')).toHaveClass('font-semibold');
  });
  it('shows any other text exactly as it was (the question, a refusal, a one-line result)', () => {
    for (const text of ['Para qual dia e horário devo passar Sérgio Antunes?', 'Esta proposta expirou.\nEnvie uma mensagem.', 'Massagem\nR$ 80,00 → R$ 90,00 · 60 min', 'Informe data e horário exato.']) {
      expect(parseActionSummary(text), text).toBeUndefined();
      const { container, unmount } = render(<ActionSummary text={text} className="rounded-lg p-3" />);
      expect(container.querySelector('p')).toHaveClass('whitespace-pre-wrap', 'rounded-lg');
      expect(container.querySelector('p')!.textContent).toBe(text); unmount();
    }
  });
});
