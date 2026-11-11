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
      if(name==='save_state'){
        if(db.access.status==='expired')return {data:null,error:{code:'42501',message:'subscription_required'}};
        if(db.row&&db.row.rev!==args.expected_rev)return {data:null,error:{code:'40001',message:'rev_conflict'}};
        db.row={state:args.new_state,rev:db.row?db.row.rev+1:1};db.calls.push(['save',db.row.rev]);save(db);
        return {data:db.row.rev,error:null}
      }
      return {data:null,error:{message:'unknown rpc '+name}}
    },
    storage:{from(){return {
      async upload(path,blob){const db=load();if(db.access.status==='expired')return {data:null,error:{message:'denied'}};const url=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});db.files[path]=url;save(db);return {data:{path},error:null}},
      async download(path){const db=load();if(!db.files[path])return {data:null,error:{message:'not found'}};return {data:await(await fetch(db.files[path])).blob(),error:null}}
    }}}
  };
  window.supabase={createClient(){window.__fakeArgs=Array.from(arguments);return client}};
})();
