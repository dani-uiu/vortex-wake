/**
 * Vista de computadora (mínima): línea de tiempo de sesiones y entradas,
 * edición en un panel, equipo y "Generar bitácora".
 */

import { isUnclassified, slugify, type TeamConfig } from '@vortex-wake/shared';
import type { App } from '../app.ts';
import { download, generateNotebookFile } from '../notebook.ts';
import { dateLabel, h, icon, setChildren, toast } from '../ui.ts';
import { entryCard, syncBadge } from './common.ts';
import { renderEditor } from './editor.ts';

let selected: string | 'all' = 'all';
let onlyTodo = false;

export function renderDesktop(root: HTMLElement, app: App, go: (hash: string) => void): () => void {
  app.wide = true;
  void app.pull();
  const side = h('aside', { class: 'side' });
  const main = h('main', { class: 'desk-main' });
  const panel = h('section', { class: 'panel', hidden: true });
  const report = h('div', { class: 'report', 'data-testid': 'generate-report' });
  const numbering = h('select', { 'aria-label': 'Numeración' }, h('option', { value: 'section', text: 'Numeración por sección' }), h('option', { value: 'continuous', text: 'Numeración corrida' }));
  const genBtn = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'generate' }, icon('download'), 'Generar bitácora');
  const badge = h('div', {});
  let closeEditor: (() => void) | undefined;

  genBtn.addEventListener('click', async () => {
    genBtn.disabled = true;
    report.replaceChildren(h('p', { class: 'muted', text: 'Armando la bitácora…' }));
    try {
      await app.pull();
      const r = await generateNotebookFile(app, numbering.value as 'section' | 'continuous');
      download(r.bytes, r.fileName);
      setChildren(report,
        h('p', { class: 'ok-text', 'data-testid': 'generate-ok', text: `Listo: ${r.fileName} (${r.pages} diapositivas).` }),
        r.warnings.length > 0 ? h('ul', { class: 'warnings' }, r.warnings.map((w) => h('li', { text: w }))) : null,
      );
    } catch (e) {
      console.error(e);
      report.replaceChildren(h('p', { class: 'bad-text', 'data-testid': 'generate-error', text: `No se pudo generar: ${(e as Error).message}` }));
    } finally {
      genBtn.disabled = false;
    }
  });

  const openEntry = (id: string) => {
    closeEditor?.();
    panel.hidden = false;
    closeEditor = renderEditor(panel, app, id, () => {
      closeEditor?.();
      closeEditor = undefined;
      panel.hidden = true;
      panel.replaceChildren();
    });
  };

  root.replaceChildren(
    h(
      'div',
      { class: 'desk' },
      h(
        'header',
        { class: 'desk-top' },
        h('div', {}, h('div', { class: 'eyebrow', text: 'Vortex Wake' }), h('h1', { text: 'Bitácora del equipo' })),
        badge,
        h('div', { class: 'row wrap' }, numbering, genBtn, h('button', { class: 'btn secondary', type: 'button', onclick: () => openTeam() }, 'Equipo'), h('a', { class: 'btn secondary', href: '#/' }, 'Vista de celular')),
      ),
      report,
      h('div', { class: 'desk-body' }, side, main, panel),
    ),
  );

  function openTeam() {
    closeEditor?.();
    closeEditor = undefined;
    panel.hidden = false;
    renderTeamPanel(panel, app, () => {
      panel.hidden = true;
      panel.replaceChildren();
    });
  }

  const render = () => {
    badge.replaceChildren(syncBadge(app));
    const all = app.liveEntries();
    const dates = [...new Set([...app.sessions.keys(), ...all.map((e) => e.sessionDate)])].sort().reverse();
    const item = (key: string, label: string, sub: string) =>
      h('button', { class: `side-item ${selected === key ? 'on' : ''}`, type: 'button', onclick: () => ((selected = key), render()) }, h('span', { text: label }), h('span', { class: 'muted small', text: sub }));
    side.replaceChildren(
      h('h2', { class: 'section-title', text: 'Sesiones' }),
      item('all', 'Todas', `${all.length} entradas`),
      ...dates.map((d) => {
        const n = all.filter((e) => e.sessionDate === d).length;
        const att = app.sessions.get(d)?.attendance.length ?? 0;
        return item(d, dateLabel(d), `${n} entradas · ${att} presentes`);
      }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: onlyTodo, onchange: (ev: Event) => ((onlyTodo = (ev.target as HTMLInputElement).checked), render()) }), 'Solo sin clasificar'),
    );
    const shown = all.filter((e) => (selected === 'all' || e.sessionDate === selected) && (!onlyTodo || isUnclassified(e)));
    const byDate = new Map<string, typeof shown>();
    for (const e of shown) byDate.set(e.sessionDate, [...(byDate.get(e.sessionDate) ?? []), e]);
    main.replaceChildren(
      ...(shown.length === 0 ? [h('p', { class: 'muted empty', text: 'No hay entradas.' })] : []),
      ...[...byDate.entries()].map(([d, list]) => {
        const s = app.sessions.get(d);
        const present = (s?.attendance ?? []).map((a) => app.memberName(a.memberId)).join(', ');
        const c = s?.closing;
        return h(
          'section',
          { class: 'day' },
          h('h2', { class: 'day-title', text: dateLabel(d) }),
          present ? h('p', { class: 'muted small', text: `Presentes: ${present}` }) : null,
          c && (c.whatWeDid || c.whatFailed || c.whatsNext)
            ? h('div', { class: 'closing' }, c.whatWeDid ? h('p', {}, h('b', { text: 'Qué hicimos: ' }), c.whatWeDid) : null, c.whatFailed ? h('p', {}, h('b', { text: 'Qué falló: ' }), c.whatFailed) : null, c.whatsNext ? h('p', {}, h('b', { text: 'Qué sigue: ' }), c.whatsNext) : null)
            : null,
          h('div', { class: 'grid' }, list.map((e) => entryCard(app, e, openEntry))),
        );
      }),
    );
  };
  render();
  const unsub = app.subscribe(render);
  return () => {
    unsub();
    closeEditor?.();
    app.wide = false;
    void go;
  };
}

function renderTeamPanel(panel: HTMLElement, app: App, close: () => void): void {
  const team = app.team;
  if (!team) return;
  const draft: TeamConfig = structuredClone(team);
  const name = h('input', { type: 'text', placeholder: 'Nombre y apellido' });
  const robotsBox = h('div', { class: 'stack' });
  const renderRobots = () =>
    robotsBox.replaceChildren(
      ...draft.robots.map((r) => {
        const n = h('input', { type: 'text', value: r.name });
        const subs = h('input', { type: 'text', value: r.subsystems.join(', ') });
        n.addEventListener('input', () => (r.name = n.value));
        subs.addEventListener('input', () => (r.subsystems = subs.value.split(',').map((s) => s.trim()).filter((s) => s)));
        return h('div', { class: 'robot' }, h('label', { class: 'field-label', text: 'Robot' }), n, h('label', { class: 'field-label', text: 'Subsistemas (separados por coma)' }), subs);
      }),
    );
  renderRobots();
  panel.replaceChildren(
    h('div', { class: 'topbar-row' }, h('h2', { text: 'Equipo' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: close }, icon('x'))),
    h('p', { class: 'muted small', text: 'Se guarda en data/team.json de la laptop. También se puede editar ese archivo directamente.' }),
    h('h3', { text: 'Integrantes' }),
    h('ul', { class: 'members' }, draft.members.map((m) => h('li', { text: m.name }))),
    h(
      'form',
      {
        class: 'row',
        onsubmit: async (ev: Event) => {
          ev.preventDefault();
          if (!name.value.trim()) return;
          await app.addMember(name.value);
          toast('Integrante agregado');
          renderTeamPanel(panel, app, close);
        },
      },
      name,
      h('button', { class: 'btn', type: 'submit' }, 'Agregar'),
    ),
    h('h3', { text: 'Robots' }),
    robotsBox,
    h(
      'div',
      { class: 'row wrap' },
      h('button', { class: 'chip-btn', type: 'button', onclick: () => (draft.robots.push({ id: `robot-${slugify(String(draft.robots.length + 1))}-${Date.now() % 10000}`, name: 'Robot nuevo', subsystems: [] }), renderRobots()) }, icon('plus'), 'Robot'),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            try {
              const current = app.team ?? draft;
              app.team = await app.api.putTeam({ ...current, robots: draft.robots });
              await app.db.setTeam(app.team);
              toast('Equipo guardado');
              app.emit();
              close();
            } catch (e) {
              toast(`No se pudo guardar (¿hay conexión con la laptop?): ${(e as Error).message}`);
            }
          },
        },
        'Guardar robots',
      ),
    ),
  );
}
