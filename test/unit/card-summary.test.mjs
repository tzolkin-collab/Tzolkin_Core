import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeProject} from '../../apps/web/public/card-summary.js';
test('project cards derive technical counts without inventing deployment health',()=>{
 const binding={provider:'vercel',target_id:'app',environment:'production',branch:'main'};
 const summary=summarizeProject({components:[{stack:'nextjs',bindings:[binding,binding]},{stack:'custom',bindings:[]}],issues:['missing source']});
 assert.deepEqual(summary,{services:2,targets:1,environments:['production'],stacks:['nextjs'],branches:['main'],issues:1});
 assert.equal('healthy' in summary,false);
});
test('empty drafts do not acquire fictitious stacks or destinations',()=>{
 assert.deepEqual(summarizeProject({}),{services:0,targets:0,environments:[],stacks:[],branches:[],issues:0});
});
