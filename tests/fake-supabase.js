// Test double for vendor/supabase.js. The "database" lives in sessionStorage so
// it survives page reloads inside one test; the session lives in localStorage
// under an "sb-" key, exactly where the real client keeps it.
(function(){
  const blank={row:null,access:{status:'trial',until:'2026-11-25T09:02:42Z'},files:{},calls:[]};
  const load=()=>JSON.parse(sessionStorage.getItem('__fakedb')||JSON.stringify(blank));
  const save=db=>sessionStorage.setItem('__fakedb',JSON.stringify(db));
  const session=()=>{const raw=localStorage.getItem('sb-journal-auth');return raw?JSON.parse(raw):null};
  const client={
    auth:{
      async getSession(){return {data:{session:session()},error:null}},
      async signInWithOAuth(options){const db=load();db.calls.push(['oauth',options]);save(db);localStorage.setItem('sb-journal-auth',JSON.stringify({user:{id:'uid-1',email:'tester@example.com'}}));return {data:{},error:null}},
      async signOut(options){const db=load();db.calls.push(['signOut',options]);save(db);localStorage.removeItem('sb-journal-auth');return {error:null}}
    },
    from(){return {select(){return this},eq(){return this},async maybeSingle(){const db=load();return {data:db.row?{state:db.row.state,rev:db.row.rev}:null,error:null}}}},
    async rpc(name,args){
      const db=load();
      if(name==='my_access')return {data:db.access,error:null};
      if(name==='register_device'){db.calls.push(['register_device',args]);save(db);return {data:db.access,error:null}}
      if(name.startsWith('admin_')){
        if(db.access.status!=='admin')return {data:null,error:{code:'42501',message:'forbidden'}};
        db.calls.push([name,args||null]);save(db);
        if(name==='admin_list_users')return {data:db.users||[],error:null};
        if(name==='admin_blocked_domains')return {data:db.domains||[],error:null};
        return {data:null,error:null}
      }
      if(name==='save_state'){
        if(db.access.status==='expired')return {data:null,error:{code:'42501',message:'subscription_required'}};
        if(db.row&&db.row.rev!==args.expected_rev)return {data:null,error:{code:'40001',message:'rev_conflict'}};
        db.row={state:args.new_state,rev:db.row?db.row.rev+1:1};db.calls.push(['save',db.row.rev]);save(db);
        return {data:db.row.rev,error:null}
      }
      // profile and clans (migration 0003), just enough for the UI flow
      const so=db.social=db.social||{profile:null,clan:null,invites:[],msgs:[],n:0};
      const ok=data=>{save(db);db.calls.push([name,args||null]);save(db);return {data,error:null}};
      const fail=message=>({data:null,error:{code:'P0001',message}});
      const me=()=>Object.assign({user_id:'uid-1',nick:null,avatar_path:null,bio:'',links:[]},so.profile||{},{clan:so.clan?{id:'c1',tag:so.clan.tag,name:so.clan.name,color:so.clan.color,emblem_path:so.clan.emblem_path||null,role:'leader'}:null});
      const clan=()=>so.clan?Object.assign({id:'c1',my_role:'leader',created_at:'2026-11-11T10:00:00Z',members:[{user_id:'uid-1',nick:so.profile.nick,avatar_path:so.profile.avatar_path,role:'leader',joined_at:'2026-11-11T10:00:00Z'}]},so.clan):null;
      if(name==='my_profile')return ok(me());
      if(name==='save_profile'){if(!/^[\wА-Яа-яЁёІіЇїЄєҐґ.-]{3,20}$/.test(args.nick||''))return fail('nick_invalid');so.profile={nick:args.nick,bio:args.bio||'',links:args.links||[],avatar_path:args.avatar_path||null};return ok(me())}
      if(name==='my_clan')return ok(clan());
      if(name==='create_clan'){if(!so.profile)return fail('nick_required');if(so.clan)return fail('already_in_clan');if(!/^[A-Z0-9]{2,5}$/.test(args.tag||''))return fail('tag_invalid');so.clan={tag:args.tag,name:args.name,description:args.description||'',color:args.color||'#0a0a0b'};return ok(clan())}
      if(name==='update_clan'){Object.keys(args).forEach(k=>{if(args[k]!==null&&args[k]!==undefined)so.clan[k]=args[k]===''?null:args[k]});return ok(clan())}
      if(name==='clan_create_invite'){const code='INVITE'+String(1000+so.invites.length);so.invites.push({code,expires_at:'2026-11-18T10:00:00Z',max_uses:args.max_uses,uses:0});return ok(code)}
      if(name==='clan_invites_list')return ok(so.invites);
      if(name==='clan_revoke_invite'){so.invites=so.invites.filter(i=>i.code!==args.code);return ok(null)}
      if(name==='clan_preview')return ok(args.code==='GOODCODE01'?{tag:'ZED',name:'Zed Squad',description:'',color:'#112233',emblem_path:null,members:3}:null);
      if(name==='clan_send'){so.n++;so.msgs.push({id:so.n,user_id:'uid-1',nick:so.profile.nick,avatar_path:null,body:args.body,created_at:'2026-11-11T10:0'+so.n+':00Z',mine:true});return ok(so.n)}
      if(name==='clan_messages'){const a=so.msgs.filter(m=>m.id>(args.after_id||0)&&m.id<(args.before_id||1e9)).slice().reverse();return ok(a)}
      if(name==='clan_leave'){so.clan=null;so.msgs=[];return ok(null)}
      return {data:null,error:{message:'unknown rpc '+name}}
    },
    storage:{from(){return {
      async upload(path,blob){const db=load();if(db.access.status==='expired')return {data:null,error:{message:'denied'}};const url=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});db.files[path]=url;save(db);return {data:{path},error:null}},
      async list(prefix,opts){const db=load();db.calls.push(['list',prefix]);save(db);return {data:Object.keys(db.files).filter(k=>k.startsWith(prefix+'/')).map(k=>({name:k.slice(prefix.length+1)})),error:null}},
      getPublicUrl(path){const db=load();return {data:{publicUrl:db.files[path]||''}}},
      async remove(paths){const db=load();paths.forEach(p=>delete db.files[p]);db.calls.push(['remove',paths]);save(db);return {data:null,error:null}},
      async download(path){const db=load();if(!db.files[path])return {data:null,error:{message:'not found'}};return {data:await(await fetch(db.files[path])).blob(),error:null}}
    }}}
  };
  window.supabase={createClient(){window.__fakeArgs=Array.from(arguments);return client}};
})();
