/* ============================================================================
   Colour roles add-on  -  for out_index.html  ("Edit Colors" > "Auto adaptive")
   Paste this whole file inside a NEW <script> ... </script> right before </body>
   (after the existing big script), or save it next to out_index.html and add
   <script src="colour-roles-addon.js"></script> before </body>.

   What it adds
   1. Smarter Flag / Logo / Keep detection that works on every flag design
        - names of the layer and its groups (base, flag, mid, polosa -> flag;
          logo, emblem, griva, mane, icon ... -> logo; mask, pole ... -> keep)
        - white / gray / silver gradients (poles, shine overlays) are kept
        - parts with a generic name (Layer 11 ...) follow the flag when their
          colour is in the flag's colour family, otherwise they are guessed as logo
   2. It remembers your Flag / Logo / Keep choices per layer name (this browser),
      so a corrected design is right the next time it appears.
   3. Two buttons: "Original flag colours" / "Original logo colours".
   ========================================================================== */
(function () {
  if (typeof collectColors !== 'function' || typeof mkG !== 'function' || typeof applyAdaptive !== 'function') {
    console.warn('Colour roles add-on: main script not found, nothing changed.');
    return;
  }

  var LS_KEY = 'tgsColourRoles.v1', mem = {}, roleOff = { flag: false, logo: false };
  try { mem = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { mem = {}; }
  function saveMem() { try { localStorage.setItem(LS_KEY, JSON.stringify(mem)); } catch (e) {} }

  function norm(s) { return String(s || '').toLowerCase().replace(/[\s_\-]*\d+$/, '').replace(/\s+/g, ' ').trim(); }
  function words(list) { return new RegExp('(^|[^a-z])(' + list.join('|') + ')([^a-z]|$)'); }
  var RX_KEEP = words(['mask', 'matte', 'pole', 'staff', 'mast', 'stick', 'rod', 'handle']);
  var RX_LOGO = words(['logo', 'emblem', 'icon', 'symbol', 'badge', 'crest', 'griva', 'mane', 'hair', 'plane']);
  var RX_FLAG = words(['flag', 'base', 'mid', 'polosa', 'stripe', 'banner', 'cloth', 'wave', 'body verh', 'body niz']);

  // ---- 1) collect colours WITH their layer / group names ----
  collectColors = function (doc) {
    var out = [];
    var okC = function (p) { return p && ((p.a === 1 && Array.isArray(p.k) && p.k.length && p.k[0].s) || (Array.isArray(p.k) && typeof p.k[0] === 'number')); };
    var nm = function (it) { return it.nm ? ' (' + it.nm + ')' : ''; };
    function shapes(list, lab, ctx) {
      (list || []).forEach(function (it) {
        var c2 = { layer: ctx.layer, mask: ctx.mask, groups: ctx.groups };
        if (it.ty === 'gf' || it.ty === 'gs') out.push({ type: 'grad', ref: it, ctx: c2, label: lab + ' \u2014 gradient ' + (it.ty === 'gf' ? 'fill' : 'stroke') + nm(it) });
        else if ((it.ty === 'fl' || it.ty === 'st') && okC(it.c)) out.push({ type: 'solid', holder: it, key: 'c', ctx: c2, label: lab + ' \u2014 ' + (it.ty === 'fl' ? 'fill' : 'stroke') + nm(it) });
        else if (it.ty === 'gr') shapes(it.it, lab + (it.nm ? ' / ' + it.nm : ''), { layer: ctx.layer, mask: ctx.mask, groups: ctx.groups.concat([it.nm || '']) });
      });
    }
    function layers(ls, comp) {
      (ls || []).forEach(function (l) {
        var lab = comp + (l.nm ? ' / ' + l.nm : ''), ctx = { layer: l.nm || '', mask: l.td === 1, groups: [] };
        if (l.ty === 1 && typeof l.sc === 'string') out.push({ type: 'solid', holder: l, key: 'sc', ctx: ctx, label: lab + ' \u2014 solid layer' });
        shapes(l.shapes, lab, ctx);
        (l.ef || []).forEach(function (e) {
          (e.ef || []).forEach(function (p) {
            if (p.ty === 2 && okC(p.v)) out.push({ type: 'solid', holder: p, key: 'v', ctx: ctx, label: lab + ' \u2014 effect' + (e.nm ? ' ' + e.nm : '') });
          });
        });
      });
    }
    layers(doc.layers, 'main');
    (doc.assets || []).forEach(function (a) { if (Array.isArray(a.layers)) layers(a.layers, 'asset:' + (a.id || '?')); });
    return out;
  };
  var _mkG = mkG;
  mkG = function (it) { var G = _mkG(it); if (G) G.ctx = it.ctx; return G; };

  // ---- 2) role detection ----
  function byName(G) {
    var c = G.ctx || {}, t = ((c.layer || '') + ' ' + (c.groups || []).join(' ')).toLowerCase();
    if (c.mask || RX_KEEP.test(t)) return 'keep';
    if (RX_LOGO.test(t)) return 'logo';
    if (RX_FLAG.test(t)) return 'flag';
    return null;
  }
  function stopsOf(G) { return G.base || G.stops || []; }
  function meanSat(G) { var s = stopsOf(G); return s.length ? s.reduce(function (a, x) { return a + x.s; }, 0) / s.length : 0; }
  function neutral(G) { return meanSat(G) < 0.15; }            // white / gray / silver / black
  function hueOf(G) {
    var x = 0, y = 0, n = 0;
    stopsOf(G).forEach(function (st) { if (st.s > 0.2) { var r = st.h * Math.PI / 180, w = st.s * Math.max(st.v, 0.15); x += Math.cos(r) * w; y += Math.sin(r) * w; n++; } });
    return n ? (Math.atan2(y, x) * 180 / Math.PI + 360) % 360 : null;
  }
  function hdist(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  function assignRoles(list) {
    list.forEach(function (G) {
      var c = G.ctx || { layer: '', groups: [] };
      G.rkey = norm(c.layer) + '>' + norm((c.groups || [])[0]);
      G.autoRole = byName(G); G.guessed = false;
    });
    var fx = 0, fy = 0, fn = 0, fref = null;
    list.forEach(function (G) {
      if (G.autoRole === 'flag' && !neutral(G)) { var h = hueOf(G); if (h != null) { var r = h * Math.PI / 180; fx += Math.cos(r); fy += Math.sin(r); fn++; } }
    });
    if (fn) fref = (Math.atan2(fy, fx) * 180 / Math.PI + 360) % 360;
    else {                                                       // no named flag parts: most common colour family
      var bins = {}, best = null;
      list.forEach(function (G) {
        if (G.autoRole || neutral(G)) return;
        var h = hueOf(G); if (h == null) return;
        var b = Math.floor(h / 30); bins[b] = (bins[b] || 0) + 1;
        if (best === null || bins[b] > bins[best]) best = b;
      });
      if (best !== null) fref = best * 30 + 15;
    }
    list.forEach(function (G) {
      if (!G.autoRole) {
        var h = hueOf(G);
        if (h == null || fref == null || neutral(G)) G.autoRole = 'flag';
        else if (hdist(h, fref) > 75) { G.autoRole = 'logo'; G.guessed = true; }
        else G.autoRole = 'flag';
      }
      var m = mem[G.rkey];
      G.role = (m === 'flag' || m === 'logo' || m === 'keep') ? m : G.autoRole;
      G._last = G.role;
      if (G.guessed && G.role === G.autoRole) G.label += ' \u00b7 role guessed from colour';
    });
    updateSum();
  }

  // a role changed in the list -> apply it to the whole part (same layer + group) and remember it
  function syncRoles() {
    var ch = null;
    GS.forEach(function (G) { if (G.role !== G._last) ch = G; });
    if (!ch) return;
    var role = ch.role;
    GS.forEach(function (G) { if (G.rkey === ch.rkey) { G.role = role; G._last = role; } });
    if (role === ch.autoRole) delete mem[ch.rkey]; else mem[ch.rkey] = role;
    saveMem();
  }

  function updateSum() {
    var el = document.getElementById('role-sum'); if (!el || !GS.length) return;
    var c = { flag: 0, logo: 0, keep: 0 }, g = 0;
    GS.forEach(function (G) { c[G.role] = (c[G.role] || 0) + 1; if (G.guessed && G.role === G.autoRole) g++; });
    var t = c.flag + ' flag \u00b7 ' + c.logo + ' logo \u00b7 ' + c.keep + ' kept as is';
    if (g) t += ' &mdash; &#9888; ' + g + ' guessed from colour, please check the list';
    if (roleOff.flag) t += '<br>Flag shows its original colours (change the Flag colour to recolour it).';
    if (roleOff.logo) t += '<br>Logo shows its original colours (change the Logo colour to recolour it).';
    el.innerHTML = t;
  }

  // run role detection when a new file is loaded into the editor
  var _loadPreview = loadPreview;
  loadPreview = function (fresh) {
    if (fresh === true && typeof GS !== 'undefined' && GS.length) {
      assignRoles(GS);
      if (emode === 'adapt') setTimeout(function () { applyAdaptive(); }, 0);
    }
    return _loadPreview.apply(this, arguments);
  };

  // ---- 3) adaptive apply: keeps neutral gradients, honours "original" buttons, remembers choices ----
  applyAdaptive = function () {
    if (!editData) return;
    syncRoles();
    var kn = $('keep-neutral').checked;
    var skip = function (G) { return G.role === 'keep' || roleOff[G.role] || (kn && neutral(G)); };
    var ref = {};
    ['flag', 'logo'].forEach(function (r) {
      var hs = GS.filter(function (G) { return G.role === r && !skip(G); }).reduce(function (a, G) { return a.concat(G.base.map(hslOf)); }, []);
      ref[r] = hs.length ? { L: hs.reduce(function (a, x) { return a + x[2]; }, 0) / hs.length, S: hs.reduce(function (a, x) { return a + x[1]; }, 0) / hs.length } : null;
    });
    GS.forEach(function (G) {
      if (skip(G)) {
        if (G.adapted) { setState(G, clone(G.orig)); Object.assign(G, parseAny(G), { dirty: false, adapted: false }); }
        return;
      }
      G.stops = adaptG(G.base.map(function (x) { return Object.assign({}, x); }), rcolor[G.role], ref[G.role]);
      G.dirty = true; G.adapted = true; writeG(G);
    });
    if (!cur().stops.includes(sel)) sel = cur().stops[0];
    updateSum();
    loadPreview(false); renderAll();
  };

  // ---- 4) small UI additions ----
  var box = document.getElementById('e-adapt-box');
  if (box) {
    var wrap = document.createElement('div');
    wrap.className = 'row'; wrap.style.marginTop = '8px';
    wrap.innerHTML = '<button class="secondary sm" id="reset-flag">Original flag colours</button><button class="secondary sm" id="reset-logo">Original logo colours</button>';
    var sum = document.createElement('div');
    sum.id = 'role-sum'; sum.className = 'hint'; sum.style.marginTop = '8px';
    box.appendChild(wrap); box.appendChild(sum);
    document.getElementById('reset-flag').onclick = function () { roleOff.flag = true; applyAdaptive(); };
    document.getElementById('reset-logo').onclick = function () { roleOff.logo = true; applyAdaptive(); };
    ['flag', 'logo'].forEach(function (k) {
      var on = function () { roleOff[k] = false; };
      var c = document.getElementById('c-' + k), h = document.getElementById('h-' + k);
      if (c) c.addEventListener('input', on);
      if (h) h.addEventListener('change', on);
    });
    var kn = document.getElementById('keep-neutral');
    if (kn && kn.parentNode && kn.parentNode.lastChild && kn.parentNode.lastChild.nodeType === 3)
      kn.parentNode.lastChild.textContent = ' Keep white / gray / silver / black colours unchanged (solid and gradient)';
  }
})();
