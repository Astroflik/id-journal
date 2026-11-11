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
    base = 'http://127.0.0.1:%d/journal.html' % server.server_address[1]
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
            page.route('**/*', route)
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
        page.evaluate('accountApi.openProfile()')
        check('expired: profile says so', page.locator('.auth-modal', has_text='Доступ закончился').count() == 1)
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

        check('no uncaught page errors', not errors, errors)
        browser.close()
    server.shutdown()
    print('ALL PASS (%d checks)' % len(results) if all(results) else 'FAILED: %d of %d' % (results.count(False), len(results)))
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
