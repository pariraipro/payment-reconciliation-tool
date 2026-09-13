import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMoney,parseCSV,suggestMapping,normalizeReport,reconcile,exportResults,toCSV,sum} from '../dist/engine.mjs';
import {getDemo} from '../dist/sample.mjs';
const order=(id='A',amount=100000,refund=0)=>({id,amount,refund,customer:'Test'});
const payment=(extra={})=>({id:'p1',orderId:'A',amount:100000,status:'captured',rawStatus:'captured',refund:0,fee:2000,...extra});
function report(text,kind){const p=parseCSV(text);return normalizeReport(p,kind,suggestMapping(p.headers,kind));}
test('split payments reconcile gross; fees reduce only net',()=>{
 const r=reconcile([order()],[payment({amount:60000,fee:1200}),payment({id:'p2',amount:40000,fee:800})]);
 assert.equal(r.rows[0].matched,true);assert.equal(r.summary.net,98000);assert.equal(r.rows[0].difference,0);
});
test('one-paisa overpayment stays visible',()=>{const r=reconcile([order('A',10010)],[payment({amount:6005,fee:0}),payment({id:'p2',amount:4006,fee:1})]);assert.equal(r.rows[0].difference,1);assert.deepEqual(r.rows[0].issues,['amount']);});
test('refund comparison is separate and unknown refunds need review',()=>{
 const p=payment({refund:20000});let r=reconcile([order('A',100000,20000)],[p]);assert.equal(r.rows[0].matched,true);assert.equal(r.summary.net,78000);
 r=reconcile([order('A',100000,15000)],[p]);assert.deepEqual(r.rows[0].issues,['refund']);
 r=reconcile([order('A',100000,null)],[p]);assert.deepEqual(r.rows[0].issues,['refund_review']);
 r=reconcile([order('A',100000,null)],[payment()]);assert.deepEqual(r.rows[0].issues,['refund_review']);
 r=reconcile([order()],[payment({refund:null})]);assert.ok(r.rows[0].issues.includes('incomplete'));assert.equal(r.summary.net,null);
});
test('exact order IDs preserve case and zero prefixes; pending and failed are excluded',()=>{
 const r=reconcile([order('Ab01',50000)],[payment({orderId:'ab01',amount:50000}),payment({id:'p2',orderId:'Ab01',amount:50000,status:'pending',fee:0}),payment({id:'p3',orderId:'Ab01',amount:50000,status:'failed',fee:0})]);
 assert.equal(r.summary.captured,50000);assert.equal(r.summary.orphans,1);assert.equal(r.summary.failed,1);assert.deepEqual(r.rows.find(r=>r.id==='Ab01').issues,['pending']);
 assert.equal(report('order_id,amount,refund_amount\n001,100,0','orders')[0].id,'001');
});
test('matching capture does not hide an additional pending or unknown payment',()=>{
 let r=reconcile([order()],[payment(),payment({id:'p2',status:'pending',fee:0})]);assert.deepEqual(r.rows[0].issues,['pending']);assert.equal(r.summary.matched,0);
 r=reconcile([order()],[payment(),payment({id:'p2',status:'unknown',fee:0})]);assert.ok(r.rows[0].issues.includes('unknown'));assert.equal(r.summary.net,null);
 const normalized=report('transaction_id,order_id,amount,status,fee,refund_amount\np1,A,100,constructor,0,0','payments');assert.equal(normalized[0].status,'unknown');
});
test('duplicate snapshots and duplicate orders are rejected with both record numbers',()=>{
 assert.throws(()=>report('transaction_id,order_id,amount,status\np1,A,100,pending\np1,A,100,captured','payments'),/records 2 and 3/);
 assert.throws(()=>report('order_id,amount\nA,100\nA,100','orders'),/Duplicate ID/);
});
test('CSV parses BOM, embedded commas, newlines and doubled quotes; bad widths fail',()=>{
 const p=parseCSV('\uFEFForder_id,amount,customer\r\nA,"1,000.50","Asha, \"\"shop\"\"\nMumbai"\r\n');assert.equal(p.rows[0][2],'Asha, "shop"\nMumbai');assert.equal(report(toCSV([p.headers,...p.rows]),'orders')[0].amount,100050);
 assert.throws(()=>parseCSV('id,amount\nA,1,2'),/fields/);assert.throws(()=>parseCSV('id,amount\nA,"12'),/unclosed/);assert.throws(()=>parseCSV('id,ID\nA,1'),/unique/);
});
test('strict currency and amount validation rejects malformed and excessive precision',()=>{
 assert.equal(parseMoney('₹ 1,23,456.78'),12345678);assert.equal(parseMoney('INR 123,456.78'),12345678);assert.equal(parseMoney('0.01'),1);
 for(const x of ['1.001','-20','1e3','1,2,3','NaN','$12',''])assert.throws(()=>parseMoney(x));
 assert.throws(()=>report('order_id,amount,currency\nA,100,USD','orders'),/INR/);
 assert.throws(()=>report('transaction_id,order_id,amount,status,refund_amount\np1,A,100,paid,101','payments'),/refund cannot exceed/);
 assert.throws(()=>sum([Number.MAX_SAFE_INTEGER,1]),/safe/);
});
test('refunded statuses retain original capture, and failed fees remain counted',()=>{
 const ps=report('transaction_id,order_id,amount,status,fee,refund_amount\np1,A,100,refunded,2,100\np2,A,50,failed,1,0','payments');
 const r=reconcile([order('A',10000,10000)],ps);assert.equal(r.rows[0].matched,true);assert.equal(r.summary.captured,10000);assert.equal(r.summary.net,-300);
});
test('missing payment, orphan, and unknown fees cannot disappear into totals',()=>{
 const r=reconcile([order()],[payment({orderId:'B',fee:null})]);assert.equal(r.summary.review,2);assert.equal(r.summary.net,null);assert.ok(r.rows.find(r=>r.id==='A').issues.includes('missing'));assert.deepEqual(r.rows.find(r=>r.id==='B').issues,['orphan','incomplete']);
});
test('CSV export escapes formula cells and includes all issues and review notes',()=>{
 const r=reconcile([order('=CMD()')],[]);const csv=exportResults(r,new Set(['=CMD()']));assert.ok(csv.includes('"\'=CMD()"'));assert.ok(csv.includes('"Yes"'));assert.ok(csv.includes('Missing payment'));
 const cells=parseCSV(toCSV([['a','b'],['=1+1','hello,"world"']]));assert.equal(cells.rows[0][0],"'=1+1");assert.equal(cells.rows[0][1],'hello,"world"');
});
test('demo totals and row totals agree exactly',()=>{
 const d=getDemo(),r=reconcile(d.orders,d.payments);assert.equal(r.summary.matched,12);assert.equal(r.summary.review,5);assert.equal(r.summary.expected,3979200);assert.equal(r.summary.captured,3109300);assert.equal(r.summary.net,2976714);
 assert.equal(sum(r.rows.map(r=>r.captured)),r.summary.captured);assert.equal(sum(r.rows.map(r=>r.net)),r.summary.net);
});
