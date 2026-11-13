/**
 * Vista de computadora: línea de tiempo de sesiones y entradas, edición en un
 * panel (con anterior/siguiente y teclado: J/K para moverse, Esc para
 * cerrar), equipo y "Generar bitácora". Mismo lenguaje que la captura del
 * celular, adaptado a pantalla ancha.
 */

import { CONTROLLER_SLOTS, PORT_SLOTS, hasClosing, isUnclassified, saveMapVersion, slugify, type DeviceMapKind, type Entry, type TeamConfig } from '@vortex-wake/shared';
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
  const side = h('aside', { class: 'side', 'aria-label': 'Sesiones' });
  const main = h('main', { class: 'desk-main' });
  const panel = h('section', { class: 'panel', hidden: true, 'aria-label': 'Entrada' });
  const report = h('div', { class: 'report', 'data-testid': 'generate-report', role: 'status' });
  const numbering = h('select', { class: 'compact', 'aria-label': 'Numeración' }, h('option', { value: 'section', text: 'Numeración por sección' }), h('option', { value: 'continuous', text: 'Numeración corrida' }));
  const genBtn = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'generate' }, icon('download'), 'Generar bitácora');
  const badge = h('div', { class: 'desk-sync' });
  let closeEditor: (() => void) | undefined;
  /** Entrada abierta en el panel y su lugar en la lista cuando se abrió. */
  let openId: string | undefined;
  let openIndex = 0;

  genBtn.addEventListener('click', async () => {
    genBtn.disabled = true;
    report.replaceChildren(h('p', { class: 'muted', text: 'Armando la bitácora…' }));
    try {
      await app.pull();
      const r = await generateNotebookFile(app, numbering.value as 'section' | 'continuous');
      download(r.bytes, r.fileName);
      setChildren(
        report,
        h('p', { class: 'ok-text', 'data-testid': 'generate-ok', text: `Listo: ${r.fileName} (${r.pages} diapositivas).` }),
        r.warnings.length > 0 ? h('ul', { class: 'warnings' }, r.warnings.map((w) => h('li', { text: w }))) : null,
        h('button', { class: 'icon-btn report-close', type: 'button', 'aria-label': 'Cerrar el aviso', onclick: () => report.replaceChildren() }, icon('x')),
      );
    } catch (e) {
      console.error(e);
      setChildren(
        report,
        h('p', { class: 'bad-text', 'data-testid': 'generate-error', text: `No se pudo generar: ${(e as Error).message}` }),
        h('button', { class: 'icon-btn report-close', type: 'button', 'aria-label': 'Cerrar el aviso', onclick: () => report.replaceChildren() }, icon('x')),
      );
    } finally {
      genBtn.disabled = false;
    }
  });

  /** Entradas en el orden en que se ven (para anterior/siguiente). */
  const shownEntries = (): Entry[] => app.liveEntries().filter((e) => (selected === 'all' || e.sessionDate === selected) && (!onlyTodo || isUnclassified(e)));

  const closePanel = () => {
    closeEditor?.();
    closeEditor = undefined;
    openId = undefined;
    panel.hidden = true;
    panel.replaceChildren();
    render();
  };

  /** Pasa a la entrada de al lado. Si la abierta ya no está en la lista (se clasificó con el filtro puesto), se usa su lugar. */
  const step = (dir: 1 | -1) => {
    const order = shownEntries();
    if (order.length === 0) return;
    const i = openId ? order.findIndex((e) => e.id === openId) : -1;
    const at = i >= 0 ? i + dir : dir === 1 ? openIndex : openIndex - 1;
    const target = order[Math.min(Math.max(at, 0), order.length - 1)];
    if (target && target.id !== openId) openEntry(target.id);
  };

  const openEntry = (id: string) => {
    closeEditor?.();
    const order = shownEntries();
    const i = order.findIndex((e) => e.id === id);
    openId = id;
    openIndex = Math.max(i, 0);
    panel.hidden = false;
    closeEditor = renderEditor(panel, app, id, closePanel, {
      desk: true,
      nav:
        i >= 0
          ? {
              ...(i > 0 ? { prev: () => step(-1) } : {}),
              ...(i < order.length - 1 ? { next: () => step(1) } : {}),
              label: `${i + 1} de ${order.length}`,
            }
          : {},
    });
    panel.scrollTop = 0;
    render();
    main.querySelector(`[data-entry="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  // Teclado: J/K (o flechas con Alt) para moverse, Esc para cerrar. Nunca mientras se escribe.
  const onKey = (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || document.querySelector('dialog[open]')) return;
    const t = ev.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (ev.key === 'Escape' && !panel.hidden) {
      if (typing) (t as HTMLElement).blur();
      else closePanel();
      return;
    }
    if (typing || ev.altKey !== /^Arrow/.test(ev.key)) return;
    const next = ev.key === 'j' || ev.key === 'J' || ev.key === 'ArrowDown';
    const prev = ev.key === 'k' || ev.key === 'K' || ev.key === 'ArrowUp';
    if (!next && !prev) return;
    ev.preventDefault();
    if (!openId) {
      const first = shownEntries()[0];
      if (first) openEntry(first.id);
    } else step(next ? 1 : -1);
  };
  document.addEventListener('keydown', onKey);

  const filterBar = h('div', { class: 'desk-filters' });

  root.replaceChildren(
    h(
      'div',
      { class: 'desk' },
      h(
        'header',
        { class: 'desk-top' },
        h('div', { class: 'desk-title' }, h('div', { class: 'eyebrow', text: 'Vortex Wake' }), h('h1', { text: 'Bitácora del equipo' })),
        badge,
        h(
          'div',
          { class: 'desk-actions' },
          h('div', { class: 'gen-group' }, numbering, genBtn),
          h(
            'nav',
            { class: 'desk-links', 'aria-label': 'Más' },
            h('button', { class: 'link-btn', type: 'button', 'data-testid': 'open-team', onclick: () => openTeam() }, icon('team', 'icon sm'), 'Equipo'),
            // En la versión hospedada el QR es parte de la app; con el servidor local, su página /qr (solo en la laptop).
            h('a', { class: 'link-btn', href: app.hosted ? '#/qr' : '/qr', 'data-testid': 'open-qr' }, icon('qr', 'icon sm'), 'QR del taller'),
            h('a', { class: 'link-btn', href: '#/' }, icon('phone', 'icon sm'), 'Vista de celular'),
          ),
        ),
      ),
      report,
      h('div', { class: 'desk-body' }, side, h('div', { class: 'desk-center' }, filterBar, main), panel),
    ),
  );

  function openTeam() {
    closeEditor?.();
    closeEditor = undefined;
    openId = undefined;
    panel.hidden = false;
    renderTeamPanel(panel, app, () => {
      panel.hidden = true;
      panel.replaceChildren();
      render();
    });
    render();
  }

  function render() {
    badge.replaceChildren(syncBadge(app, true));
    const all = app.liveEntries();
    const dates = [...new Set([...app.sessions.keys(), ...all.map((e) => e.sessionDate)])].sort().reverse();
    const todoBadge = (n: number) => (n > 0 ? h('span', { class: 'count-todo', title: `${n} sin clasificar`, text: String(n) }) : null);
    const item = (key: string, label: string, sub: string, todo: number) =>
      h(
        'button',
        { class: `side-item ${selected === key ? 'on' : ''}`, type: 'button', 'aria-current': selected === key ? 'true' : undefined, onclick: () => ((selected = key), render()) },
        h('span', { class: 'side-text' }, h('span', { class: 'side-label', text: label }), h('span', { class: 'muted small', text: sub })),
        todoBadge(todo),
      );
    side.replaceChildren(
      h('h2', { class: 'section-title', text: 'Sesiones' }),
      item('all', 'Todas', `${all.length} entradas`, all.filter(isUnclassified).length),
      ...dates.map((d) => {
        const list = all.filter((e) => e.sessionDate === d);
        const att = app.sessions.get(d)?.attendance.length ?? 0;
        const noClosing = (list.length > 0 || att > 0) && d < app.today && !hasClosing(app.sessions.get(d)?.closing);
        return item(d, dateLabel(d), `${list.length} entradas · ${att} presentes${noClosing ? ' · sin cierre' : ''}`, list.filter(isUnclassified).length);
      }),
    );

    const inScope = all.filter((e) => selected === 'all' || e.sessionDate === selected);
    const todoCount = inScope.filter(isUnclassified).length;
    const seg = (on: boolean, label: string, n: number, testid: string, set: boolean) =>
      h('button', { class: `seg-btn ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), 'data-testid': testid, onclick: () => ((onlyTodo = set), render()) }, label, h('span', { class: 'n', text: String(n) }));
    setChildren(
      filterBar,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtro' }, seg(!onlyTodo, 'Todas', inScope.length, 'desk-filter-all', false), seg(onlyTodo, 'Sin clasificar', todoCount, 'desk-filter-todo', true)),
      h('span', { class: 'muted small kbd-hint', text: 'J / K: siguiente y anterior · Esc: cerrar' }),
    );

    const shown = shownEntries();
    const byDate = new Map<string, Entry[]>();
    for (const e of shown) byDate.set(e.sessionDate, [...(byDate.get(e.sessionDate) ?? []), e]);
    // Una sesión elegida sin entradas (solo asistencia) también se muestra: su cierre puede faltar.
    if (selected !== 'all' && !onlyTodo && !byDate.has(selected) && app.sessions.has(selected)) byDate.set(selected, []);
    main.replaceChildren(
      ...(byDate.size === 0 ? [h('p', { class: 'muted empty', text: onlyTodo ? 'Todo está clasificado.' : 'No hay entradas.' })] : []),
      ...[...byDate.entries()].map(([d, list]) => {
        const s = app.sessions.get(d);
        const present = (s?.attendance ?? []).map((a) => app.memberName(a.memberId)).join(', ');
        const c = s?.closing;
        const todo = list.filter(isUnclassified).length;
        return h(
          'section',
          { class: 'day' },
          h(
            'div',
            { class: 'day-head' },
            h('h2', { class: 'day-title', text: dateLabel(d) }),
            h('span', { class: 'muted small', text: `${list.length} entradas` }),
            todo > 0 && !onlyTodo ? h('span', { class: 'tag todo', text: `${todo} sin clasificar` }) : null,
            d < app.today && !hasClosing(c) ? h('a', { class: 'tag todo', href: `#/cierre/${d}?desde=escritorio`, 'data-testid': 'desk-no-closing', title: 'Llenar el cierre de esta sesión', text: 'Sin cierre' }) : null,
          ),
          present ? h('p', { class: 'muted small', text: `Presentes: ${present}` }) : null,
          c && (c.whatWeDid || c.whatFailed || c.whatsNext)
            ? h('div', { class: 'closing' }, c.whatWeDid ? h('p', {}, h('b', { text: 'Qué hicimos: ' }), c.whatWeDid) : null, c.whatFailed ? h('p', {}, h('b', { text: 'Qué falló: ' }), c.whatFailed) : null, c.whatsNext ? h('p', {}, h('b', { text: 'Qué sigue: ' }), c.whatsNext) : null)
            : null,
          h(
            'div',
            { class: 'grid' },
            list.map((e) => {
              const card = entryCard(app, e, openEntry, 'desk');
              if (e.id === openId) {
                card.classList.add('selected');
                card.setAttribute('aria-current', 'true');
              }
              return card;
            }),
          ),
        );
      }),
    );
  }
  render();
  const unsub = app.subscribe(render);
  return () => {
    unsub();
    document.removeEventListener('keydown', onKey);
    closeEditor?.();
    app.wide = false;
    void go;
  };
}

/** La vista de computadora y el QR piden la clave de edición. */
export function renderNeedsEditKey(root: HTMLElement): void {
  root.replaceChildren(
    h(
      'div',
      { class: 'center', 'data-testid': 'needs-edit-key' },
      h('h1', { text: 'Vista de computadora' }),
      h('p', { text: 'Esta parte necesita la clave de edición. La clave de este dispositivo es la del QR del taller, que sirve para capturar.' }),
      h('p', { class: 'muted', text: 'Quienes arman la bitácora tienen su propio enlace con la clave de edición. Ábrelo en esta computadora.' }),
      h('a', { class: 'btn secondary', href: '#/' }, 'Volver a la captura'),
    ),
  );
}

/** Página del QR (versión hospedada, clave de edición): el enlace de captura para imprimir o mostrar en pantalla. */
export function renderQr(root: HTMLElement, app: App): () => void {
  const box = h('div', { class: 'qr-box', 'data-testid': 'qr' }, h('p', { class: 'muted', text: 'Cargando el QR…' }));
  root.replaceChildren(
    h(
      'div',
      { class: 'qr-page' },
      h('div', { class: 'no-print row wrap' }, h('a', { class: 'btn secondary', href: '#/escritorio' }, 'Volver a la vista de computadora'), h('button', { class: 'btn secondary', type: 'button', onclick: () => print() }, 'Imprimir')),
      h('h1', { text: 'Escanea para capturar' }),
      box,
      h('p', { class: 'muted', text: 'Con este QR cualquiera del equipo puede capturar y ver las entradas desde su celular. No lo publiques en redes ni fuera del taller.' }),
    ),
  );
  let alive = true;
  const load = async () => {
    try {
      const r = await app.api.qr();
      if (!alive) return;
      const img = h('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`, alt: 'Código QR del enlace de captura', 'data-testid': 'qr-image' });
      const link = h('code', { class: 'qr-link', text: r.captureUrl });
      box.replaceChildren(
        h('div', { class: 'qr-code' }, img),
        link,
        h('button', { class: 'btn secondary no-print', type: 'button', onclick: () => void navigator.clipboard?.writeText(r.captureUrl).then(() => toast('Enlace copiado'), () => toast('No se pudo copiar')) }, 'Copiar enlace'),
      );
    } catch (e) {
      if (!alive) return;
      const status = (e as { status?: number }).status;
      box.replaceChildren(
        h('p', {
          class: 'bad-text',
          text:
            status === 404
              ? 'Con el servidor local, el QR está en http://localhost:4321/qr (ábrelo en la laptop del taller).'
              : `No se pudo cargar el QR: ${(e as Error).message}`,
        }),
      );
    }
  };
  void load();
  return () => {
    alive = false;
  };
}

/**
 * Mapa de puertos del Brain o del control de un robot: un campo por puerto
 * (o botón). Al guardar queda una versión con la fecha de hoy; si ya había una
 * de otro día, esa se conserva (historial) y sale como su propia página.
 */
function renderMapPanel(panel: HTMLElement, app: App, robotId: string, kind: DeviceMapKind, back: () => void): void {
  const robot = app.team?.robots.find((r) => r.id === robotId);
  if (!robot) return back();
  const history = robot[kind] ?? [];
  const current = history[history.length - 1]?.slots ?? {};
  const slots: [string, string][] = kind === 'ports' ? PORT_SLOTS.map((s) => [s, /\d/.test(s) ? `Puerto ${s}` : `Puerto ${s} (3 hilos)`]) : CONTROLLER_SLOTS;
  const values: Record<string, string> = { ...current };
  const title = `${kind === 'ports' ? 'Mapa de puertos del Brain' : 'Mapa del control'} · ${robot.name}`;
  const form = h(
    'div',
    { class: 'map-form', 'data-testid': `map-form-${kind}` },
    slots.map(([slot, label]) => {
      const id = `slot-${kind}-${slot}`;
      const input = h('input', { type: 'text', id, value: values[slot] ?? '', placeholder: kind === 'ports' ? 'Motor, sensor…' : 'Qué hace', 'data-slot': slot, maxlength: '120' });
      input.addEventListener('input', () => (values[slot] = input.value));
      return h('div', { class: 'form-row' }, h('label', { class: 'form-label', for: id, text: label }), input);
    }),
  );
  const old = history.slice(0, -1).reverse();
  panel.replaceChildren(
    h('header', { class: 'topbar editor-top' }, h('div', { class: 'topbar-row' }, h('button', { class: 'back', type: 'button', onclick: back }, icon('back'), 'Equipo'), h('h2', { text: title }))),
    h(
      'div',
      { class: 'editor simple is-desk team-panel' },
      h('p', { class: 'muted small', text: history.length > 0 ? `Versión vigente del ${dateLabel(history[history.length - 1]?.date ?? '')}. Si cambias algo, se guarda como versión de hoy y la anterior queda con su fecha en la bitácora.` : 'Escribe qué va en cada lugar; los vacíos no salen. Cada versión sale en la bitácora (Cableado) con su fecha.' }),
      form,
      h(
        'div',
        { class: 'row wrap' },
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            'data-testid': 'map-save',
            onclick: async () => {
              const team = app.team;
              if (!team) return;
              const robots = team.robots.map((r) => (r.id === robotId ? { ...r, [kind]: saveMapVersion(r[kind], values, app.today, new Date().toISOString(), app.me) } : r));
              try {
                app.team = await app.api.putTeam({ ...team, robots });
                await app.db.setTeam(app.team);
                toast('Mapa guardado');
                app.emit();
                back();
              } catch (e) {
                toast(`No se pudo guardar (¿hay conexión?): ${(e as Error).message}`);
              }
            },
          },
          'Guardar mapa',
        ),
        h('button', { class: 'btn secondary', type: 'button', onclick: back }, 'Cancelar'),
      ),
      old.length > 0 ? h('h2', { class: 'section-title', text: 'Versiones anteriores' }) : null,
      ...old.map((v) =>
        h(
          'details',
          { class: 'more is-desk map-old' },
          h('summary', {}, h('span', { class: 'sum-text' }, h('span', { class: 'more-title', text: dateLabel(v.date) }), h('span', { class: 'sum-sub', text: `${Object.keys(v.slots).length} lugar(es)${v.by ? ` · ${app.memberName(v.by)}` : ''}` }))),
          h('ul', { class: 'map-list' }, slots.filter(([s]) => v.slots[s]).map(([s, label]) => h('li', {}, h('b', { text: `${label}: ` }), v.slots[s] ?? ''))),
        ),
      ),
    ),
  );
}

function renderTeamPanel(panel: HTMLElement, app: App, close: () => void): void {
  const team = app.team;
  if (!team) return;
  const draft: TeamConfig = structuredClone(team);
  const name = h('input', { type: 'text', placeholder: 'Nombre y apellido', 'aria-label': 'Nombre del integrante nuevo' });
  const robotsBox = h('div', { class: 'stack-tight' });
  const renderRobots = () =>
    robotsBox.replaceChildren(
      ...draft.robots.map((r, i) => {
        const nId = `robot-name-${i}`;
        const sId = `robot-subs-${i}`;
        const n = h('input', { type: 'text', id: nId, value: r.name });
        const subs = h('input', { type: 'text', id: sId, value: r.subsystems.join(', ') });
        n.addEventListener('input', () => (r.name = n.value));
        subs.addEventListener('input', () => (r.subsystems = subs.value.split(',').map((s) => s.trim()).filter((s) => s)));
        const saved = team.robots.some((x) => x.id === r.id);
        const mapBtn = (kind: DeviceMapKind, label: string) => {
          const n = r[kind]?.length ?? 0;
          return h(
            'button',
            { class: 'chip-btn', type: 'button', 'data-testid': `open-map-${kind}`, 'data-robot': r.id, onclick: () => renderMapPanel(panel, app, r.id, kind, () => renderTeamPanel(panel, app, close)) },
            icon(kind === 'ports' ? 'table' : 'flag'),
            n > 0 ? `${label} (${n === 1 ? '1 versión' : `${n} versiones`})` : label,
          );
        };
        return h(
          'div',
          { class: 'robot' },
          h('div', { class: 'form-row' }, h('label', { class: 'form-label', for: nId, text: 'Robot' }), n),
          h('div', { class: 'form-row' }, h('label', { class: 'form-label', for: sId, text: 'Subsistemas' }), h('div', {}, subs, h('p', { class: 'muted small', text: 'Separados por coma' }))),
          saved ? h('div', { class: 'row wrap' }, mapBtn('ports', 'Mapa de puertos'), mapBtn('controller', 'Mapa del control')) : h('p', { class: 'muted small', text: 'Guarda los robots para llenar sus mapas.' }),
        );
      }),
    );
  renderRobots();
  panel.replaceChildren(
    h(
      'header',
      { class: 'topbar editor-top' },
      h('div', { class: 'topbar-row' }, h('h2', { text: 'Equipo' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', 'data-testid': 'team-close', onclick: close }, icon('x'))),
    ),
    h(
      'div',
      { class: 'editor simple is-desk team-panel' },
      h('p', {
        class: 'muted small',
        text: app.hosted
          ? 'Se guarda en la nube. Para subir el equipo de data/team.json, usa "npm run nube:subir-datos" en la laptop.'
          : 'Se guarda en data/team.json de la laptop. También se puede editar ese archivo directamente.',
      }),
      h('h2', { class: 'section-title', text: 'Integrantes' }),
      h(
        'ul',
        { class: 'sum-list members' },
        draft.members.map((m) => h('li', { class: 'member-row' }, h('span', { class: 'sum-value', text: m.name }), m.roles && m.roles.length > 0 ? h('span', { class: 'sum-sub', text: m.roles.join(', ') }) : null)),
      ),
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
      h('h2', { class: 'section-title', text: 'Robots' }),
      robotsBox,
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'add-btn inline', type: 'button', onclick: () => (draft.robots.push({ id: `robot-${slugify(String(draft.robots.length + 1))}-${Date.now() % 10000}`, name: 'Robot nuevo', subsystems: [] }), renderRobots()) }, icon('plus'), 'Robot'),
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
    ),
  );
}
