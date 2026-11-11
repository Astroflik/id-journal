#!/usr/bin/env python3
"""Browser smoke test for the Supabase account layer in public/app.js.

Serves public/ locally, swaps vendor/supabase.js for tests/fake-supabase.js and
drives the real page in headless Chrome. No network and no real account needed.

Run:  python3 tests/sync_smoke.py        (needs: pip install playwright, Chrome)
"""
import functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAKE = open(os.path.join(ROOT, 'tests', 'fake-supabase.js'), encoding='utf-8').read()
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
results = []


def check(name, ok, detail=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=os.path.join(ROOT, 'public'))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    server = serve()
    base = 'http://127.0.0.1:%d/app/index.html' % server.server_address[1]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)

        def new_page(errors):
            context = browser.new_context()
            page = context.new_page()

            def route(r):
                url = r.request.url
                if '/vendor/supabase.js' in url:
                    r.fulfill(body=FAKE, content_type='application/javascript')
                elif url.startswith('http://127.0.0.1') or url.startswith('data:') or url.startswith('blob:'):
                    r.continue_()
                else:
                    r.abort()
            context.route('**/*', route)
            page.on('pageerror', lambda e: errors.append(str(e)))
            return page

        def boot(page, url=base, signed_in=True):
            page.goto(url)
            page.wait_for_function('accountApi.online===true' + ('&&(accountApi.enabled||accountApi.readOnly)' if signed_in else ''), timeout=10000)
            page.wait_for_function('ready===true', timeout=10000)

        db = lambda page: page.evaluate("JSON.parse(sessionStorage.getItem('__fakedb')||'null')")
        set_db = lambda page, value: page.evaluate("v=>sessionStorage.setItem('__fakedb',JSON.stringify(v))", value)
        ids = lambda text: sorted(x['id'] for x in json.loads(text))
        errors = []

        # 1. first sign-in: a full local journal (left by the Firebase version) goes up to the cloud
        page = new_page(errors)
        boot(page, signed_in=False)
        page.evaluate("""()=>{localStorage.setItem('jt',JSON.stringify([{id:'A',date:'2026-11-10',res:'Тейк',rr:2}]));
          localStorage.setItem('jp','[]');localStorage.setItem('jdirty','old-firebase-uid')}""")
        page.evaluate('accountApi.openAuth()')
        check('auth modal: Google button, no password field',
              page.locator('.auth-modal button', has_text='Войти через Google').count() == 1 and page.locator('.auth-modal input').count() == 0)
        page.locator('.auth-modal button', has_text='Войти через Google').click()
        page.wait_for_function("!!localStorage.getItem('sb-journal-auth')")
        call = db(page)['calls'][0]
        check('OAuth call: google, returns to this page',
              call[0] == 'oauth' and call[1]['provider'] == 'google' and call[1]['options']['redirectTo'] == base, call)
        args = page.evaluate('window.__fakeArgs')
        check('client options: PKCE and sb- storage key',
              args[2]['auth']['flowType'] == 'pkce' and args[2]['auth']['storageKey'].startswith('sb-'), args[2])
        boot(page)
        d = db(page)
        check('first sign-in uploads the local journal', d['row'] and d['row']['rev'] == 1 and ids(d['row']['state']['jt']) == ['A'], d['row'])
        check('session token and jdirty never reach the cloud state',
              not any(k.startswith('sb-') or k in ('jdirty', 'jowner') for k in d['row']['state']), list(d['row']['state']))
        check('device is marked with its owner', page.evaluate("localStorage.getItem('jowner')") == 'uid-1')
        check('backup snapshot has no session token', not any(k.startswith('sb-') for k in page.evaluate('Object.keys(accountApi.snapshot())')))
        check('access status is read', page.evaluate('accountApi.access.status') == 'trial')
        page.wait_for_function("JSON.parse(sessionStorage.getItem('__fakedb')).calls.some(c=>c[0]==='register_device')", timeout=5000)
        regs = [c[1] for c in db(page)['calls'] if c[0] == 'register_device']
        check('device registered once with a SHA-256 hex hash', len(regs) == 1 and len(regs[0]['hash']) == 64 and all(ch in '0123456789abcdef' for ch in regs[0]['hash']), regs)
        check('auth/profile link to privacy policy', page.evaluate("(()=>{accountApi.openProfile();const a=document.querySelector('.auth-modal a[href=\"../privacy.html\"]');document.querySelectorAll('.ov').forEach(o=>o.remove());return !!a})()"))
        check('banner shows trial end date', page.locator('.acc-banner', has_text='Пробный период до 25.11.2026').count() == 1)
        check('trial: write buttons visible', page.evaluate("(()=>{const b=el('button','p','＋ Сделка 1');document.body.append(b);const v=getComputedStyle(b).display!=='none';b.remove();return v})()"))

        # 2. ordinary save bumps rev and clears the dirty flag
        page.evaluate("store.save('trades',{id:'B',date:'2026-11-11',res:'Стоп'},true)")
        d = db(page)
        check('save: rev 2 with both trades', d['row']['rev'] == 2 and ids(d['row']['state']['jt']) == ['A', 'B'], d['row'])
        check('save: dirty flag cleared', page.evaluate("localStorage.getItem('jdirty')") is None)

        # 3. conflict: another device saved trade C first; this device then adds D
        d['row']['state']['jt'] = json.dumps(json.loads(d['row']['state']['jt']) + [{'id': 'C', 'date': '2026-11-11', 'res': 'BE'}])
        d['row']['rev'] = 3
        set_db(page, d)
        page.evaluate("store.save('trades',{id:'D',date:'2026-11-11',res:'Тейк',rr:1},true)")
        d = db(page)
        check('conflict: merged, nothing lost', d['row']['rev'] == 4 and ids(d['row']['state']['jt']) == ['A', 'B', 'C', 'D'], d['row'])
        check('conflict: this device now shows all four', sorted(page.evaluate('T.map(t=>t.id)')) == ['A', 'B', 'C', 'D'])
        check('conflict: still signed in after merge', page.evaluate("!!localStorage.getItem('sb-journal-auth')"))

        # 4. screenshots go to storage under <uid>/<id> and come back
        check('shot upload ok', page.evaluate("d=>SHOTS.put({id:'sabc1'},d)", PNG) is True)
        check('shot stored under the user folder', 'uid-1/sabc1' in db(page)['files'])
        back = page.evaluate("async()=>{SHOTS.mem.clear();await mput('shot:sabc1',null);return SHOTS.get({id:'sabc1'})}")
        check('shot downloads back', isinstance(back, str) and back.startswith('data:image/png'), back)
        check('shot with a path-like id is refused', page.evaluate("d=>SHOTS.put({id:'../x'},d)", PNG) is False and len(db(page)['files']) == 1)
        check('non-image data is not uploaded', page.evaluate("SHOTS.put({id:'sabc2'},'http://127.0.0.1/x')") is False and len(db(page)['files']) == 1)
        # old screenshots kept only in this browser are uploaded once
        page.evaluate("async d=>{await mput('shot:sold1',d);await mput('shots-uploaded:uid-1',0);T.push({id:'Z',shots:[{id:'sold1'},{id:'sabc1'}]});await accountApi.uploadOldShots();T.pop()}", PNG)
        check('old screenshot uploaded to the bucket', 'uid-1/sold1' in db(page)['files'] and len(db(page)['files']) == 2, list(db(page)['files']))
        n = len([c for c in db(page)['calls'] if c[0] == 'list'])
        page.evaluate("accountApi.uploadOldShots()")
        check('old screenshot upload runs only once', len([c for c in db(page)['calls'] if c[0] == 'list']) == n)
        page.evaluate("(()=>{const d=JSON.parse(sessionStorage.getItem('__fakedb'));delete d.files['uid-1/sold1'];sessionStorage.setItem('__fakedb',JSON.stringify(d))})()")

        # 4b. profile and clans (stage C)
        page.evaluate('accountApi.openProfile()')
        page.locator('.auth-modal button', has_text='Профиль и кланы').click()
        page.wait_for_selector('.so-md .so-me')
        check('social: profile tab opens', page.locator('.so-md .so-tabs button.on', has_text='Профиль').count() == 1)
        page.locator('.so-md label', has_text='Ник').locator('input').fill('Ilia_NQ')
        page.locator('.so-md button', has_text='Ссылка').click()
        page.locator('.so-md .so-link input').nth(1).fill('https://t.me/example')
        page.locator('.so-md button', has_text='Сохранить профиль').click()
        page.wait_for_selector('.so-md .so-preview')
        saved = [c for c in db(page)['calls'] if c[0] == 'save_profile']
        check('social: profile saved with nick and link', saved and saved[-1][1]['nick'] == 'Ilia_NQ' and saved[-1][1]['links'] == [{'label': '', 'url': 'https://t.me/example'}], saved)
        page.evaluate("d=>fetch(d).then(r=>r.blob()).then(b=>{const f=new File([b],'a.png',{type:'image/png'});const i=document.querySelector('.so-md .so-pic-side input[type=file]');const t=new DataTransfer();t.items.add(f);i.files=t.files;i.dispatchEvent(new Event('change'))})", PNG)
        page.wait_for_function("Object.keys(JSON.parse(sessionStorage.getItem('__fakedb')).files).some(k=>k.startsWith('uid-1/avatar-'))", timeout=10000)
        check('social: avatar is a square image in the user folder', page.evaluate("document.querySelector('.so-md .so-pic img')!==null"))
        page.locator('.so-md .so-tabs button', has_text='Клан').click()
        page.wait_for_selector('.so-md .so-card h4:has-text("Создать свой клан")')
        page.locator('.so-md .so-code').nth(0).fill('goodcode01')
        page.locator('.so-md button', has_text='Проверить').click()
        check('social: invite preview shows the clan', page.locator('.so-md .so-tag', has_text='[ZED]').count() == 1)
        tag = page.locator('.so-md .so-code').nth(1)
        tag.fill('alp-1')
        check('social: tag field keeps only latin letters and digits', tag.input_value() == 'ALP1')
        page.locator('.so-md label', has_text='Название').locator('input').fill('Alpha Flow')
        page.locator('.so-md button', has_text='Создать клан').click()
        page.wait_for_selector('.so-md .so-clan-head')
        check('social: clan created, tag next to nick', page.locator('.so-md .so-clan-head .so-tag', has_text='[ALP1]').count() == 1 and page.locator('.so-md .so-role.r-leader').count() == 1)
        page.locator('.so-md button', has_text='Создать код').click()
        page.wait_for_selector('.so-md .so-inv code')
        check('social: invite code listed', page.locator('.so-md .so-inv code').first.inner_text() == 'INVITE1000')
        page.locator('.so-send input').fill('Привет, клан')
        page.locator('.so-send input').press('Enter')
        page.wait_for_selector('.so-msg.mine')
        check('social: chat message shown', page.locator('.so-msg.mine p', has_text='Привет, клан').count() == 1)
        check('social: account button shows clan tag and nick', page.evaluate("document.querySelector('#nav .account-nav').title") == 'Аккаунт · [ALP1] Ilia_NQ')
        if os.environ.get('SOCIAL_SHOT'):
            page.set_viewport_size({'width': 1280, 'height': 1400}); page.wait_for_timeout(800); page.screenshot(path=os.environ['SOCIAL_SHOT'], full_page=True)
        page.evaluate("document.querySelectorAll('.ov').forEach(o=>o.remove())")

        # 5. profile shows the status; sign-out wipes this device
        page.evaluate('accountApi.openProfile()')
        check('profile shows trial end date', page.locator('.auth-modal', has_text='Пробный период до 25.11.2026').count() == 1)
        page.locator('.auth-modal button', has_text='Выйти из аккаунта').click()
        page.wait_for_function('accountApi.user===null')
        check('sign-out: device storage is empty', page.evaluate('localStorage.length') == 0)
        cloud = db(page)
        # sign-out does one last sync first, so rev moves from 4 to 5; the data must be the same four trades
        check('sign-out: cloud copy keeps all four trades', cloud['row']['rev'] == 5 and ids(cloud['row']['state']['jt']) == ['A', 'B', 'C', 'D'], cloud['row'])
        page.context.close()

        # 6. second device, clean: signs in and gets the cloud copy; the session survives restore()
        page = new_page(errors)
        boot(page, signed_in=False)
        set_db(page, cloud)
        page.evaluate("localStorage.setItem('sb-journal-auth',JSON.stringify({user:{id:'uid-1',email:'tester@example.com'}}))")
        boot(page)
        check('second device loads the cloud copy', sorted(page.evaluate('T.map(t=>t.id)')) == ['A', 'B', 'C', 'D'])
        check('second device: session survives restore', page.evaluate("!!localStorage.getItem('sb-journal-auth')"))
        check('second device: no write on plain load', db(page)['row']['rev'] == cloud['row']['rev'])
        page.wait_for_timeout(500)
        check('second device: registers its own device hash', len([c for c in db(page)['calls'] if c[0] == 'register_device']) == 2)

        # 7. unsynced local edits at startup (dirty) are merged with a newer cloud copy, not overwritten
        page.evaluate("""()=>{accountApi.enabled=false;const t=JSON.parse(localStorage.getItem('jt')).filter(x=>x.id!=='D');t.push({id:'E',res:'Стоп'});
          localStorage.setItem('jt',JSON.stringify(t));localStorage.setItem('jdirty','uid-1')}""")
        boot(page)
        d = db(page)
        check('dirty start: union of both sides', d['row']['rev'] == cloud['row']['rev'] + 1 and ids(d['row']['state']['jt']) == ['A', 'B', 'C', 'D', 'E'], d['row'])

        # 8. access ends mid-session: one message, writes blocked, reading and export still work
        d['access'] = {'status': 'expired', 'until': '2026-11-25T09:02:42Z'}
        set_db(page, d)
        msg = page.evaluate("store.save('trades',{id:'F',res:'Тейк'},true).then(()=>'saved',e=>e.message)")
        check('expired mid-session: save is refused', 'только для просмотра' in msg, msg)
        check('expired mid-session: read-only, sync stopped', page.evaluate('accountApi.readOnly&&!accountApi.enabled'))
        msg = page.evaluate("store.save('trades',{id:'G',res:'Тейк'},true).then(()=>'saved',e=>e.message)")
        check('expired: further edits blocked before touching data', 'только для просмотра' in msg and 'G' not in page.evaluate('T.map(t=>t.id)'), msg)
        check('expired: cloud copy unchanged', db(page)['row']['rev'] == d['row']['rev'])
        boot(page)
        check('expired at startup: journal opens read-only with data', page.evaluate('accountApi.readOnly') and len(page.evaluate('T')) >= 5)
        check('expired: export snapshot still works', 'jt' in page.evaluate('accountApi.snapshot()'))
        check('expired: banner explains read-only', page.locator('.acc-banner.bad', has_text='только для просмотра').count() == 1)
        hidden = page.evaluate("(()=>['＋ Сделка 1','Сохранить','Удалить','⬆ Импорт MT5 / ATAS','✎ Править','⬇ Резервная копия (JSON)'].map(t=>{const b=el('button','s',t);document.body.append(b);const h=getComputedStyle(b).display==='none';b.remove();return h}))()")
        check('expired: write buttons hidden, export stays', hidden == [True, True, True, True, True, False], hidden)
        d = db(page); d['access'] = {'status': 'expired', 'until': None, 'trial': 'denied_duplicate'}; set_db(page, d)
        boot(page)
        check('expired: banner gives the reason', page.locator('.acc-banner', has_text='уже использовала пробный период').count() == 1)
        page.evaluate('accountApi.openProfile()')
        check('expired: profile says so', page.locator('.auth-modal', has_text='Доступ закончился').count() == 1)
        check('non-admin: no admin button', page.locator('.auth-modal button', has_text='Админ-панель').count() == 0)

        # 8b. admin panel: list, signals, grant, two-step revoke, domains
        d = db(page); d['access'] = {'status': 'admin', 'until': None}
        d['users'] = [{'user_id': 'u2', 'email': 'b@x.com', 'has_access': True, 'trial_status': 'pending_review', 'trial_ends_at': None, 'paid_until': None, 'same_mailbox_accounts': 1, 'same_device_accounts': 0, 'last_sign_in_at': None, 'note': None}]
        d['domains'] = [{'domain': 'mailinator.com', 'note': None}]
        d['calls'] = []; set_db(page, d)
        boot(page)
        check('admin: no status banner', page.locator('.acc-banner').count() == 0)
        page.evaluate('accountApi.openProfile()')
        page.locator('.auth-modal button', has_text='Админ-панель').click()
        page.wait_for_selector('.admin-md td', timeout=5000)
        check('admin: user row with signals', page.locator('.admin-md tr', has_text='b@x.com').filter(has_text='тот же ящик: 1').count() == 1)
        check('admin: blocked domain listed', page.locator('.admin-md', has_text='mailinator.com').count() == 1)
        page.locator('.admin-md button', has_text='Выдать').click(); page.wait_for_timeout(300)
        page.locator('.admin-md button', has_text='Отозвать').click(); page.wait_for_timeout(300)
        calls = [c[0] for c in db(page)['calls']]
        check('admin: grant sent, revoke waits for confirmation', 'admin_grant' in calls and 'admin_revoke' not in calls, calls)
        g = [c[1] for c in db(page)['calls'] if c[0] == 'admin_grant'][0]
        check('admin: grant has target and days', g['target'] == 'u2' and g['days'] == 30, g)
        page.locator('.admin-md button', has_text='Точно отозвать?').click(); page.wait_for_timeout(300)
        check('admin: revoke after confirmation', 'admin_revoke' in [c[0] for c in db(page)['calls']])
        page.context.close()

        # 9. Google returned an error: clear message, clean address bar
        page = new_page(errors)
        boot(page, url=base + '?error=access_denied&error_description=User+denied+access', signed_in=False)
        check('OAuth error is shown', page.locator('.toast', has_text='Вход не выполнен: User denied access').count() >= 1)
        check('OAuth error is removed from the address', 'error' not in page.url, page.url)

        # 10. merge rules, directly
        r = page.evaluate("""()=>{const j=JSON.stringify,m=(b,l,r)=>JSON.parse(accountApi.mergeState(b&&{jt:j(b)},{jt:j(l)},{jt:j(r)}).jt).map(x=>x.id+(x.v||'')).sort().join(',');
          const A={id:'A'},B={id:'B'},A2={id:'A',v:2},A3={id:'A',v:3};
          return [m([A,B],[A,B],[A2,B]),m([A,B],[A],[A,B]),m([A,B],[A],[A2,B]),m([A],[A2],[A3]),m(null,[A],[B]),
            j(accountApi.mergeState({k:'1'},{k:'1'},{})),j(accountApi.mergeState(null,{'sb-x':'t',jdirty:'u',k:'1'},{}))]}""")
        check('merge: remote edit wins when local untouched', r[0] == 'A2,B', r[0])
        check('merge: local delete wins when remote untouched', r[1] == 'A', r[1])
        check('merge: delete vs edit keeps the edited record', r[2] == 'A2', r[2])
        check('merge: both edited the same record -> this device', r[3] == 'A2', r[3])
        check('merge: no base -> union', r[4] == 'A,B', r[4])
        check('merge: key removed remotely is removed', r[5] == '{}', r[5])
        check('merge: session keys are dropped', r[6] == '{"k":"1"}', r[6])
        r = page.evaluate("""()=>{const j=JSON.stringify;return JSON.parse(accountApi.mergeState(null,{jt:j([{id:'A'},{note:'no id'}])},{jt:j([{id:'B'}])}).jt).length}""")
        check('merge: a list with id-less records is kept whole, not thinned', r == 2, r)
        page.context.close()

        # 11. a journal left on this device by another account is not adopted by the next one
        page = new_page(errors)
        boot(page, signed_in=False)
        page.evaluate("""()=>{localStorage.setItem('jt',JSON.stringify([{id:'X',res:'Тейк'}]));localStorage.setItem('jp','[]');
          localStorage.setItem('jowner','someone-else');localStorage.setItem('sb-journal-auth',JSON.stringify({user:{id:'uid-1',email:'tester@example.com'}}))}""")
        page.goto(base)
        page.wait_for_function("accountApi.enabled&&localStorage.getItem('jowner')==='uid-1'", timeout=10000)
        check('foreign journal: not uploaded to the new account', db(page) is None or db(page)['row'] is None, db(page))
        check('foreign journal: removed from the screen', page.evaluate('T.length') == 0)
        check('owner mark stays out of sync and export', 'jowner' not in page.evaluate('accountApi.snapshot()'))
        page.context.close()


        # 12. intro on a fresh tab, skip opens the journal, no intro on reload; toggle buttons
        page = new_page(errors)
        boot(page, signed_in=False)
        page.evaluate("localStorage.setItem('sb-journal-auth',JSON.stringify({user:{id:'uid-1',email:'tester@example.com'}}))")
        tab = page.context.new_page()
        tab.on('pageerror', lambda e: errors.append(str(e)))
        tab.goto(base)
        tab.wait_for_selector('.intro .skip', timeout=10000)
        check('intro: shown on a fresh tab for a signed-in user', tab.evaluate("document.body.classList.contains('pre')"))
        tab.locator('.intro .skip').click()
        tab.wait_for_function("!document.body.classList.contains('pre')", timeout=5000)
        check('intro: skip opens the journal (no start menu)', tab.locator('.start').count() == 0)
        tab.reload(); tab.wait_for_function('ready===true&&accountApi.enabled', timeout=10000); tab.wait_for_timeout(600)
        check('intro: not shown again on reload', tab.locator('.intro').count() == 0 and not tab.evaluate("document.body.classList.contains('pre')"))
        check('intro: video visible in light motion mode', tab.evaluate("""(()=>{document.body.classList.add('mo-light');const o=el('div','intro'),v=el('video','ivid');o.append(v);document.body.append(o);const d=getComputedStyle(v).display;o.remove();return d!=='none'})()"""))
        look = tab.locator('.quick-actions button.float.look')
        look.click(); tab.wait_for_timeout(200)
        opened = tab.locator('.ov.look-ov').count()
        look.click(); tab.wait_for_timeout(200)
        check('appearance button opens and closes the panel', opened == 1 and tab.locator('.ov').count() == 0, opened)
        helpb = tab.locator('.quick-actions button.float.h')
        helpb.click(); tab.wait_for_timeout(200)
        opened = tab.locator('.guide').count()
        helpb.click(); tab.wait_for_timeout(200)
        check('help button opens and closes the guide', opened == 1 and tab.locator('.guide').count() == 0, opened)
        check('night look is the default', tab.evaluate("document.body.classList.contains('night')&&LOOK.style==='night'"))
        check('headings are split into 3D letters', tab.evaluate("document.querySelectorAll('#ttl .ch3').length>5&&document.querySelector('#ttl').getAttribute('aria-label')==='Journal by myIDgod'"))
        # 3D world: tabs are stations, the camera flies to them, content is untransformed at rest
        check('world: background canvas and stations are set up', tab.evaluate("!!document.querySelector('#sky')&&!!window.World&&!Fly.on"))
        tab.evaluate("go('stats')"); tab.wait_for_timeout(180)
        mid = tab.evaluate("[document.querySelector('#v').classList.contains('flying'),!!document.querySelector('#v').style.transform,document.querySelector('#v').hasAttribute('inert'),[...document.querySelectorAll('#v>*')].some(c=>/ -?[1-9][0-9]*([.][0-9]+)?px$/.test(getComputedStyle(c).translate))]")
        tab.wait_for_function("view==='stats'&&!World.flying()", timeout=4000)
        rest = tab.evaluate("(()=>{const v=document.querySelector('#v');return [v.classList.contains('flying'),v.style.transform,v.style.opacity,v.hasAttribute('inert'),World.current()]})()")
        check('world: flight projects the tab with depth for its widgets, then leaves everything untransformed', mid == [True, True, True, True] and rest == [False, '', '', False, 'stats'], [mid, rest])
        check('widgets keep no depth at rest (sharp text)', tab.evaluate("[...document.querySelectorAll('#v>*')].every(c=>getComputedStyle(c).translate==='none')"))
        tab.evaluate("go('journal')"); tab.wait_for_timeout(150); tab.evaluate("go('review')")
        tab.wait_for_function("!World.flying()", timeout=5000)
        check('world: a new click mid-flight retargets to the last tab', tab.evaluate("view==='review'&&World.current()==='review'&&document.querySelector('#nav .big.on').dataset.k==='review'&&document.querySelector('#nav .big.on').getAttribute('aria-current')==='page'"))
        tab.locator('#nav .dock-grip').focus(); tab.keyboard.press('ArrowLeft'); tab.wait_for_timeout(200)
        check('dock: arrow key on the grip docks the bar left and saves it', tab.evaluate("document.body.dataset.navPosition==='left'&&CFG.look.nav==='left'"))
        g = tab.locator('#nav .dock-grip').bounding_box(); vw = tab.viewport_size or {'width': 1280, 'height': 720}
        tab.mouse.move(g['x'] + g['width'] / 2, g['y'] + g['height'] / 2); tab.mouse.down()
        tab.mouse.move(vw['width'] / 2, vw['height'] / 2, steps=4); tab.mouse.move(vw['width'] - 20, vw['height'] / 2, steps=6)
        zones = tab.locator('.dock-zones i.on[data-e=right]').count(); tab.mouse.up(); tab.wait_for_timeout(200)
        check('dock: dragging the grip to the right edge docks it there', zones == 1 and tab.evaluate("document.body.dataset.navPosition==='right'&&CFG.look.nav==='right'&&!document.querySelector('.dock-zones')"), zones)
        tab.locator('#nav .dock-grip').focus(); tab.keyboard.press('ArrowUp'); tab.wait_for_timeout(150)
        check('quick buttons: briefing button sits in the same rail as appearance and help', tab.evaluate("['#brief-toggle','.float.look','.float.h','.float.mt'].every(s=>document.querySelector('.quick-actions '+s))&&!document.body.querySelector(':scope>#brief-toggle')"))
        check('quick buttons stand in one line', tab.evaluate("(()=>{const l=[...document.querySelectorAll('.quick-actions>button')].filter(b=>b.offsetWidth).map(b=>Math.round(b.getBoundingClientRect().left));return l.length>=4&&new Set(l).size===1})()"))
        clash = []
        for edge in ('top', 'bottom', 'left', 'right'):
            tab.evaluate("e=>{CFG.look=Object.assign({},CFG.look||{},{nav:e});applyLook()}", edge); tab.wait_for_timeout(900)
            clash.append([edge, tab.evaluate("(()=>{const a=document.querySelector('.nav').getBoundingClientRect(),b=document.querySelector('.quick-actions').getBoundingClientRect();return a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom})()")])
        check('quick buttons never overlap the tab bar at any dock edge', not any(c[1] for c in clash), clash)
        tab.evaluate("lookForm2()"); tab.wait_for_selector('.ov.look-ov', timeout=3000)
        check('appearance form has no transition-style setting (the camera flight replaced it)', tab.evaluate("!/Анимация переходов/.test(document.querySelector('.ov.look-ov').textContent)"))
        tab.evaluate("document.querySelector('.ov.look-ov').remove();CFG.look=Object.assign({},CFG.look||{},{nav:'top'});applyLook()"); tab.wait_for_timeout(300)
        mt = tab.locator('.quick-actions button.float.mt')
        mt.click(); tab.wait_for_timeout(300)
        off = tab.evaluate("[motion(),Fly.on,document.querySelector('.float.mt').getAttribute('aria-pressed')]")
        tab.evaluate("go('plan')")
        off.append(tab.evaluate("[view,World.flying(),document.querySelector('#v').style.transform]"))
        mt.click(); tab.wait_for_timeout(300)
        on = tab.evaluate("[motion(),Fly.on]")
        check('motion button turns animations off and back on (off = no flight)', off == ['off', False, 'false', ['plan', False, '']] and on == ['light', False], [off, on])
        check('any old look moves to night once', tab.evaluate("(()=>{const s=JSON.stringify(CFG.look);CFG.look={style:'mono'};applyLook();const a=LOOK.style;CFG.look.style='paper';applyLook();const b=LOOK.style;CFG.look=JSON.parse(s);applyLook();return a==='night'&&b==='paper'})()"))
        page.context.close()


        # 13. stages 3-4: chat button, name hints, socials, bug report, ban banner, moderation
        page = new_page(errors)
        boot(page, signed_in=False)
        page.evaluate("localStorage.setItem('sb-journal-auth',JSON.stringify({user:{id:'uid-1',email:'tester@example.com'}}));sessionStorage.setItem('intro-seen','1')")
        boot(page)
        page.wait_for_selector('.quick-actions .float.chat:not([hidden])', timeout=5000)
        check('chat button is visible when signed in', page.locator('.quick-actions .float.chat').is_visible())
        page.locator('.quick-actions .float.chat').click(); page.wait_for_selector('.so-drawer .so-dbody button', timeout=5000)
        check('chat drawer without a profile points to the profile', page.locator('.so-drawer button', has_text='Заполнить профиль').count() == 1)
        page.locator('.quick-actions .float.chat').click(); page.wait_for_timeout(200)
        check('chat button closes the drawer', page.locator('.so-drawer').count() == 0)
        page.evaluate("SOCIAL.open()"); page.wait_for_selector('.so-md .so-field input', timeout=5000)
        nick = page.locator('.so-md .so-field input').first
        nick.fill('taken'); page.wait_for_selector('.so-avail.bad', timeout=3000)
        check('taken nick is flagged while typing', 'Занят' in page.locator('.so-avail.bad').first.inner_text())
        nick.fill('Tester_NQ'); page.wait_for_selector('.so-avail.ok', timeout=3000)
        socials = page.locator('.so-socials input')
        socials.nth(0).fill('tester.d'); socials.nth(1).fill('@tester_tg')
        page.locator('.so-md button', has_text='Сохранить профиль').click()
        page.wait_for_selector('.so-soc a[href="https://t.me/tester_tg"]', timeout=5000)
        check('socials saved and shown as links', page.locator('.so-soc button', has_text='Discord · tester.d').count() == 1)
        page.evaluate("document.querySelectorAll('.ov').forEach(o=>o.remove())")
        page.locator('.quick-actions .float.chat').click(); page.wait_for_selector('.so-drawer .so-dbody button', timeout=5000)
        check('chat drawer without a clan offers to join one', page.locator('.so-drawer button', has_text='Вступить или создать клан').count() == 1)
        page.locator('.quick-actions .float.chat').click()
        page.evaluate("SOCIAL.report('bug')"); page.wait_for_selector('.so-report textarea', timeout=3000)
        page.locator('.so-report textarea').fill('stats screen shows wrong winrate')
        page.locator('.so-report button', has_text='Отправить').click(); page.wait_for_timeout(500)
        r = [c for c in db(page)['calls'] if c[0] == 'submit_report']
        check('bug report sent with category and page', len(r) == 1 and r[0][1]['kind'] == 'bug' and r[0][1]['category'] == 'bug_ui' and r[0][1]['target'] is None, r)
        page.evaluate("SOCIAL.openCard('uid-2')"); page.wait_for_selector('.so-card-md', timeout=3000)
        check('public card shows socials and a report button', page.locator('.so-card-md a[href="https://t.me/other_tg"]').count() == 1 and page.locator('.so-card-md button', has_text='Пожаловаться').count() == 1)
        page.evaluate("document.querySelectorAll('.ov').forEach(o=>o.remove())")
        d = db(page); d['access'] = {'status': 'banned', 'until': None, 'reason': 'spam in clan chat'}; set_db(page, d)
        boot(page)
        page.wait_for_selector('.acc-banner', timeout=5000)
        check('banned: banner shows the reason, journal read-only', 'spam in clan chat' in page.locator('.acc-banner').inner_text() and page.evaluate("accountApi.readOnly===true"))
        d = db(page); d['access'] = {'status': 'admin', 'until': None}; d['reports'] = [{'id': 7, 'kind': 'user', 'category': 'spam', 'details': 'spams chat', 'page': '', 'evidence': [], 'status': 'open', 'admin_note': '', 'created_at': '2026-11-11T10:00:00Z', 'reporter': 'uid-1', 'reporter_email': 'a@x.com', 'reporter_nick': 'A', 'target': 'uid-2', 'target_email': 'b@x.com', 'target_nick': 'Spammer', 'target_banned': False, 'target_reports': 3}]; set_db(page, d)
        boot(page)
        page.evaluate('accountApi.openAdmin()'); page.wait_for_selector('.so-mod .so-rep', timeout=5000)
        check('admin: moderation lists reports with the target', page.locator('.so-mod .so-rep', has_text='Spammer').count() == 1 and page.locator('.so-mod .so-rep button', has_text='Заблокировать').count() == 1)
        page.locator('.so-mod .so-rep button', has_text='Решено').click(); page.wait_for_timeout(300)
        check('admin: resolve report call', any(c[0] == 'admin_resolve_report' and c[1]['id'] == 7 for c in db(page)['calls']))
        page.context.close()

        check('no uncaught page errors', not errors, errors)
        browser.close()
    server.shutdown()
    print('ALL PASS (%d checks)' % len(results) if all(results) else 'FAILED: %d of %d' % (results.count(False), len(results)))
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
