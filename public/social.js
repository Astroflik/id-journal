/* Profile and clans (stage C). Optional section: "Аккаунт" → "Профиль и кланы".
   Everything goes through the Supabase functions of migration 0003; avatars and clan
   emblems are small square images in the public "avatars" bucket under "<user id>/".
   Uses the journal helpers el(), modal(), toast() and accountApi from app.js. */
(function () {
  'use strict';
  const api = () => accountApi;
  const ERR = {
    not_signed_in: 'Нужно войти в аккаунт', nick_taken: 'Этот ник уже занят', nick_invalid: 'Ник: от 3 до 20 знаков, буквы, цифры, _ . -',
    bio_too_long: 'Описание длиннее 300 знаков', links_invalid: 'Ссылки: до 5 штук, только https://', avatar_invalid: 'Не удалось сохранить аватар',
    nick_required: 'Сначала сохраните ник в профиле', already_in_clan: 'Вы уже состоите в клане', tag_invalid: 'Тег: от 2 до 5 латинских букв или цифр',
    tag_taken: 'Такой тег уже занят', name_invalid: 'Название: от 3 до 32 знаков', description_too_long: 'Описание длиннее 500 знаков',
    color_invalid: 'Неверный цвет', emblem_invalid: 'Не удалось сохранить эмблему', not_allowed: 'Недостаточно прав',
    invite_params_invalid: 'Срок от 1 до 30 дней, использований от 1 до 100', too_many_invites: 'Слишком много активных приглашений',
    invite_invalid: 'Код не найден, истёк или уже использован', clan_full: 'В клане уже 50 участников', role_invalid: 'Неверная роль',
    message_invalid: 'Пустое или слишком длинное сообщение', slow_down: 'Слишком часто, подождите минуту'
  };
  const ROLE = { leader: 'глава', officer: 'офицер', member: 'участник' };
  const S = { me: null, loading: null };

  async function rpc(name, args) {
    const { data, error } = await api().sb.rpc(name, args || {});
    if (error) { const m = String(error.message || ''); throw new Error(ERR[m] || api().describe(error)) }
    return data
  }
  const bucket = () => api().sb.storage.from('avatars');
  const url = p => { if (!p) return ''; try { return bucket().getPublicUrl(p).data.publicUrl || '' } catch { return '' } };
  const ok = () => !!(api().cloud && api().user && api().user.uid);

  // round avatar: picture or first letter
  function face(path, name, size, cls) {
    const d = el('span', 'so-face' + (cls ? ' ' + cls : '')); d.style.setProperty('--s', (size || 40) + 'px');
    const u = url(path);
    if (u) { const i = el('img'); i.alt = ''; i.src = u; i.onerror = () => { i.remove(); d.textContent = (name || '?').slice(0, 1).toUpperCase() }; d.append(i) }
    else d.textContent = (name || '?').slice(0, 1).toUpperCase();
    return d
  }
  function tagChip(c) { const t = el('span', 'so-tag', '[' + c.tag + ']'); t.style.setProperty('--cc', c.color || '#888'); t.title = c.name || ''; return t }
  function nameLine(nick, clan) { const s = el('span', 'so-name'); if (clan && clan.tag) s.append(tagChip(clan), ' '); s.append(el('b', null, nick || 'без ника')); return s }

  // square image, centre-cropped and scaled to `side`, webp (png where webp is missing)
  async function square(file, side) {
    const src = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось прочитать изображение')); i.src = src });
      const s = Math.min(img.naturalWidth, img.naturalHeight); if (!s) throw new Error('Пустое изображение');
      const cv = document.createElement('canvas'); cv.width = cv.height = side;
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, side, side);
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, side, side);
      for (const q of [.86, .74, .6]) {
        const b = await new Promise(r => cv.toBlob(r, 'image/webp', q));
        if (b && b.type === 'image/webp' && b.size < 500 * 1024) return b
      }
      const b = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!b || b.size >= 500 * 1024) throw new Error('Изображение слишком большое');
      return b
    } finally { URL.revokeObjectURL(src) }
  }
  async function upload(file, name, side) {
    const blob = await square(file, side), ext = blob.type === 'image/webp' ? 'webp' : 'png';
    const path = api().user.uid + '/' + name + '-' + Date.now().toString(36) + '.' + ext;
    const { error } = await bucket().upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
    if (error) throw new Error(api().describe(error));
    return path
  }
  function dropFile(path) { if (path && path.indexOf(api().user.uid + '/') === 0 && bucket().remove) bucket().remove([path]).catch(() => {}) }

  // second click within 3 s confirms
  function sure(b, label, ask, fn) {
    b.onclick = () => {
      if (!b._a) { b._a = 1; b.textContent = ask; b.classList.add('bad'); setTimeout(() => { b._a = 0; b.textContent = label; b.classList.remove('bad') }, 3000); return }
      fn()
    }
  }
  async function busy(b, fn) { b.disabled = true; try { return await fn() } catch (e) { toast(e.message) } finally { b.disabled = false } }
  const field = (label, input, hint) => { const w = el('label', 'so-field'); w.append(el('span', null, label), input); if (hint) w.append(el('small', 'mu', hint)); return w };
  const inp = (v, ph, max) => { const i = el('input'); i.value = v || ''; if (ph) i.placeholder = ph; if (max) i.maxLength = max; return i };
  const area = (v, ph, max) => { const t = el('textarea'); t.value = v || ''; if (ph) t.placeholder = ph; t.maxLength = max; t.rows = 3; return t };
  const fileBtn = (label, cb) => {
    const f = el('input'); f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp,image/gif'; f.hidden = true;
    const b = el('button', 's', label); b.type = 'button'; b.onclick = () => f.click();
    f.onchange = async () => { const x = f.files[0]; f.value = ''; if (x) await busy(b, () => cb(x)) };
    const w = el('span'); w.append(b, f); return w
  };

  async function load() { S.me = await rpc('my_profile'); refreshNav(); return S.me }

  // ---------------------------------------------------------------- window
  function open(tab) {
    if (!ok()) return toast('Профиль и кланы доступны после входа в аккаунт');
    modal((m, close) => {
      m.closest('.ov').classList.add('auth-modal'); m.classList.add('so-md');
      const head = el('div', 'bar so-head'), x = el('button', 's', '✕ Закрыть'); x.type = 'button'; x.onclick = close;
      const tabs = el('div', 'so-tabs'), body = el('div', 'so-body');
      const t1 = el('button', null, 'Профиль'), t2 = el('button', null, 'Клан'); t1.type = t2.type = 'button';
      tabs.append(t1, t2); head.append(el('h3', null, 'Профиль и кланы'), tabs, x); m.append(head, body);
      const show = async k => {
        t1.classList.toggle('on', k === 'p'); t2.classList.toggle('on', k === 'c');
        body.replaceChildren(el('div', 'mu', 'Загрузка…')); m._poll && clearInterval(m._poll);
        try { await load(); if (!m.isConnected) return; k === 'p' ? profileTab(body) : await clanTab(body, m) }
        catch (e) { body.replaceChildren(el('div', 'mu', 'Не удалось загрузить: ' + e.message)) }
      };
      t1.onclick = () => show('p'); t2.onclick = () => show('c'); m._show = show;
      show(tab === 'clan' ? 'c' : 'p')
    })
  }

  function profileTab(box) {
    const me = S.me || {}; let avatar = me.avatar_path || null;
    const top = el('div', 'so-me'), pic = el('div', 'so-pic');
    const drawPic = () => pic.replaceChildren(face(avatar, nick.value || me.nick, 88, 'big'));
    const nick = inp(me.nick, 'например, Ilia_NQ', 20), bio = area(me.bio, 'Пара слов о себе: инструменты, стиль, цели', 300);
    const up = fileBtn('Загрузить фото', async f => { avatar = await upload(f, 'avatar', 256); drawPic(); toast('Фото загружено, сохраните профиль') });
    const rm = el('button', 's', 'Убрать фото'); rm.type = 'button'; rm.onclick = () => { avatar = null; drawPic() };
    const side = el('div', 'so-pic-side'); side.append(up, rm, el('small', 'mu', 'Любая картинка. Обрежется в квадрат 256×256.'));
    top.append(pic, side); nick.oninput = drawPic; drawPic();
    const links = el('div', 'so-links'), rows = [];
    const addRow = (l, u) => {
      if (rows.length >= 5) return toast('Не больше 5 ссылок');
      const r = el('div', 'so-link'), a = inp(l, 'подпись', 24), b = inp(u, 'https://…', 200), d = el('button', 's', '×'); d.type = 'button';
      d.setAttribute('aria-label', 'Убрать ссылку'); const row = { a, b, r }; d.onclick = () => { rows.splice(rows.indexOf(row), 1); r.remove() };
      r.append(a, b, d); rows.push(row); links.append(r)
    };
    (me.links || []).forEach(x => addRow(x.label, x.url));
    const more = el('button', 's', '＋ Ссылка'); more.type = 'button'; more.onclick = () => addRow('', 'https://');
    const save = el('button', 'p', 'Сохранить профиль'); save.type = 'button';
    save.onclick = () => busy(save, async () => {
      const ls = rows.map(x => ({ label: x.a.value.trim(), url: x.b.value.trim() })).filter(x => x.url && x.url !== 'https://');
      const old = me.avatar_path;
      S.me = await rpc('save_profile', { nick: nick.value.trim(), bio: bio.value.trim(), links: ls, avatar_path: avatar });
      if (old && old !== avatar) dropFile(old);
      refreshNav(); toast('Профиль сохранён'); profileTab(box)
    });
    const card = el('div', 'so-card so-preview'); card.append(el('span', 'mu', 'Так вас видят другие:'));
    const pv = el('div', 'so-row'); pv.append(face(me.avatar_path, me.nick, 40), nameLine(me.nick, me.clan)); card.append(pv);
    if (me.bio) card.append(el('p', null, me.bio));
    if ((me.links || []).length) { const lw = el('div', 'so-chips'); me.links.forEach(x => { const a = el('a', null, x.label || x.url.replace(/^https:\/\//, '')); a.href = x.url; a.target = '_blank'; a.rel = 'noopener nofollow'; lw.append(a) }); card.append(lw) }
    box.replaceChildren(top, field('Ник', nick, 'От 3 до 20 знаков: буквы, цифры, _ . -'), field('О себе', bio), el('span', 'so-lbl', 'Ссылки'), links, more, el('div', 'bar', ''), save, me.nick ? card : el('div', 'mu so-gap', 'Ник нужен, чтобы вступить в клан или создать свой.'));
  }

  // ---------------------------------------------------------------- clan
  async function clanTab(box, m) {
    const me = S.me || {};
    if (!me.nick) { const b = el('button', 'p', 'Заполнить профиль'); b.type = 'button'; b.onclick = () => m._show('p'); box.replaceChildren(el('p', 'mu', 'Чтобы создать клан или вступить в него, сначала сохраните ник в профиле.'), b); return }
    const clan = await rpc('my_clan');
    if (!clan) return noClan(box, m);
    const lead = clan.my_role === 'leader', staff = lead || clan.my_role === 'officer';
    const head = el('div', 'so-clan-head'); head.style.setProperty('--cc', clan.color);
    const em = clan.emblem_path ? face(clan.emblem_path, clan.tag, 64, 'em') : el('span', 'so-face em txt', clan.tag); em.style.setProperty('--s', '64px');
    const hx = el('div'); hx.append(el('h3', null, clan.name), nameLine(me.nick, clan), el('div', 'mu', 'Ваша роль: ' + ROLE[clan.my_role] + ' · участников: ' + clan.members.length));
    if (clan.description) hx.append(el('p', null, clan.description));
    head.append(em, hx);
    const parts = [head];
    // members
    const mem = el('div', 'so-card'); mem.append(el('h4', null, 'Участники'));
    clan.members.forEach(u => {
      const r = el('div', 'so-row so-member'); r.append(face(u.avatar_path, u.nick, 34), el('b', null, u.nick || 'удалённый'), el('span', 'so-role r-' + u.role, ROLE[u.role]));
      const acts = el('span', 'so-acts'), self = u.user_id === api().user.uid;
      const act = (label, fn, ask) => { const b = el('button', 's', label); b.type = 'button'; const run = () => busy(b, async () => { await fn(); m._show('c') }); if (ask) sure(b, label, ask, run); else b.onclick = run; acts.append(b) };
      if (lead && !self) {
        if (u.role === 'member') act('В офицеры', () => rpc('clan_set_role', { target: u.user_id, role: 'officer' }));
        if (u.role === 'officer') act('В участники', () => rpc('clan_set_role', { target: u.user_id, role: 'member' }));
        act('Передать главу', () => rpc('clan_set_role', { target: u.user_id, role: 'leader' }), 'Точно передать?');
      }
      if (!self && (lead || (clan.my_role === 'officer' && u.role === 'member'))) act('Исключить', () => rpc('clan_kick', { target: u.user_id }), 'Точно исключить?');
      r.append(acts); mem.append(r)
    });
    parts.push(mem);
    // chat
    parts.push(chat(m, staff));
    // invites and settings for staff
    if (staff) {
      const inv = el('div', 'so-card'); inv.append(el('h4', null, 'Приглашения'), el('p', 'mu', 'Отправьте код человеку: он вводит его во вкладке «Клан».'));
      const list = el('div'), days = inp('7', null, 2), uses = inp('10', null, 3); days.type = uses.type = 'number'; days.min = 1; days.max = 30; uses.min = 1; uses.max = 100;
      const mk = el('button', 'p', 'Создать код'); mk.type = 'button';
      const drawInv = async () => {
        const a = await rpc('clan_invites_list'); list.replaceChildren();
        if (!a.length) list.append(el('div', 'mu', 'Активных кодов нет'));
        a.forEach(i => {
          const r = el('div', 'so-row so-inv'), c = el('code', null, i.code), cp = el('button', 's', 'Копировать'), rv = el('button', 's', 'Отозвать'); cp.type = rv.type = 'button';
          cp.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(i.code) : Promise.reject()).then(() => toast('Код скопирован'), () => toast(i.code)) };
          rv.onclick = () => busy(rv, async () => { await rpc('clan_revoke_invite', { code: i.code }); await drawInv() });
          r.append(c, el('span', 'mu', i.uses + ' из ' + i.max_uses + ' · до ' + new Date(i.expires_at).toLocaleDateString('ru-RU')), cp, rv); list.append(r)
        })
      };
      mk.onclick = () => busy(mk, async () => { await rpc('clan_create_invite', { days: +days.value || 7, max_uses: +uses.value || 10 }); await drawInv() });
      const f = el('div', 'bar'); f.append(field('Дней', days), field('Использований', uses), mk); inv.append(f, list); parts.push(inv);
      drawInv().catch(e => list.replaceChildren(el('div', 'mu', e.message)));
      // settings
      const st = el('div', 'so-card'); st.append(el('h4', null, 'Оформление клана'));
      let emblem = null; const nm = inp(clan.name, null, 32), ds = area(clan.description, 'О чём клан, правила, время сессий', 500), col = el('input'); col.type = 'color'; col.value = clan.color; col.className = 'so-color';
      const epv = el('span'); const drawEm = () => { const e = emblem === '' ? null : emblem || clan.emblem_path; epv.replaceChildren(e ? face(e, clan.tag, 40) : el('span', 'mu', 'без эмблемы')) };
      drawEm();
      const eu = fileBtn('Загрузить эмблему', async fl => { emblem = await upload(fl, 'emblem', 256); drawEm() }), er = el('button', 's', 'Убрать'); er.type = 'button'; er.onclick = () => { emblem = ''; drawEm() };
      const sv = el('button', 'p', 'Сохранить клан'); sv.type = 'button';
      sv.onclick = () => busy(sv, async () => {
        await rpc('update_clan', { name: nm.value.trim(), description: ds.value.trim(), color: col.value, emblem_path: emblem });
        if (emblem !== null && clan.emblem_path) dropFile(clan.emblem_path);
        toast('Клан сохранён'); m._show('c')
      });
      const er2 = el('div', 'bar'); er2.append(epv, eu, er);
      st.append(field('Название', nm), field('Описание', ds), field('Цвет тега', col), el('span', 'so-lbl', 'Эмблема'), er2, sv); parts.push(st);
    }
    // leave / disband
    const out = el('div', 'bar so-out'), lv = el('button', 's', 'Покинуть клан'); lv.type = 'button';
    sure(lv, 'Покинуть клан', lead && clan.members.length > 1 ? 'Глава перейдёт другому. Точно?' : 'Точно покинуть?', () => busy(lv, async () => { await rpc('clan_leave'); toast('Вы вышли из клана'); m._show('c') }));
    out.append(lv);
    if (lead) { const db = el('button', 's', 'Распустить клан'); db.type = 'button'; sure(db, 'Распустить клан', 'Чат и коды удалятся. Точно?', () => busy(db, async () => { await rpc('clan_disband'); toast('Клан распущен'); m._show('c') })); out.append(db) }
    parts.push(out);
    box.replaceChildren(...parts)
  }

  function noClan(box, m) {
    const join = el('div', 'so-card'), code = inp('', 'КОД ИЗ 10 ЗНАКОВ', 10), look = el('button', 's', 'Проверить'), pv = el('div'); look.type = 'button';
    code.className = 'so-code'; code.oninput = () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); pv.replaceChildren() };
    look.onclick = () => busy(look, async () => {
      const c = await rpc('clan_preview', { code: code.value });
      if (!c) { pv.replaceChildren(el('div', 'mu', ERR.invite_invalid)); return }
      const r = el('div', 'so-row'); r.append(c.emblem_path ? face(c.emblem_path, c.tag, 40) : el('span', null, ''), tagChip(c), el('b', null, c.name), el('span', 'mu', 'участников: ' + c.members));
      const go = el('button', 'p', 'Вступить'); go.type = 'button'; go.onclick = () => busy(go, async () => { await rpc('clan_join', { code: code.value }); toast('Вы в клане [' + c.tag + ']'); m._show('c') });
      pv.replaceChildren(r); if (c.description) pv.append(el('p', 'mu', c.description)); pv.append(go)
    });
    const jr = el('div', 'bar'); jr.append(code, look); join.append(el('h4', null, 'Вступить по коду'), el('p', 'mu', 'Код даёт глава или офицер клана.'), jr, pv);
    const mk = el('div', 'so-card'), tag = inp('', 'NQ', 5), nm = inp('', 'Название клана', 32), col = el('input'), ds = area('', 'О чём клан (необязательно)', 500);
    col.type = 'color'; col.value = '#7c3aed'; col.className = 'so-color'; tag.className = 'so-code'; tag.oninput = () => { tag.value = tag.value.toUpperCase().replace(/[^A-Z0-9]/g, '') };
    const go = el('button', 'p', 'Создать клан'); go.type = 'button';
    go.onclick = () => busy(go, async () => { await rpc('create_clan', { tag: tag.value, name: nm.value.trim(), description: ds.value.trim(), color: col.value }); toast('Клан создан'); m._show('c') });
    const row = el('div', 'bar'); row.append(field('Тег', tag, '2–5 латинских букв или цифр'), field('Цвет тега', col));
    mk.append(el('h4', null, 'Создать свой клан'), row, field('Название', nm), field('Описание', ds), go);
    box.replaceChildren(el('p', 'mu', 'Клан — группа трейдеров с общим тегом и чатом. Можно состоять только в одном клане.'), join, mk)
  }

  function chat(m, staff) {
    const w = el('div', 'so-card so-chat'), list = el('div', 'so-msgs'), t = inp('', 'Сообщение клану', 1000), send = el('button', 'p', 'Отправить'), more = el('button', 's', 'Раньше');
    send.type = more.type = 'button'; list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'polite');
    let last = 0, first = 0;
    const line = x => {
      const r = el('div', 'so-msg' + (x.mine ? ' mine' : '')); r.dataset.id = x.id;
      const h = el('div', 'so-msg-h'); h.append(face(x.avatar_path, x.nick, 22), el('b', null, x.nick || 'удалённый'), el('time', 'mu', new Date(x.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
      const del = el('button', 'so-del', '×'); del.type = 'button'; del.title = 'Удалить сообщение'; del.setAttribute('aria-label', 'Удалить сообщение');
      del.onclick = () => busy(del, async () => { await rpc('clan_delete_message', { id: x.id }); r.remove() }); if (x.mine || staff) h.append(del);
      r.append(h, el('p', null, x.body)); return r
    };
    const add = (a, older) => {
      const atEnd = !last || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      const rows = a.slice().reverse().map(line);
      if (older) list.prepend(...rows); else list.append(...rows);
      a.forEach(x => { last = Math.max(last, x.id); first = first ? Math.min(first, x.id) : x.id });
      if (!older && atEnd) list.scrollTop = list.scrollHeight;
      if (older) more.hidden = a.length < 50
    };
    const pull = async () => { const a = await rpc('clan_messages', { after_id: last || null }); if (a.length) add(a) };
    rpc('clan_messages', {}).then(a => { if (!a.length) list.append(el('div', 'mu so-empty', 'Сообщений пока нет. Напишите первым.')); else { list.replaceChildren(); add(a) } more.hidden = a.length < 50 }).catch(e => list.replaceChildren(el('div', 'mu', e.message)));
    more.onclick = () => busy(more, async () => add(await rpc('clan_messages', { before_id: first }), true));
    const go = () => { const v = t.value.trim(); if (!v) return; busy(send, async () => { await rpc('clan_send', { body: v }); t.value = ''; const e = list.querySelector('.so-empty'); if (e) e.remove(); await pull() }) };
    send.onclick = go; t.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } };
    m._poll = setInterval(() => { if (!w.isConnected) { clearInterval(m._poll); return } if (document.visibilityState === 'visible') pull().catch(() => {}) }, 5000);
    const f = el('div', 'so-send'); f.append(t, send);
    w.append(el('h4', null, 'Чат клана'), more, list, f); more.hidden = true; return w
  }

  // ---------------------------------------------------------------- hooks into the account UI
  function refreshNav() {
    const b = document.querySelector('#nav .account-nav'); if (!b || !S.me) return;
    const me = S.me, i = b.querySelector('i');
    if (me.nick) { const t = 'Аккаунт · ' + (me.clan ? '[' + me.clan.tag + '] ' : '') + me.nick; b.title = t; b.setAttribute('aria-label', t) }
    if (i && me.avatar_path && !i.querySelector('.so-face')) i.replaceChildren(face(me.avatar_path, me.nick, 26, 'nav'))
  }
  function hook() {
    const A = api(); if (!A || A._social) return; A._social = 1;
    const up = A.updateNav, op = A.openProfile;
    A.updateNav = function () { const r = up.apply(this, arguments); if (!this.user) S.me = null; else if (S.me) refreshNav(); else if (ok() && !S.loading) S.loading = load().catch(() => {}).finally(() => { S.loading = null }); return r };
    A.openProfile = function () {
      const r = op.apply(this, arguments), mds = document.querySelectorAll('.auth-modal .md'), md = mds[mds.length - 1];
      if (md && ok()) {
        const box = el('div', 'so-entry'), b = el('button', 'p', '👤 Профиль и кланы'); b.type = 'button';
        b.onclick = () => { md.closest('.ov').remove(); open() };
        if (S.me && S.me.nick) box.append(face(S.me.avatar_path, S.me.nick, 34), nameLine(S.me.nick, S.me.clan));
        box.append(b); const h = md.querySelector('h3'); h ? h.after(box) : md.prepend(box)
      }
      return r
    };
    if (A.user) A.updateNav()
  }
  window.SOCIAL = { open, load, get me() { return S.me } };
  hook()
})();
