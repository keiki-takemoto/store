/* レシートを紙に出す。

   Bluetoothのプリンタは、ブラウザのアプリからは繋げない。
   iPad・iPhone の Safari と Chrome には Bluetooth を触る仕組みが無く、
   Apple がこれを入れない方針のため（2026年11月時点）。
   そこで、端末の「プリント」に渡す形にしてある。
   Wi-Fiで繋がっているレシートプリンタ（AirPrint対応のもの）なら、これで出る。
   ふつうのプリンタでも、PDFとして保存するのでも、同じものが出る。

   使い方
     Receipt.print(sale)   … 会計1件を印刷する
     Receipt.sample()      … 見本を印刷する（設定の確認用）
     Receipt.cfg()         … いまの決めごとを読む

   店名・紙の幅などは 設定 → レジ → レシート で入れる。
   置き場所は商品やスタッフと同じ store_meta の "reg"（REGSET）の中の rc。
   商品の表に列を足す必要が無いので、SupabaseのSQLは触らなくて済む。 */
(function(){
"use strict";

var K_REGSET="storeregset.v1";
var DOW=["日","月","火","水","木","金","土"];

function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c] }) }
function yen(n){ return "¥"+(Number(n)||0).toLocaleString("ja-JP") }

/* 決めごと。入っていないところは、ふつうの形で埋める。 */
function cfg(){
  var v=null; try{ v=JSON.parse(localStorage.getItem(K_REGSET)) }catch(e){}
  var rc=(v&&v.rc&&typeof v.rc==="object")?v.rc:{};
  return {
    shop:String(rc.shop||"")||"ZIPANG",
    addr:String(rc.addr||""),                               /* 住所・電話。空なら出さない */
    inv :String(rc.inv||""),                                /* 登録番号。入れると消費税の行も出る */
    foot:(rc.foot==null?"ありがとうございました":String(rc.foot)),
    tax :(typeof rc.tax==="number"?rc.tax:10),              /* 消費税の率（％） */
    w   :(String(rc.w)==="58"?"58":"80")                    /* 紙の幅 mm */
  };
}

function payName(k){
  if(window.Sync&&Sync.payName) return Sync.payName(k)||"";
  return {cash:"現金",card:"カード",paypay:"PayPay"}[k]||"";
}

function when(sale){
  var d=(sale&&sale.at)?new Date(sale.at):new Date();
  if(isNaN(d.getTime())) d=new Date();
  return d.getFullYear()+"年"+(d.getMonth()+1)+"月"+d.getDate()+"日("+DOW[d.getDay()]+")　"+
    ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2);
}

/* 1行ぶん。名前が長くても折り返して、数量と金額は下の行の右に出す。 */
function lineHtml(l){
  var q=Number(l&&l.qty)||0, p=Number(l&&l.price)||0;
  return '<div class="rl"><div class="rn">'+esc((l&&l.name)||"")+'</div>'+
    '<div class="rq"><span>'+q+' × '+yen(p)+'</span><b>'+yen(p*q)+'</b></div></div>';
}
function tr(k,v,cls){
  return '<div class="rt'+(cls?" "+cls:"")+'"><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div>';
}

function html(sale,c){
  sale=sale||{};
  var lines=sale.lines||[];
  var sub=Number(sale.subtotal);
  if(isNaN(sub)){ sub=0; lines.forEach(function(l){ sub+=(Number(l.price)||0)*(Number(l.qty)||0) }) }
  var disc=Number(sale.discount)||0;
  var tot=Number(sale.total); if(isNaN(tot)) tot=sub-disc;
  var qty=Number(sale.qty); if(isNaN(qty)){ qty=0; lines.forEach(function(l){ qty+=Number(l.qty)||0 }) }

  var h='<div class="rh"><div class="shop">'+esc(c.shop)+'</div>'+
    (c.addr?'<div class="addr">'+esc(c.addr).replace(/\n/g,"<br>")+'</div>':"")+
    (c.inv ?'<div class="addr">登録番号 '+esc(c.inv)+'</div>':"")+'</div>';

  h+='<div class="hr"></div>';
  h+='<div class="meta">'+esc(when(sale))+'</div>';
  var who=[];
  if(sale.staff) who.push("担当 "+sale.staff);
  if(sale.guest) who.push(sale.guest);
  if(who.length) h+='<div class="meta">'+esc(who.join("　"))+'</div>';

  h+='<div class="hr"></div>';
  h+=lines.length?lines.map(lineHtml).join(""):'<div class="rl"><div class="rn">—</div></div>';
  h+='<div class="hr"></div>';

  if(disc){ h+=tr("小計",yen(sub)); h+=tr("値引き","-"+yen(disc)) }
  h+=tr("合計（"+qty+"点）",yen(tot),"big");

  /* 登録番号を入れているときだけ、税率と内税を出す（適格簡易請求書の形） */
  if(c.inv){
    var t=Math.floor(tot*c.tax/(100+c.tax));
    h+=tr(c.tax+"%対象",yen(tot));
    h+=tr("内 消費税",yen(t));
  }

  h+='<div class="hr"></div>';
  var pn=payName(sale.pay);
  if(pn) h+=tr("お支払い",pn);
  if(typeof sale.cash==="number"&&sale.cash>0){
    h+=tr("お預かり",yen(sale.cash));
    h+=tr("お釣り",yen(sale.cash-tot));
  }

  h+='<div class="hr"></div>';
  if(c.foot) h+='<div class="foot">'+esc(c.foot)+'</div>';
  if(sale.id) h+='<div class="no">No. '+esc(sale.id)+'</div>';
  return h;
}

/* 印刷のときだけ、画面のかわりにレシートを出す。
   レジの画面は html,body を overflow:hidden で固めてあるので、ここで戻している。 */
var CSS=
'#__rcpt{display:none}'+
'@media print{'+
  'html,body{background:#fff!important;margin:0!important;padding:0!important;'+
    'height:auto!important;min-height:0!important;overflow:visible!important}'+
  'body>*{display:none!important}'+
  'body>#__rcpt{display:block!important;width:72mm;margin:0 auto;padding:0;'+
    'color:#000;font-size:10pt;line-height:1.45;'+
    '-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
  'body>#__rcpt[data-w="58"]{width:48mm;font-size:9pt}'+
  '#__rcpt .rh{text-align:center;margin:0 0 6px}'+
  '#__rcpt .shop{font-size:15pt;font-weight:700;letter-spacing:.06em}'+
  '#__rcpt[data-w="58"] .shop{font-size:13pt}'+
  '#__rcpt .addr{font-size:8pt;margin-top:2px}'+
  '#__rcpt .hr{border-top:1px dashed #000;margin:5px 0}'+
  '#__rcpt .meta{font-size:9pt}'+
  '#__rcpt .rl{margin:0 0 3px}'+
  '#__rcpt .rn{word-break:break-all}'+
  '#__rcpt .rq{display:flex;justify-content:space-between;gap:6px;font-variant-numeric:tabular-nums}'+
  '#__rcpt .rq span{font-size:9pt;padding-left:1em}'+
  '#__rcpt .rt{display:flex;justify-content:space-between;gap:6px;font-variant-numeric:tabular-nums}'+
  '#__rcpt .rt.big{font-size:13pt;font-weight:700;margin:3px 0}'+
  '#__rcpt .foot{text-align:center;margin:7px 0 0}'+
  '#__rcpt .no{text-align:center;font-size:7.5pt;margin-top:4px}'+
  '@page{margin:4mm}'+
'}';

function mount(){
  if(!document.getElementById("__rcptCss")){
    var st=document.createElement("style");
    st.id="__rcptCss"; st.textContent=CSS;
    document.head.appendChild(st);
  }
  var box=document.getElementById("__rcpt");
  if(!box){
    box=document.createElement("div");
    box.id="__rcpt"; box.setAttribute("aria-hidden","true");
    document.body.appendChild(box);
  }
  return box;
}

function print(sale){
  var c=cfg(), box=mount();
  box.setAttribute("data-w",c.w);
  box.innerHTML=html(sale,c);
  window.print();
}

/* 設定の見本。実際の会計とは関係ない中身で、紙の出かただけ確かめる。 */
function sample(){
  print({ id:"sample", at:new Date().toISOString(), staff:"見本", guest:"日本人", pay:"cash",
    lines:[{name:"手ぬぐい　藍",price:1200,qty:2},
           {name:"桐の箸置き（五客組）",price:3800,qty:1}],
    subtotal:6200, discount:200, total:6000, qty:3, cash:10000 });
}

window.Receipt={ cfg:cfg, html:html, print:print, sample:sample };
})();
