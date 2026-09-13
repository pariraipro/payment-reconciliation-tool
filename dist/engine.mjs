export const STATUSES = Object.freeze({captured:'captured',paid:'captured',success:'captured',successful:'captured',succeeded:'captured',completed:'captured',settled:'captured',refunded:'captured',partially_refunded:'captured',pending:'pending',authorized:'pending',authorised:'pending',processing:'pending',created:'pending',failed:'failed',cancelled:'failed',canceled:'failed',declined:'failed'});
export const LABELS = {orphan:'Unmatched payment',missing:'Missing payment',amount:'Amount mismatch',refund:'Refund mismatch',refund_review:'Refund to review',unknown:'Unknown status',pending:'Pending payment',incomplete:'Incomplete data',failed:'Failed payment'};
export const FIELDS = {orders:[['order_id','Order ID',true],['amount','Order amount',true],['customer','Customer',false],['date','Date',false],['refund_amount','Expected refund',false],['currency','Currency',false]],payments:[['transaction_id','Payment ID',true],['order_id','Order ID',true],['amount','Gross payment amount',true],['status','Payment status',true],['fee','Gateway fee',false],['refund_amount','Refunded amount',false],['date','Date',false],['currency','Currency',false]]};
export function parseMoney(value,label='Amount') {
  let text=String(value??'').trim().replace(/^(?:₹|INR)\s*/i,'').trim();
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(text)) throw Error(`${label} must be a non-negative INR amount with at most two decimals.`);
  text=text.replaceAll(',',''); const [whole,frac='']=text.split('.');
  const paise=Number(whole)*100+Number(frac.padEnd(2,'0'));
  if(!Number.isSafeInteger(paise)||paise>1e12)throw Error(`${label} exceeds the ₹10,00,00,00,000 limit.`);
  return paise;
}
export function parseCSV(text) {
  text=String(text).replace(/^\uFEFF/,'');
  if(text.length>5*1024*1024)throw Error('File is larger than 5 MB.');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  function field(){row.push(cell);cell='';closed=false;}
  function record(){field();if(row.some(x=>x.trim()!==''))rows.push(row);row=[];if(rows.length>20001)throw Error('Maximum 20,000 data rows per report.');}
  for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
    if(ch==='"'){if(cell||closed)throw Error('Unexpected quote in CSV. Quote the entire field.');quoted=true;}
    else if(ch===',')field();else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;record();}
    else if(closed){if(!/\s/.test(ch))throw Error('Unexpected text after a quoted CSV field.');}
    else cell+=ch;
  }
  if(quoted)throw Error('CSV contains an unclosed quoted field.');if(cell||row.length||closed)record();
  if(rows.length<2)throw Error('Include a header and at least one data row.');
  const headers=rows.shift().map(x=>x.trim());
  if(headers.some(x=>!x)||new Set(headers.map(x=>x.toLowerCase())).size!==headers.length)throw Error('Column names must be non-empty and unique.');
  for(let i=0;i<rows.length;i++)if(rows[i].length!==headers.length)throw Error(`Record ${i+2} has ${rows[i].length} fields; the header has ${headers.length}.`);
  return {headers,rows};
}
const aliases={order_id:['order_id','order id','orderid','merchant_order_id'],transaction_id:['transaction_id','payment_id','payment id','transaction id'],amount:['amount','order_amount','gross_amount','payment_amount','gross payment amount'],status:['status','payment_status','payment status'],refund_amount:['refund_amount','refunded_amount','expected_refund','refund amount'],fee:['fee','fees','gateway_fee','processing_fee'],customer:['customer','customer_name','name'],date:['date','created_at','payment_date','order_date'],currency:['currency','currency_code']};
export function suggestMapping(headers,kind){return Object.fromEntries(FIELDS[kind].map(([key])=>[key,headers.findIndex(h=>aliases[key].includes(h.trim().toLowerCase()))]));}
export function normalizeReport(parsed,kind,mapping) {
  if(!FIELDS[kind])throw Error('Unknown report type.');
  const used=Object.values(mapping).filter(v=>Number.isInteger(v)&&v>=0);
  if(new Set(used).size!==used.length)throw Error('Map each source column only once.');
  for(const[key,label,required]of FIELDS[kind]){const col=mapping[key];if(required&&(!Number.isInteger(col)||col<0||col>=parsed.headers.length))throw Error(`Choose a column for ${label}.`);}
  const seen=new Map();
  return parsed.rows.map((row,index)=>{
    const n=index+2;const get=k=>mapping[k]>=0?String(row[mapping[k]]??'').trim():'';
    const money=(k,required=false)=>get(k)===''&&!required?null:parseMoney(get(k),`Record ${n}: ${k}`);
    const id=get(kind==='orders'?'order_id':'transaction_id');
    if(!id)throw Error(`Record ${n}: ${kind==='orders'?'order':'payment'} ID is empty.`);
    if(seen.has(id))throw Error(`Duplicate ID “${id}” in records ${seen.get(id)} and ${n}. Keep one current snapshot per ID.`);seen.set(id,n);
    const currency=get('currency');if(mapping.currency>=0&&currency.toUpperCase()!=='INR')throw Error(`Record ${n}: currency must be INR.`);
    const amount=money('amount',true);const refund=money('refund_amount');
    if(refund!==null&&refund>amount)throw Error(`Record ${n}: refund cannot exceed the gross amount.`);
    const base={id,amount,refund,date:get('date'),record:n};
    if(kind==='orders')return {...base,customer:get('customer')};
    const orderId=get('order_id');if(!orderId)throw Error(`Record ${n}: order ID is empty.`);
    const rawStatus=get('status');if(!rawStatus)throw Error(`Record ${n}: payment status is empty.`);
    const statusKey=rawStatus.toLowerCase().replace(/[ -]+/g,'_');const status=Object.hasOwn(STATUSES,statusKey)?STATUSES[statusKey]:'unknown';const fee=money('fee');
    if((status==='pending'||status==='failed')&&refund>0)throw Error(`Record ${n}: a pending or failed payment cannot have a completed refund.`);
    return {...base,orderId,status,rawStatus,fee};
  });
}
export function sum(values){const total=values.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(total))throw Error('Combined amounts exceed safe calculation limits. Split your reports.');return total;}
export function reconcile(orders,payments) {
  const groups=new Map();for(const p of payments){if(!groups.has(p.orderId))groups.set(p.orderId,[]);groups.get(p.orderId).push(p);}
  const orderIds=new Set(orders.map(o=>o.id));
  const make=(order,id)=>{
    const list=groups.get(id)||[];const captured=list.filter(p=>p.status==='captured');const pending=list.filter(p=>p.status==='pending');const unknown=list.filter(p=>p.status==='unknown');const failed=list.filter(p=>p.status==='failed');
    const gross=sum(captured.map(p=>p.amount));const refund=captured.every(p=>p.refund!==null)?sum(captured.map(p=>p.refund)):null;
    // Unknown fees for any transaction make the net estimate incomplete; known non-capture fees still reduce net.
    const fees=list.every(p=>p.fee!==null)?sum(list.map(p=>p.fee)):null;
    const difference=order?gross-order.amount:null;const issues=[];
    if(!order)issues.push('orphan');
    if(order&&!captured.length&&order.amount>0&&!pending.length&&!unknown.length)issues.push('missing');
    else if(order&&difference!==0&&captured.length)issues.push('amount');
    if(unknown.length)issues.push('unknown');
    if(pending.length)issues.push('pending');
    if(refund===null||fees===null)issues.push('incomplete');
    if(order&&refund!==null){if(order.refund!==null&&order.refund!==refund)issues.push('refund');else if(order.refund===null)issues.push('refund_review');}
    return {id,order,payments:list,captured:gross,refund,fees,difference,net:refund===null||fees===null||unknown.length?null:gross-refund-fees,issues,status:issues[0]||'matched',matched:issues.length===0,pendingCount:pending.length,failedCount:failed.length};
  };
  const rows=[...orders.map(o=>make(o,o.id)),...[...groups.keys()].filter(id=>!orderIds.has(id)).map(id=>make(null,id))];
  rows.sort((a,b)=>Number(a.matched)-Number(b.matched)||a.id.localeCompare(b.id));
  const capturedPayments=payments.filter(p=>p.status==='captured');
  const gross=sum(capturedPayments.map(p=>p.amount));const refunds=capturedPayments.every(p=>p.refund!==null)?sum(capturedPayments.map(p=>p.refund)):null;
  const fees=payments.every(p=>p.fee!==null)?sum(payments.map(p=>p.fee)):null;
  const matched=rows.filter(r=>r.order&&r.matched).length;
  return {rows,summary:{orders:orders.length,payments:payments.length,expected:sum(orders.map(o=>o.amount)),captured:gross,refunds,fees,net:refunds===null||fees===null||payments.some(p=>p.status==='unknown')?null:gross-refunds-fees,matched,review:rows.filter(r=>!r.matched).length,orphans:rows.filter(r=>!r.order).length,pending:payments.filter(p=>p.status==='pending').length,failed:payments.filter(p=>p.status==='failed').length,unknown:payments.filter(p=>p.status==='unknown').length}};
}
export function csvCell(value){let s=String(value??'');if(/^[\s\uFEFF]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function toCSV(rows){return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
export function exportResults(result,reviewed=new Set()){const decimal=v=>v===null?'':(v/100).toFixed(2);return toCSV([['order_id','customer','expected_inr','captured_inr','difference_inr','refund_inr','fees_inr','net_estimate_inr','issues','payment_ids','reviewed'],...result.rows.map(r=>[r.id,r.order?.customer??'',decimal(r.order?.amount??null),decimal(r.captured),decimal(r.difference),decimal(r.refund),decimal(r.fees),decimal(r.net),r.issues.length?r.issues.map(i=>LABELS[i]).join('; '):'Matched',r.payments.map(p=>p.id).join('; '),reviewed.has(r.id)?'Yes':'No'])]);}
