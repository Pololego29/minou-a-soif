// Tableau de bord Minou a soif : lit les chiffres agrégés par les fonctions du serveur (voir supabase/schema.sql).
// Aucune bibliothèque : graphiques en SVG. `?demo` affiche des joueurs simulés (demo.json).
(() => {
  const CFG = window.MINOU || {};
  const DEMO = new URLSearchParams(location.search).has('demo') || !CFG.url;
  const $ = s => document.querySelector(s);
  const h = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); e.innerHTML = html; return e; };
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = n => Math.round(Number(n) || 0).toLocaleString('fr-FR');
  const compact = n => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M' : n >= 10000 ? (n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k' : nf(n); };
  const pct = (a, b, d = 0) => b ? (100 * a / b).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }) + ' %' : '–';
  const dur = s => { s = Math.round(Number(s) || 0); if (s < 60) return s + ' s'; const m = Math.floor(s / 60); if (m < 60) return m + ' min ' + String(s % 60).padStart(2, '0'); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
  const dayLabel = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const dayLong = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const parisDay = (offset = 0) => new Date(Date.now() - offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const ago = iso => { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 90 ? 'à l’instant' : s < 3600 ? `il y a ${Math.round(s / 60)} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : `il y a ${Math.round(s / 86400)} j`; };
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- Serveur ----------
  const SKEY = 'minou-dash-session';
  let session = null; try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { }
  let demoData = null;
  const authCall = async (path, body) => {
    const r = await fetch(CFG.url + '/auth/v1/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.key }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.msg || j.error_description || j.message || 'Erreur'), { status: r.status }); return j;
  };
  const setSession = s => { session = s; try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch (e) { } };
  async function rpc(fn, args, retry = true) {
    const r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.key, Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify(args) });
    if (r.status === 401 && retry && session?.refresh_token) {
      try { const s = await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token }); setSession({ access_token: s.access_token, refresh_token: s.refresh_token }); return rpc(fn, args, false); }
      catch (e) { setSession(null); throw Object.assign(new Error('Session expirée'), { status: 401 }); }
    }
    if (!r.ok) throw Object.assign(new Error('Erreur ' + r.status), { status: r.status });
    return r.json();
  }
  async function demo() { if (!demoData) demoData = await (await fetch('demo.json')).json(); return demoData; }
  const api = {
    dashboard: async days => DEMO ? (await demo()).periods[days] : rpc('dashboard', { p_from: parisDay(days - 1), p_to: parisDay(0) }),
    players: async () => DEMO ? (await demo()).players : rpc('dashboard_players', { p_limit: 200, p_offset: 0 }),
    journey: async id => DEMO ? ((await demo()).journeys[id] || []) : rpc('dashboard_player', { p_device: id, p_limit: 600 }),
  };

  // ---------- Infobulle ----------
  const tip = $('#tip');
  function showTip(evt, title, rows) {
    tip.innerHTML = `<b class="t">${esc(title)}</b>` + rows.map(r => `<div class="r"><span>${r.color ? `<i style="background:${r.color}"></i>` : ''}${esc(r.label)}</span><b>${esc(r.value)}</b></div>`).join('');
    tip.hidden = false;
    const w = tip.offsetWidth, hh = tip.offsetHeight; let x = evt.clientX + 14, y = evt.clientY + 14;
    if (x + w > innerWidth - 8) x = evt.clientX - w - 14; if (y + hh > innerHeight - 8) y = evt.clientY - hh - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- Graphiques ----------
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function frame(host, { max, fmt, labels, every }) {
    host.innerHTML = '';
    const W = Math.max(280, host.clientWidth), H = host.clientHeight, L = 44, R = 12, T = 10, B = 24;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
    const top = niceMax(max), y = v => T + (H - T - B) * (1 - v / top);
    for (let k = 0; k <= 4; k++) {
      const v = top * k / 4, yy = Math.round(y(v)) + .5;
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: k ? 'gridl' : 'base' }));
      const t = svgEl('text', { x: L - 8, y: yy + 3.5, 'text-anchor': 'end' }); t.textContent = fmt(v); svg.appendChild(t);
    }
    const n = labels.length, step = every || Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 64))));
    host.appendChild(svg);
    return { svg, W, H, L, R, T, B, y, top, n, step };
  }
  // Courbes : une ou plusieurs séries sur le même axe, réticule et infobulle au survol.
  function lineChart(host, { labels, series, fmt = compact, tipTitle = i => labels[i], tipFmt = nf, area = false }) {
    if (!labels.length) { host.innerHTML = '<div class="empty">Pas encore de données</div>'; return; }
    const max = Math.max(1e-9, ...series.flatMap(s => s.values));
    const f = frame(host, { max, fmt, labels }), { svg, W, H, L, R, T, B, y, n } = f;
    const x = i => n === 1 ? (L + W - R) / 2 : L + (W - L - R) * i / (n - 1);
    for (let i = 0; i < n; i += f.step) { const t = svgEl('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i >= n - f.step ? 'end' : 'middle' }); t.textContent = labels[i]; svg.appendChild(t); }
    series.forEach((s, k) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      if (area && k === 0) svg.appendChild(svgEl('path', { d: `${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill: s.color, opacity: .1 }));
      svg.appendChild(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      svg.appendChild(svgEl('circle', { cx: x(n - 1), cy: y(s.values[n - 1]), r: 4, fill: s.color, class: 'ring' }));
    });
    const cross = svgEl('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }); svg.appendChild(cross);
    const dots = series.map(s => { const c = svgEl('circle', { r: 4.5, fill: s.color, class: 'ring', visibility: 'hidden' }); svg.appendChild(c); return c; });
    const hit = svgEl('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }); svg.appendChild(hit);
    const move = e => {
      const b = svg.getBoundingClientRect(), px = (e.clientX - b.left) * W / b.width;
      const i = Math.max(0, Math.min(n - 1, Math.round((px - L) / Math.max(1, W - L - R) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dots.forEach((c, k) => { c.setAttribute('cx', x(i)); c.setAttribute('cy', y(series[k].values[i])); c.setAttribute('visibility', 'visible'); });
      showTip(e, tipTitle(i), series.map(s => ({ label: s.name, value: tipFmt(s.values[i]), color: s.color })));
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(c => c.setAttribute('visibility', 'hidden')); hideTip(); });
  }
  // Colonnes : une valeur par repère (ici, par niveau).
  function colChart(host, { labels, values, fmt = compact, color, max, refLine, tipRows, tipTitle = i => labels[i], every, faint }) {
    if (!labels.length) { host.innerHTML = '<div class="empty">Pas encore de données</div>'; return; }
    const f = frame(host, { max: max ?? Math.max(1e-9, ...values), fmt, labels, every }), { svg, W, H, L, R, T, B, y, n } = f;
    const slot = (W - L - R) / n, bw = Math.max(1, Math.min(24, slot - (slot > 6 ? 2 : 1))), x = i => L + slot * i + (slot - bw) / 2, r = Math.min(4, bw / 2);
    const band = svgEl('rect', { y: T, height: H - T - B, width: slot, class: 'band', visibility: 'hidden' }); svg.appendChild(band);
    const tickEvery = every || Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 46))));
    labels.forEach((lb, i) => {
      if (i % tickEvery === tickEvery - 1 || (tickEvery === 1)) { const t = svgEl('text', { x: x(i) + bw / 2, y: H - 6, 'text-anchor': 'middle' }); t.textContent = lb; svg.appendChild(t); }
      const v = values[i]; if (!(v > 0)) return;
      const y0 = y(0), y1 = Math.min(y0 - 1, y(v)), hh = y0 - y1, rr = Math.min(r, hh);
      svg.appendChild(svgEl('path', { d: `M${x(i)},${y0}V${y1 + rr}Q${x(i)},${y1} ${x(i) + rr},${y1}H${x(i) + bw - rr}Q${x(i) + bw},${y1} ${x(i) + bw},${y1 + rr}V${y0}Z`, fill: color, opacity: faint && faint(i) ? .35 : 1 }));
    });
    if (refLine != null) { const yy = Math.round(y(refLine.value)) + .5; svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'ref' })); }
    const hit = svgEl('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }); svg.appendChild(hit);
    const move = e => {
      const b = svg.getBoundingClientRect(), px = (e.clientX - b.left) * W / b.width, i = Math.max(0, Math.min(n - 1, Math.floor((px - L) / slot)));
      band.setAttribute('x', L + slot * i); band.setAttribute('visibility', 'visible'); showTip(e, tipTitle(i), tipRows(i));
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { band.setAttribute('visibility', 'hidden'); hideTip(); });
  }
  const legend = (host, items, line = true) => { host.innerHTML = items.map(s => `<span><i class="${line ? 'line' : ''}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join(''); };
  // Liste de barres horizontales (une ou deux parties par ligne).
  function barList(host, rows, { empty = 'Rien sur la période' } = {}) {
    if (!rows.length) { host.innerHTML = `<p class="none">${empty}</p>`; return; }
    const max = Math.max(1, ...rows.map(r => r.parts.reduce((a, b) => a + b, 0)));
    host.innerHTML = rows.map(r => `<div class="bar"><span class="n" title="${esc(r.label)}">${esc(r.label)}</span><span class="v">${esc(r.value)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span><span class="track">${r.parts.map(p => p > 0 ? `<i style="width:${(100 * p / max).toFixed(2)}%"></i>` : '<i style="display:none"></i>').join('')}</span></div>`).join('');
  }

  // ---------- Libellés ----------
  const ITEM = { key: 'Clé magique', time: 'Sablier', eye: 'Loupe', lives: 'Vies pleines', continue: 'Continuer après un échec' };
  const VIA = { lose: 'Abandon après un échec', pause_quit: 'Quitter depuis la pause', restart: 'Recommencer le niveau', closed: 'Jeu fermé en pleine partie' };
  const PLACE = { life: 'vie', level_end: 'fin de niveau', booster: 'bonus', continue: 'continuer', coins: 'croquettes', map: 'carte' };
  const ADKIND = { rewarded: 'Récompensée', interstitial: 'Plein écran', banner: 'Bannière' };
  const PROVIDER = { apple: 'Apple', email: 'E-mail' };

  // ---------- Vue d'ensemble ----------
  let data = null, days = 30;
  function kpi(label, value, unit, delta, note) {
    let d = note || '';
    if (delta && delta.txt) d = `<b class="${delta.dir > 0 ? 'up' : delta.dir < 0 ? 'down' : ''}">${delta.txt}</b> vs ${days} j précédents`;
    return `<div class="kpi"><div class="l" title="${esc(label)}">${esc(label)}</div><div class="v">${value}${unit ? `<small>${unit}</small>` : ''}</div><div class="d">${d || '&nbsp;'}</div></div>`;
  }
  const dCount = (a, b) => !b ? null : { dir: Math.sign(a - b), txt: (a >= b ? '+' : '−') + Math.abs(Math.round(100 * (a - b) / b)) + ' %' };
  const dRate = (a, ab, b, bb) => (!ab || !bb) ? null : (() => { const x = 100 * a / ab - 100 * b / bb; return { dir: Math.abs(x) < .5 ? 0 : Math.sign(x), txt: (x >= 0 ? '+' : '−') + Math.abs(x).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' pt' }; })();
  function renderOverview() {
    const k = data.kpis, p = data.prev, c1 = css('--s1'), c2 = css('--s2'), c3 = css('--s3');
    $('#kpis').innerHTML = [
      kpi('Nouveaux joueurs', nf(k.new_players), '', dCount(k.new_players, p.new_players)),
      kpi('Joueurs actifs', nf(k.active_players), '', dCount(k.active_players, p.active_players)),
      kpi('Rétention J1', pct(k.d1_back, k.d1_base), '', dRate(k.d1_back, k.d1_base, p.d1_back, p.d1_base), k.d1_base ? `${nf(k.d1_back)} sur ${nf(k.d1_base)} joueurs` : 'Disponible dès demain'),
      kpi('Rétention J7', pct(k.d7_back, k.d7_base), '', dRate(k.d7_back, k.d7_base, p.d7_back, p.d7_base), k.d7_base ? `${nf(k.d7_back)} sur ${nf(k.d7_base)} joueurs` : 'Disponible après 7 jours'),
      kpi('Comptes créés', nf(k.accounts_created), '', dCount(k.accounts_created, p.accounts_created), k.new_players ? `${pct(k.accounts_created, k.new_players)} des nouveaux joueurs` : ''),
      kpi('Sessions', compact(k.sessions), '', dCount(k.sessions, p.sessions)),
      kpi('Durée médiane d’une session', dur(k.session_median_s), '', null, `${dur(k.play_s_per_player)} de jeu par joueur`),
      kpi('Taux de réussite', pct(k.level_wins, k.level_starts), '', dRate(k.level_wins, k.level_starts, p.level_wins, p.level_starts), `${compact(k.level_wins)} victoires sur ${compact(k.level_starts)} parties`),
      kpi('Publicités vues', compact(k.ads_shown), '', dCount(k.ads_shown, p.ads_shown), k.active_players ? `${(k.ads_shown / k.active_players).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} par joueur actif` : ''),
      kpi('Croquettes dépensées', compact(k.coins_spent), '', dCount(k.coins_spent, p.coins_spent)),
    ].join('');
    const labels = data.daily.map(d => dayLabel(d.day)), title = i => dayLong(data.daily[i].day);
    const sp = [{ name: 'Joueurs actifs', color: c1, values: data.daily.map(d => d.active_players) }, { name: 'Nouveaux joueurs', color: c2, values: data.daily.map(d => d.new_players) }];
    legend($('#lgPlayers'), sp); lineChart($('#chPlayers'), { labels, series: sp, tipTitle: title, area: true });
    const sg = [{ name: 'Parties lancées', color: c1, values: data.daily.map(d => d.starts) }, { name: 'Gagnées', color: c3, values: data.daily.map(d => d.wins) }, { name: 'Perdues', color: c2, values: data.daily.map(d => d.loses) }];
    legend($('#lgGames'), sg); lineChart($('#chGames'), { labels, series: sg, tipTitle: title });
    // Entonnoir
    const f = data.funnel, first = f[0]?.players || 0;
    $('#funnel').innerHTML = `<div class="fstep fhead"><span>Étape</span><span></span><span>Joueurs</span><span>Part</span></div>` + f.map(s => `<div class="fstep"><span class="n" title="${esc(s.label)}">${esc(s.label)}</span><span class="track"><div class="fill" style="width:${first ? (100 * s.players / first).toFixed(2) : 0}%"></div></span><span class="v">${nf(s.players)}</span><span class="p">${pct(s.players, first)}</span></div>`).join('');
    // Rétention
    const cv = data.curve.filter(c => c.base > 0);
    lineChart($('#chRet'), { labels: cv.map(c => 'J' + c.n), series: [{ name: 'Joueurs revenus', color: c1, values: cv.map(c => 100 * c.back / c.base) }], fmt: v => Math.round(v) + ' %', tipFmt: v => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %', tipTitle: i => `${cv[i].n} jour${cv[i].n > 1 ? 's' : ''} après l’arrivée (${nf(cv[i].back)} sur ${nf(cv[i].base)})`, area: true });
    const cols = [1, 3, 7, 14, 30], seq = css('--seq');
    $('#cohorts').innerHTML = `<thead><tr><th>Arrivée</th><th>Joueurs</th>${cols.map(n => `<th>J${n}</th>`).join('')}</tr></thead><tbody>` + (data.cohorts.length ? [...data.cohorts].reverse().map(c => `<tr><td>${dayLabel(c.day)}</td><td>${nf(c.size)}</td>${cols.map(n => { const v = c['d' + n]; if (v == null) return '<td class="dim">·</td>'; const r = c.size ? v / c.size : 0; return `<td class="heat" style="background:rgba(${seq},${(0.06 + r * 0.6).toFixed(3)})" title="${nf(v)} sur ${nf(c.size)}">${Math.round(r * 100)} %</td>`; }).join('')}</tr>`).join('') : `<tr><td colspan="7" class="dim l">Pas encore de joueurs sur la période</td></tr>`) + '</tbody>';
    // Bonus
    const kinds = ['key', 'time', 'eye'], bz = kind => src => (data.boosters.find(b => b.kind === kind && b.source === src)?.uses) || 0;
    legend($('#lgBoost'), [{ name: 'Avant le niveau', color: c1 }, { name: 'Pendant la partie', color: c2 }], false);
    barList($('#boosters'), kinds.map(kd => { const a = bz(kd)('pre'), b = bz(kd)('game'); return { label: ITEM[kd], value: nf(a + b), parts: [a, b] }; }).filter(r => r.parts[0] + r.parts[1] > 0), { empty: 'Aucun bonus utilisé sur la période' });
    barList($('#spend'), data.spend.map(s => ({ label: ITEM[s.item] || s.item, value: compact(s.coins), note: `${nf(s.buys)} achat${s.buys > 1 ? 's' : ''}`, parts: [s.coins] })), { empty: 'Aucune dépense sur la période' });
    $('#spendSub').textContent = `Par type d’achat · ${compact(data.earn.levels + data.earn.daily)} croquettes gagnées en face`;
    barList($('#ads'), data.ads.map(a => ({ label: `${ADKIND[a.kind] || a.kind} · ${PLACE[a.placement] || a.placement}`, value: nf(a.shown), note: a.kind === 'rewarded' ? `${pct(a.rewarded, a.shown)} vues en entier` : '', parts: [a.shown] })), { empty: 'Aucune publicité vue sur la période' });
    barList($('#quits'), data.quits.map(q => ({ label: VIA[q.via] || q.via, value: nf(q.n), parts: [q.n] })), { empty: 'Aucun abandon sur la période' });
    barList($('#accounts'), data.accounts.filter(a => a.created || a.logins).map(a => ({ label: PROVIDER[a.provider] || a.provider, value: nf(a.created), note: a.logins ? `${nf(a.logins)} reconnexion${a.logins > 1 ? 's' : ''}` : '', parts: [a.created] })), { empty: 'Aucun compte créé sur la période' });
    const t = data.totals;
    $('#totals').innerHTML = [['Joueurs', nf(t.players)], ['Comptes', nf(t.accounts)], ['Part des joueurs avec un compte', pct(t.accounts, t.players)], ['Événements enregistrés', nf(t.events)], ['Premier joueur', t.first_day ? dayLabel(t.first_day) : '–'], ['Cadeaux du jour ouverts (période)', nf(data.earn.daily_claims)]].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  }

  // ---------- Niveaux ----------
  let sortKey = 'level', sortDir = 1;
  const rate = l => l.starts ? l.wins / l.starts : 0;
  const tries = l => l.winners ? l.starts / l.winners : null;
  const watch = l => l.starts >= 10 && rate(l) < 0.5;
  function renderLevels() {
    const lv = data.levels.filter(l => l.level <= 200), c1 = css('--s1');
    const labels = lv.map(l => String(l.level)), title = i => `Niveau ${lv[i].level}${lv[i].boss ? ' · boss' : ''}`;
    const every = lv.length > 60 ? 10 : lv.length > 24 ? 5 : 1;
    colChart($('#chReach'), { labels, values: lv.map(l => l.winners), color: c1, every, tipTitle: title, tipRows: i => [{ label: 'Joueurs qui l’ont gagné', value: nf(lv[i].winners) }, { label: 'Joueurs qui l’ont lancé', value: nf(lv[i].players) }, { label: 'Arrêtés ici', value: nf(lv[i].stuck) }] });
    colChart($('#chWin'), { labels, values: lv.map(l => 100 * rate(l)), max: 100, fmt: v => Math.round(v) + ' %', color: c1, every, refLine: { value: 50 }, faint: i => lv[i].starts < 10, tipTitle: title, tipRows: i => [{ label: 'Réussite', value: pct(lv[i].wins, lv[i].starts) }, { label: 'Parties lancées', value: nf(lv[i].starts) }, { label: 'Victoires', value: nf(lv[i].wins) }, { label: 'Échecs', value: nf(lv[i].loses) }] });
    const cols = [['level', 'Niveau', 'l'], ['players', 'Joueurs'], ['starts', 'Parties'], ['rate', 'Réussite'], ['tries', 'Essais par victoire'], ['loses', 'Échecs'], ['quits', 'Abandons'], ['continues', 'Continuer'], ['boosters', 'Bonus'], ['avg_stars', 'Étoiles'], ['avg_win_s', 'Temps'], ['stuck', 'Arrêtés ici']];
    const val = (l, k) => k === 'rate' ? rate(l) : k === 'tries' ? (tries(l) ?? 0) : Number(l[k]) || 0;
    let rows = lv.filter(l => !$('#onlyHard').checked || watch(l)).sort((a, b) => (val(a, sortKey) - val(b, sortKey)) * sortDir || a.level - b.level);
    $('#levels').innerHTML = `<thead><tr>${cols.map(([k, t, c]) => `<th data-k="${k}" class="${c || ''}${k === sortKey ? ' sorted' : ''}">${t}${k === sortKey ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead><tbody>` + (rows.length ? rows.map(l => {
      const r = rate(l), tg = (l.boss ? '<span class="tag boss">Boss</span>' : '') + (l.hard ? `<span class="tag">${l.hard >= 2 ? 'Très difficile' : 'Difficile'}</span>` : '') + (watch(l) ? `<span class="tag ${r < 0.35 ? 'hard' : 'watch'}">${r < 0.35 ? 'Trop dur ?' : 'À surveiller'}</span>` : '');
      return `<tr><td><b>${l.level}</b> <span class="dim">${l.mode === 'time' ? 'chrono' : 'coups'}</span>${tg}</td><td>${nf(l.players)}</td><td>${nf(l.starts)}</td><td><span class="mini"><i style="width:${Math.round(r * 100)}%"></i></span>${pct(l.wins, l.starts)}</td><td>${tries(l) ? tries(l).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '–'}</td><td>${nf(l.loses)}</td><td>${nf(l.quits)}</td><td>${nf(l.continues)}</td><td>${nf(l.boosters)}</td><td>${l.avg_stars != null ? Number(l.avg_stars).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–'}</td><td>${l.avg_win_s != null ? dur(l.avg_win_s) : '–'}</td><td>${nf(l.stuck)}</td></tr>`;
    }).join('') : `<tr><td colspan="${cols.length}" class="dim l">${data.levels.length ? 'Aucun niveau à surveiller sur la période. Tant mieux !' : 'Pas encore de parties sur la période'}</td></tr>`) + '</tbody>';
    $('#levels').querySelectorAll('th[data-k]').forEach(th => th.onclick = () => { const k = th.dataset.k; if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'level' ? 1 : -1; } renderLevels(); });
  }

  // ---------- Joueurs ----------
  let players = null;
  const shortId = id => id.slice(0, 8);
  async function renderPlayers() {
    const t = $('#players');
    if (!players) { t.innerHTML = '<tbody><tr><td class="dim l">Chargement…</td></tr></tbody>'; try { players = await api.players(); } catch (e) { return fail(e); } }
    t.innerHTML = `<thead><tr><th>Joueur</th><th class="l">Compte</th><th>Arrivé</th><th>Dernière activité</th><th>Jours actifs</th><th>Sessions</th><th>Temps de jeu</th><th>Niveau atteint</th><th>Parties</th><th>Réussite</th><th>Pubs</th></tr></thead><tbody>` + (players.length ? players.map(p => `<tr class="click" data-id="${p.device_id}"><td class="mono">${shortId(p.device_id)}</td><td class="l">${p.has_account ? 'Oui' : '<span class="dim">Non</span>'}</td><td>${new Date(p.first_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</td><td>${ago(p.last_at)}</td><td>${nf(p.active_days)}</td><td>${nf(p.sessions)}</td><td>${dur(p.play_s)}</td><td><b>${nf(p.max_level)}</b></td><td>${nf(p.starts)}</td><td>${pct(p.wins, p.starts)}</td><td>${nf(p.ads)}</td></tr>`).join('') : '<tr><td colspan="11" class="dim l">Pas encore de joueurs</td></tr>') + '</tbody>';
    t.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => openJourney(players.find(p => p.device_id === tr.dataset.id), tr));
  }
  const REASON = { time: 'temps écoulé', moves: 'plus de coups' };
  function describe(e) {
    const p = e.props || {}, n = e.level != null ? `Niveau ${e.level}` : 'Niveau';
    switch (e.name) {
      case 'install': return ['open', 'Première ouverture du jeu', ''];
      case 'app_open': return ['open', 'Ouverture du jeu', p.unlocked ? `niveau ${p.unlocked}, ${nf(p.coins)} croquettes` : ''];
      case 'app_background': return ['', 'Jeu mis en veille', p.session_s ? `session de ${dur(p.session_s)}` : ''];
      case 'level_start': return ['start', `${n} lancé`, [p.boss ? 'boss' : '', p.mode === 'time' ? 'chrono' : 'coups', p.replay ? 'rejoué' : ''].filter(Boolean).join(', ')];
      case 'level_win': return ['win', `${n} gagné`, `${'★'.repeat(p.stars || 0)}${'☆'.repeat(3 - (p.stars || 0))} en ${dur(p.duration_s)}, +${nf(p.coins)} croquettes`];
      case 'level_lose': return ['lose', `${n} perdu`, `${REASON[p.reason] || ''}${p.duration_s ? ` après ${dur(p.duration_s)}` : ''}`];
      case 'level_quit': return ['quit', `${n} abandonné`, (VIA[p.via] || '').toLowerCase()];
      case 'level_continue': return ['money', `${n} : partie prolongée`, ''];
      case 'booster_use': return ['', `Bonus utilisé : ${ITEM[p.kind] || p.kind}`, p.source === 'pre' ? 'avant le niveau' : 'pendant la partie'];
      case 'coins_spend': return ['money', `Achat : ${ITEM[p.item] || p.item}`, `${nf(p.price)} croquettes`];
      case 'daily_claim': return ['money', 'Cadeau du jour ouvert', `jour ${p.day}`];
      case 'ad_show': return ['money', 'Publicité affichée', `${(ADKIND[p.kind] || '').toLowerCase()}, ${PLACE[p.placement] || p.placement || ''}`];
      case 'ad_reward': return ['money', 'Récompense de publicité obtenue', PLACE[p.placement] || ''];
      case 'no_lives': return ['lose', 'Plus de vies', ''];
      case 'shop_open': return ['', 'Boutique ouverte', ''];
      case 'intro_seen': return ['', 'Nouveauté découverte', p.key || ''];
      case 'account_prompt': return ['acct', 'Proposition de compte affichée', p.from === 'level5' ? 'après le niveau 5' : 'depuis les réglages'];
      case 'account_create': return ['acct', 'Compte créé', PROVIDER[p.provider] || ''];
      case 'account_login': return ['acct', 'Connexion au compte', PROVIDER[p.provider] || ''];
      case 'account_logout': return ['acct', 'Déconnexion', ''];
      case 'account_delete': return ['acct', 'Compte supprimé', ''];
      case 'save_restore': return ['acct', 'Progression récupérée du compte', p.level ? `niveau ${p.level}` : ''];
      case 'progress_reset': return ['quit', 'Progression remise à zéro', ''];
      case 'stats_off': return ['', 'Statistiques désactivées par le joueur', ''];
      default: return ['', e.name, ''];
    }
  }
  async function openJourney(p, tr) {
    document.querySelectorAll('#players tr.sel').forEach(x => x.classList.remove('sel')); tr?.classList.add('sel');
    $('#drTitle').textContent = `Joueur ${shortId(p.device_id)}`;
    $('#drSub').textContent = `Niveau ${p.max_level} atteint · ${nf(p.sessions)} session${p.sessions > 1 ? 's' : ''} · ${dur(p.play_s)} de jeu${p.has_account ? ' · compte créé' : ''}`;
    const body = $('#drBody'); body.innerHTML = '<p class="none">Chargement…</p>'; $('#drawer').hidden = false;
    let evs; try { evs = await api.journey(p.device_id); } catch (e) { body.innerHTML = '<p class="none">Parcours indisponible.</p>'; return; }
    if (!evs.length) { body.innerHTML = `<p class="none">${DEMO ? 'En démonstration, le parcours détaillé n’est fourni que pour les premiers joueurs de la liste.' : 'Aucun événement.'}</p>`; return; }
    let html = '', lastDay = '', lastSes = null;
    for (const e of evs) { // du plus récent au plus ancien
      const d = new Date(e.at), dk = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      if (dk !== lastDay) { html += `<h3>${dk}</h3>`; lastDay = dk; lastSes = e.session_id; }
      else if (e.session_id !== lastSes) { html += '<div class="ev gap">· autre session ·</div>'; lastSes = e.session_id; }
      const [cls, text, sub] = describe(e);
      html += `<div class="ev ${cls}"><time>${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</time><i></i><span>${esc(text)}${sub ? ` <small>${esc(sub)}</small>` : ''}</span></div>`;
    }
    body.innerHTML = html; body.scrollTop = 0;
  }
  $('#drClose').onclick = () => { $('#drawer').hidden = true; document.querySelectorAll('#players tr.sel').forEach(x => x.classList.remove('sel')); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#drClose').click(); });

  // ---------- Navigation et chargement ----------
  let tab = 'overview';
  function render() { if (!data) return; if (tab === 'overview') renderOverview(); else if (tab === 'levels') renderLevels(); else renderPlayers(); }
  function fail(e) {
    if (e.status === 401) { setSession(null); return showLogin('Session expirée. Reconnecte-toi.'); }
    const box = $('#pageErr'); box.hidden = false; $('#app').classList.toggle('denied', e.status === 403);
    box.textContent = e.status === 403 ? 'Ton accès est créé, mais il n’est pas encore autorisé à voir les chiffres : il doit être ajouté à la liste des administrateurs dans Supabase. Actualise ensuite cette page.' : 'Impossible de charger les chiffres. Vérifie ta connexion puis actualise.';
  }
  async function loadData() {
    $('#refresh').classList.add('spin'); $('#pageErr').hidden = true;
    try {
      data = await api.dashboard(days); players = null; $('#app').classList.remove('denied');
      $('#stamp').textContent = `Du ${dayLabel(data.from)} au ${dayLabel(data.to)} · mis à jour à ${new Date(DEMO ? Date.now() : data.generated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
      render();
    } catch (e) { fail(e); }
    $('#refresh').classList.remove('spin');
  }
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    tab = b.dataset.tab; document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + tab; }); $('#period').style.visibility = tab === 'players' ? 'hidden' : ''; render();
  });
  document.querySelectorAll('#period button').forEach(b => b.onclick = () => { days = +b.dataset.d; document.querySelectorAll('#period button').forEach(x => x.classList.toggle('on', x === b)); loadData(); });
  $('#refresh').onclick = loadData;
  $('#onlyHard').onchange = renderLevels;
  $('#logout').onclick = () => { setSession(null); if (DEMO) location.search = ''; else showLogin(); };
  let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

  function showLogin(msg) { $('#app').hidden = true; $('#drawer').hidden = true; $('#login').hidden = false; const e = $('#loginErr'); e.hidden = !msg; e.textContent = msg || ''; }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; $('#demoNote').hidden = !DEMO; if (DEMO) $('#logout').hidden = true; loadData(); }
  // Connexion, ou création d'un accès (e-mail + mot de passe). Un accès neuf ne voit rien tant qu'il n'est pas dans la liste des administrateurs.
  let signup = false;
  const setMode = on => {
    signup = on; const f = $('#loginForm');
    $('#loginBtn').textContent = on ? 'Créer mon accès' : 'Se connecter';
    $('#loginMode').textContent = on ? 'J’ai déjà un accès : me connecter' : 'Première fois ? Créer mon accès';
    $('#pwHint').hidden = !on; f.password.autocomplete = on ? 'new-password' : 'current-password'; $('#loginErr').hidden = true;
  };
  $('#loginMode').onclick = () => setMode(!signup);
  const authError = err => {
    if (!signup) return err.status === 400 ? 'E-mail ou mot de passe incorrect.' : 'Connexion impossible. Réessaie dans un instant.';
    const m = (err.message || '').toLowerCase();
    if (m.includes('already')) return 'Cette adresse a déjà un compte, par exemple créé avec Apple dans le jeu. Utilise une autre adresse.';
    if (m.includes('password')) return 'Le mot de passe doit faire au moins 8 caractères.';
    if (m.includes('email') || m.includes('invalid')) return 'Cette adresse e-mail n’est pas valide.';
    if (err.status === 429) return 'Trop d’essais. Réessaie dans quelques minutes.';
    return 'Création impossible. Réessaie dans un instant.';
  };
  $('#loginForm').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = $('#loginBtn'); $('#loginErr').hidden = true;
    const email = f.email.value.trim(), password = f.password.value;
    if (signup && password.length < 8) { const el = $('#loginErr'); el.hidden = false; el.textContent = 'Le mot de passe doit faire au moins 8 caractères.'; return; }
    b.disabled = true;
    try {
      const s = signup ? await authCall('signup', { email, password, data: { source: 'dashboard' } }) : await authCall('token?grant_type=password', { email, password });
      if (!s.access_token) throw Object.assign(new Error('pas de session'), { status: 0 });
      setSession({ access_token: s.access_token, refresh_token: s.refresh_token }); f.password.value = ''; setMode(false); showApp();
    } catch (err) { const el = $('#loginErr'); el.hidden = false; el.textContent = authError(err); }
    b.disabled = false;
  };
  if (DEMO || session) showApp(); else showLogin();
})();
