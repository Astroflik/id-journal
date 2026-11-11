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
    message_invalid: 'Пустое или слишком длинное сообщение', slow_down: 'Слишком часто, подождите минуту',
    name_taken: 'Такое название клана уже занято', discord_invalid: 'Discord: имя пользователя из латинских букв, цифр, _ и .',
    telegram_invalid: 'Telegram: имя пользователя от 5 знаков, без @', tiktok_invalid: 'TikTok: имя пользователя без @',
    details_invalid: 'Опишите подробнее: от 5 до 2000 знаков', evidence_invalid: 'Не удалось прикрепить фото', too_many_files: 'Не больше 4 фото',
    too_many_reports: 'Не больше 10 жалоб в сутки', cannot_report_self: 'Нельзя пожаловаться на себя', user_not_found: 'Пользователь не найден',
    category_invalid: 'Выберите причину', reason_invalid: 'Причина: от 3 до 300 знаков', cannot_ban_admin: 'Админа заблокировать нельзя',
    days_invalid: 'Срок от 1 до 3650 дней', forbidden: 'Нужны права администратора'
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
    top.append(pic, side); const nickHint = el('small', 'so-avail'); nick.oninput = () => { drawPic(); checkName(nick, 'nick', nickHint, me.nick) }; drawPic();
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
      const nso = { discord: dc.value.trim(), telegram: tg.value.trim(), tiktok: tt.value.trim() }, oso = me.socials || {};
      if (['discord', 'telegram', 'tiktok'].some(k => (nso[k] || '') !== (oso[k] || ''))) S.me = await rpc('save_socials', nso);
      if (old && old !== avatar) dropFile(old);
      refreshNav(); toast('Профиль сохранён'); profileTab(box)
    });
    const card = el('div', 'so-card so-preview'); card.append(el('span', 'mu', 'Так вас видят другие:'));
    const pv = el('div', 'so-row'); pv.append(face(me.avatar_path, me.nick, 40), nameLine(me.nick, me.clan)); card.append(pv);
    if (me.bio) card.append(el('p', null, me.bio));
    const sc = socialChips(me.socials); if (sc) card.append(sc);
    if ((me.links || []).length) { const lw = el('div', 'so-chips'); me.links.forEach(x => { const a = el('a', null, x.label || x.url.replace(/^https:\/\//, '')); a.href = x.url; a.target = '_blank'; a.rel = 'noopener nofollow'; lw.append(a) }); card.append(lw) }
    const nf = field('Ник', nick, 'От 3 до 20 знаков: буквы, цифры, _ . -. Ник уникален: похожие на чужой (другой регистр, 0 вместо O, русские буквы вместо латинских) не принимаются.'); nf.append(nickHint);
    const so = me.socials || {}, dc = inp(so.discord, 'имя в Discord', 40), tg = inp(so.telegram, '@имя или ссылка t.me', 64), tt = inp(so.tiktok, '@имя или ссылка tiktok.com', 80);
    const soc = el('div', 'so-socials'); soc.append(field('Discord', dc), field('Telegram', tg), field('TikTok', tt));
    box.replaceChildren(top, nf, field('О себе', bio), el('span', 'so-lbl', 'Соцсети'), soc, el('span', 'so-lbl', 'Другие ссылки'), links, more, el('div', 'bar', ''), save, me.nick ? card : el('div', 'mu so-gap', 'Ник нужен, чтобы вступить в клан или создать свой.'));
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
      const r = el('div', 'so-row so-member'); r.append(face(u.avatar_path, u.nick, 34), nickBtn(u.user_id, u.nick), el('span', 'so-role r-' + u.role, ROLE[u.role]));
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
          r.append(c, el('span', 'mu', i.uses + ' из ' + i.max_uses + ' · до ' + new Date(i.expires_at).toLocaleDateString((window.I18N&&I18N.lang()==='en')?'en-GB':'ru-RU')), cp, rv); list.append(r)
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
    col.type = 'color'; col.value = '#7c3aed'; col.className = 'so-color'; tag.className = 'so-code'; const tagHint = el('small', 'so-avail'), nmHint = el('small', 'so-avail');
    tag.oninput = () => { tag.value = tag.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); checkName(tag, 'clan_tag', tagHint) }; nm.oninput = () => checkName(nm, 'clan_name', nmHint);
    const go = el('button', 'p', 'Создать клан'); go.type = 'button';
    go.onclick = () => busy(go, async () => { await rpc('create_clan', { tag: tag.value, name: nm.value.trim(), description: ds.value.trim(), color: col.value }); toast('Клан создан'); m._show('c') });
    const tf = field('Тег', tag, '2–5 латинских букв или цифр'); tf.append(tagHint); const row = el('div', 'bar'); row.append(tf, field('Цвет тега', col));
    const nmf = field('Название', nm, 'Название и тег уникальны, похожие на чужие не принимаются'); nmf.append(nmHint);
    mk.append(el('h4', null, 'Создать свой клан'), row, nmf, field('Описание', ds), go);
    box.replaceChildren(el('p', 'mu', 'Клан — группа трейдеров с общим тегом и чатом. Можно состоять только в одном клане.'), join, mk)
  }

  function chat(m, staff) {
    const w = el('div', 'so-card so-chat'), list = el('div', 'so-msgs'), t = inp('', 'Сообщение клану', 1000), send = el('button', 'p', 'Отправить'), more = el('button', 's', 'Раньше');
    send.type = more.type = 'button'; list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'polite');
    let last = 0, first = 0;
    const line = x => {
      const r = el('div', 'so-msg' + (x.mine ? ' mine' : '')); r.dataset.id = x.id;
      const h = el('div', 'so-msg-h'); h.append(face(x.avatar_path, x.nick, 22), nickBtn(x.user_id, x.nick), el('time', 'mu', new Date(x.created_at).toLocaleString((window.I18N&&I18N.lang()==='en')?'en-GB':'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
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

  // ---------------------------------------------------------------- names, socials, public card (stage 3)
  // live "free / taken" hint; look-alikes count as taken (server folds them the same way)
  function checkName(input, kind, hint, own) {
    clearTimeout(input._ct); hint.textContent = ''; hint.className = 'so-avail';
    const v = input.value.trim(); if (v.length < 2 || (own && v === own)) return;
    input._ct = setTimeout(async () => {
      try { const free = await rpc('name_available', { kind, value: v }); if (input.value.trim() !== v) return;
        hint.textContent = free ? 'Свободно' : (kind === 'nick' ? 'Занят: такой или очень похожий ник уже есть' : 'Занято: такое или очень похожее уже есть'); hint.classList.add(free ? 'ok' : 'bad') } catch (e) { }
    }, 450)
  }
  const SOC = { discord: ['Discord', null], telegram: ['Telegram', u => 'https://t.me/' + u], tiktok: ['TikTok', u => 'https://www.tiktok.com/@' + u] };
  function socialChips(so) {
    if (!so || !Object.keys(SOC).some(k => so[k])) return null;
    const w = el('div', 'so-chips so-soc');
    Object.keys(SOC).forEach(k => {
      const v = so[k]; if (!v) return; const [label, href] = SOC[k];
      if (href) { const a = el('a', 'so-s-' + k, label + ' · ' + v); a.href = href(v); a.target = '_blank'; a.rel = 'noopener nofollow'; w.append(a) }
      else { const b = el('button', 'so-s-' + k, label + ' · ' + v); b.type = 'button'; b.title = 'Скопировать имя'; b.onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('Имя Discord скопировано'), () => toast(v)); w.append(b) }
    });
    return w
  }
  function nickBtn(uid, nick) {
    if (!uid || !nick) return el('b', null, nick || 'удалённый');
    const b = el('button', 'so-nick', nick); b.type = 'button'; b.title = 'Открыть профиль'; b.onclick = e => { e.stopPropagation(); openCard(uid) }; return b
  }
  const isAdmin = () => !!(api().access && api().access.status === 'admin');
  async function openCard(uid) {
    let p; try { p = await rpc('get_profile', { target: uid }) } catch (e) { return toast(e.message) }
    if (!p) return toast('Профиль не найден');
    modal((m, close) => {
      m.classList.add('so-md', 'so-card-md');
      const top = el('div', 'so-row'); top.append(face(p.avatar_path, p.nick, 64, 'big'), nameLine(p.nick, p.clan));
      const x = el('button', 's', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Закрыть'); x.onclick = close; top.append(x); m.append(top);
      if (p.clan) m.append(el('div', 'mu', 'Клан «' + p.clan.name + '» · ' + (ROLE[p.clan.role] || '')));
      if (p.bio) m.append(el('p', null, p.bio));
      const sc = socialChips(p.socials); if (sc) m.append(sc);
      if ((p.links || []).length) { const lw = el('div', 'so-chips'); p.links.forEach(l => { const a = el('a', null, l.label || l.url.replace(/^https:\/\//, '')); a.href = l.url; a.target = '_blank'; a.rel = 'noopener nofollow'; lw.append(a) }); m.append(lw) }
      const bar = el('div', 'bar'), self = uid === api().user.uid;
      if (!self) { const r = el('button', 's', 'Пожаловаться'); r.type = 'button'; r.onclick = () => { close(); report('user', uid, p.nick) }; bar.append(r) }
      if (isAdmin() && !self) {
        const bn = el('button', 's', 'Заблокировать'); bn.type = 'button'; bn.onclick = () => { close(); banForm(uid, p.nick) };
        const rn = el('button', 's', 'Сбросить ник'); rn.type = 'button'; sure(rn, 'Сбросить ник', 'Точно сбросить?', () => busy(rn, async () => { const n = await rpc('admin_reset_nick', { target: uid }); toast('Ник сброшен: ' + n); close() }));
        bar.append(bn, rn)
      }
      m.append(bar)
    })
  }

  // ---------------------------------------------------------------- reports (stage 4)
  const CAT_USER = [['spam', 'Спам или реклама'], ['abuse', 'Оскорбления'], ['scam', 'Мошенничество'], ['impersonation', 'Выдаёт себя за другого'], ['cheating', 'Подделка результатов'], ['other', 'Другое']];
  const CAT_BUG = [['bug_ui', 'Экран или кнопки'], ['bug_data', 'Неверные цифры или статистика'], ['bug_sync', 'Синхронизация, пропали данные'], ['bug_payment', 'Оплата и подписка'], ['bug_other', 'Другое']];
  const CATS = Object.fromEntries(CAT_USER.concat(CAT_BUG));
  const rbucket = () => api().sb.storage.from('reports');
  // screenshot as evidence: longest side up to 1600 px, webp, under 2 MB
  async function shrink(file) {
    const src = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось прочитать изображение')); i.src = src });
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k)); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      for (const q of [.86, .72, .55]) { const b = await new Promise(r => cv.toBlob(r, 'image/webp', q)); if (b && b.size < 2e6) return b }
      throw new Error('Изображение слишком большое')
    } finally { URL.revokeObjectURL(src) }
  }
  function report(kind, target, nick) {
    if (!ok()) return toast('Жалобы доступны после входа в аккаунт');
    modal((m, close) => {
      m.classList.add('so-md', 'so-report');
      m.append(el('h3', null, kind === 'user' ? 'Жалоба на ' + (nick || 'пользователя') : 'Сообщить об ошибке'));
      const cat = el('select'); (kind === 'user' ? CAT_USER : CAT_BUG).forEach(([v, l]) => { const o = el('option', null, l); o.value = v; cat.append(o) });
      const det = area('', kind === 'user' ? 'Что произошло? Где и когда?' : 'Что делали, что ожидали и что получилось', 2000); det.rows = 5;
      const files = [], thumbs = el('div', 'so-thumbs');
      const drawThumbs = () => { thumbs.replaceChildren(...files.map((f, i) => { const t = el('span', 'so-thumb'), im = el('img'); im.alt = 'Скриншот ' + (i + 1); im.src = f.url; const d = el('button', null, '×'); d.type = 'button'; d.setAttribute('aria-label', 'Убрать скриншот'); d.onclick = () => { URL.revokeObjectURL(f.url); files.splice(i, 1); drawThumbs() }; t.append(im, d); return t })) };
      const add = fileBtn('Прикрепить скриншот', async f => { if (files.length >= 4) return toast(ERR.too_many_files); const b = await shrink(f); files.push({ blob: b, url: URL.createObjectURL(b) }); drawThumbs() });
      const send = el('button', 'p', 'Отправить'), x = el('button', 's', 'Отмена'); send.type = x.type = 'button'; x.onclick = close;
      send.onclick = () => busy(send, async () => {
        if (det.value.trim().length < 5) throw new Error(ERR.details_invalid);
        const paths = [];
        for (const f of files) { const path = api().user.uid + '/report-' + Date.now().toString(36) + '-' + paths.length + '.webp'; const { error } = await rbucket().upload(path, f.blob, { contentType: 'image/webp', upsert: false }); if (error) throw new Error(api().describe(error)); paths.push(path) }
        await rpc('submit_report', { kind, category: cat.value, details: det.value.trim(), target: target || null, page: kind === 'bug' ? String(typeof view !== 'undefined' ? view : '') : '', evidence: paths });
        files.forEach(f => URL.revokeObjectURL(f.url)); close(); toast(kind === 'user' ? 'Жалоба отправлена. Админ её рассмотрит.' : 'Спасибо! Ошибка отправлена админу.')
      });
      const bar = el('div', 'bar'); bar.append(send, x);
      m.append(field('Причина', cat), field('Подробности', det), el('span', 'so-lbl', 'Фото-доказательства (до 4)'), add, thumbs, bar)
    })
  }
  async function myReports() {
    let a; try { a = await rpc('my_reports') } catch (e) { return toast(e.message) }
    modal((m, close) => {
      m.classList.add('so-md'); const h = el('div', 'bar'), x = el('button', 's', '✕ Закрыть'); x.type = 'button'; x.onclick = close; h.append(el('h3', null, 'Мои жалобы и ошибки'), x); m.append(h);
      if (!a.length) m.append(el('p', 'mu', 'Вы ещё ничего не отправляли.'));
      const ST = { open: 'на рассмотрении', resolved: 'решено', rejected: 'отклонено' };
      a.forEach(r => { const c = el('div', 'so-card'); c.append(el('b', null, (r.kind === 'user' ? 'Жалоба на ' + (r.target_nick || '—') : 'Ошибка') + ' · ' + (CATS[r.category] || r.category)), el('div', 'mu', new Date(r.created_at).toLocaleString((window.I18N&&I18N.lang()==='en')?'en-GB':'ru-RU') + ' · ' + (ST[r.status] || r.status))); if (r.admin_note) c.append(el('p', null, 'Ответ админа: ' + r.admin_note)); m.append(c) })
    })
  }

  // ---------------------------------------------------------------- admin moderation (stage 4)
  function banForm(uid, nick, after) {
    modal((m, close) => {
      m.classList.add('so-md'); m.append(el('h3', null, 'Заблокировать ' + (nick || 'пользователя')), el('p', 'mu', 'Журнал станет только для просмотра, профиль, клан и чат закроются для записи. Причину человек увидит.'));
      const r = inp('', 'Причина, например: спам в чате кланов', 300), d = el('select');
      [['1', '1 день'], ['7', '7 дней'], ['30', '30 дней'], ['365', '1 год'], ['', 'Бессрочно']].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; d.append(o) }); d.value = '7';
      const go = el('button', 'p', 'Заблокировать'), x = el('button', 's', 'Отмена'); go.type = x.type = 'button'; x.onclick = close;
      go.onclick = () => busy(go, async () => { await rpc('admin_ban', { target: uid, reason: r.value.trim(), days: d.value ? +d.value : null }); toast('Пользователь заблокирован'); close(); if (after) after() });
      const bar = el('div', 'bar'); bar.append(go, x); m.append(field('Причина', r), field('Срок', d), bar)
    })
  }
  async function moderation(box) {
    const tabs = el('div', 'so-tabs'), body = el('div'), T = ['Жалобы', 'Ошибки', 'Решённые', 'Блокировки'].map(t => { const b = el('button', null, t); b.type = 'button'; return b });
    tabs.append(...T); box.replaceChildren(el('h3', null, 'Модерация'), tabs, body);
    const ST = { open: 'открыта', resolved: 'решена', rejected: 'отклонена' };
    const show = async k => {
      T.forEach((b, i) => b.classList.toggle('on', i === k)); body.replaceChildren(el('div', 'mu', 'Загрузка…'));
      try {
        if (k === 3) {
          const a = await rpc('admin_bans'); body.replaceChildren(); if (!a.length) body.append(el('p', 'mu', 'Блокировок нет.'));
          a.forEach(b => { const c = el('div', 'so-card'), u = el('button', 's', 'Разблокировать'); u.type = 'button'; u.onclick = () => busy(u, async () => { await rpc('admin_unban', { target: b.user_id }); toast('Разблокирован'); show(3) });
            c.append(el('b', null, (b.nick || '—') + ' · ' + (b.email || '')), el('div', 'mu', (b.active ? 'действует' : 'истекла') + (b.until ? ' · до ' + new Date(b.until).toLocaleString((window.I18N&&I18N.lang()==='en')?'en-GB':'ru-RU') : ' · бессрочно')), el('p', null, b.reason), u); body.append(c) });
          return
        }
        const all = await rpc('admin_reports', { status: k === 2 ? 'all' : 'open', lim: 200 });
        const a = all.filter(r => k === 2 ? r.status !== 'open' : r.kind === (k === 0 ? 'user' : 'bug'));
        body.replaceChildren(); if (!a.length) body.append(el('p', 'mu', 'Пусто.'));
        for (const r of a) {
          const c = el('div', 'so-card so-rep');
          const who = el('div', 'so-row'); who.append(el('b', null, CATS[r.category] || r.category), el('span', 'mu', '#' + r.id + ' · ' + new Date(r.created_at).toLocaleString((window.I18N&&I18N.lang()==='en')?'en-GB':'ru-RU') + ' · ' + ST[r.status]));
          c.append(who, el('div', 'mu', 'От: ' + (r.reporter_nick || '—') + ' (' + (r.reporter_email || '—') + ')'));
          if (r.target) { const t = el('div', 'so-row'); t.append(el('span', 'mu', 'На: '), nickBtn(r.target, r.target_nick || r.target_email), el('span', 'mu', '· жалоб на него: ' + r.target_reports + (r.target_banned ? ' · заблокирован' : ''))); c.append(t) }
          if (r.page) c.append(el('div', 'mu', 'Экран: ' + r.page));
          c.append(el('p', null, r.details));
          if ((r.evidence || []).length) {
            const th = el('div', 'so-thumbs'); c.append(th);
            rbucket().createSignedUrls(r.evidence, 600).then(({ data }) => (data || []).forEach(d => { if (!d.signedUrl) return; const a2 = el('a', 'so-thumb'), im = el('img'); a2.href = d.signedUrl; a2.target = '_blank'; a2.rel = 'noopener'; im.src = d.signedUrl; im.alt = 'Доказательство'; a2.append(im); th.append(a2) })).catch(() => th.append(el('span', 'mu', 'Фото не загрузились')))
          }
          if (r.admin_note) c.append(el('div', 'mu', 'Заметка: ' + r.admin_note));
          const note = inp('', 'Заметка (увидит автор)', 1000), bar = el('div', 'bar');
          const act = (label, st) => { const b = el('button', st === 'resolved' ? 'p' : 's', label); b.type = 'button'; b.onclick = () => busy(b, async () => { await rpc('admin_resolve_report', { id: r.id, status: st, note: note.value.trim() }); show(k) }); bar.append(b) };
          if (r.status === 'open') { act('Решено', 'resolved'); act('Отклонить', 'rejected') } else act('Вернуть в работу', 'open');
          if (r.target && !r.target_banned) { const bn = el('button', 's', 'Заблокировать'); bn.type = 'button'; bn.onclick = () => banForm(r.target, r.target_nick, () => show(k)); bar.append(bn) }
          c.append(note, bar); body.append(c)
        }
      } catch (e) { body.replaceChildren(el('p', 'mu', e.message)) }
    };
    T.forEach((b, i) => { b.onclick = () => show(i) }); show(0)
  }

  // ---------------------------------------------------------------- chat button (always visible when signed in)
  const D = { el: null, btn: null, last: 0, t: 0 };
  // kept in IndexedDB like other per-device flags: localStorage is synced with the journal
  try { mget('so-chat-seen').then(v => { D.last = Math.max(D.last, +v || 0) }).catch(() => { }) } catch (e) { }
  function chatButton() {
    if (D.btn) return D.btn;
    const qa = document.querySelector('.quick-actions'); if (!qa) return null;
    const b = el('button', 's float chat'); b.title = 'Чат клана'; b.setAttribute('aria-label', 'Чат клана'); b.hidden = true;
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/></svg><i class="dot" hidden></i>';
    b.onclick = toggleChat; qa.prepend(b); D.btn = b; return b
  }
  function closeChat() { if (D.el) { D.el.remove(); D.el = null } if (D.btn) D.btn.classList.remove('on') }
  async function toggleChat() {
    if (D.el) return closeChat();
    const w = el('aside', 'so-drawer'), head = el('div', 'bar'), x = el('button', 's', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Закрыть чат'); x.onclick = closeChat;
    w.setAttribute('aria-label', 'Чат клана'); D.el = w; D.btn.classList.add('on'); document.body.append(w);
    const holder = { _poll: 0 }, body = el('div', 'so-dbody');
    head.append(el('h3', null, 'Чат клана'), x); w.append(head, body); body.append(el('div', 'mu', 'Загрузка…'));
    try {
      await load(); const me = S.me || {};
      if (!me.nick || !me.clan) {
        const go = el('button', 'p', me.nick ? 'Вступить или создать клан' : 'Заполнить профиль'); go.type = 'button'; go.onclick = () => { closeChat(); open(me.nick ? 'clan' : 'profile') };
        body.replaceChildren(el('p', 'mu', me.nick ? 'Вы пока не в клане. Чат появится, когда вступите в клан.' : 'Чтобы писать в чат, сохраните ник и вступите в клан.'), go); return
      }
      const c = chat(holder, ['leader', 'officer'].includes(me.clan.role)); body.replaceChildren(c);
      const obs = new MutationObserver(() => { if (!w.isConnected) { clearInterval(holder._poll); obs.disconnect(); return } const ids = [...c.querySelectorAll('.so-msg')].map(r => +r.dataset.id); if (ids.length) seen(Math.max(...ids)) });
      obs.observe(c, { childList: true, subtree: true }); obs.observe(document.body, { childList: true });
      const big = el('button', 's', 'Открыть клан'); big.type = 'button'; big.onclick = () => { closeChat(); open('clan') }; head.insertBefore(big, x)
    } catch (e) { body.replaceChildren(el('div', 'mu', e.message)) }
  }
  function seen(id) { if (id > D.last) { D.last = id; try { mput('so-chat-seen', id) } catch (e) { } } if (D.btn) D.btn.querySelector('.dot').hidden = true }
  // unread dot: one light poll a minute while the tab is visible and the drawer is closed
  async function unread() {
    if (!D.btn || D.el || !S.me || !S.me.clan || document.visibilityState !== 'visible') return;
    try { const a = await rpc('clan_messages', { after_id: D.last || null, lim: 5 }); D.btn.querySelector('.dot').hidden = !a.some(x => !x.mine) } catch (e) { }
  }
  function syncChat() { const b = chatButton(); if (!b) return; b.hidden = !ok(); if (!ok()) closeChat(); if (!D.t) D.t = setInterval(unread, 60000) }

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
    A.updateNav = function () { const r = up.apply(this, arguments); if (!this.user) S.me = null; else if (S.me) refreshNav(); else if (ok() && !S.loading) S.loading = load().then(() => unread()).catch(() => {}).finally(() => { S.loading = null }); syncChat(); return r };
    const oa = A.openAdmin; A.openAdmin = function () { const r = oa.apply(this, arguments), mds = document.querySelectorAll('.admin-md'), md = mds[mds.length - 1]; if (md) { const box = el('div', 'so-mod'); md.append(box); moderation(box) } return r };
    A.openProfile = function () {
      const r = op.apply(this, arguments), mds = document.querySelectorAll('.auth-modal .md'), md = mds[mds.length - 1];
      if (md && ok()) {
        const box = el('div', 'so-entry'), b = el('button', 'p', '👤 Профиль и кланы'); b.type = 'button';
        b.onclick = () => { md.closest('.ov').remove(); open() };
        if (S.me && S.me.nick) box.append(face(S.me.avatar_path, S.me.nick, 34), nameLine(S.me.nick, S.me.clan));
        const bug = el('button', 's', 'Сообщить об ошибке'), mine = el('button', 's', 'Мои жалобы'); bug.type = mine.type = 'button';
        bug.onclick = () => { md.closest('.ov').remove(); report('bug') }; mine.onclick = () => { md.closest('.ov').remove(); myReports() };
        box.append(b, bug, mine); const h = md.querySelector('h3'); h ? h.after(box) : md.prepend(box)
      }
      return r
    };
    if (A.user) A.updateNav()
  }
  window.SOCIAL = { open, load, openCard, report, myReports, toggleChat, get me() { return S.me } };
  hook()
})();
