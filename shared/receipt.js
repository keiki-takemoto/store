/* レシートを紙に出す。

   Bluetoothのプリンタは、ブラウザのアプリからは繋げない。
   iPad・iPhone の Safari と Chrome には Bluetooth を触る仕組みが無く、
   Apple がこれを入れない方針のため（2026年11月時点）。
   そこで、端末の「プリント」に渡す形にしてある。
   Wi-Fiで繋がっているレシートプリンタ（AirPrint対応のもの）なら、これで出る。
   ふつうのプリンタでも、PDFとして保存するのでも、同じものが出る。

   ガワのアプリ（store-ios）の中で開いているときは、
   `window.ZipangShell` があるので、そちらに渡して Bluetooth のプリンタに出す。
   ふつうのSafariで開いているときは、これまで通り端末の「プリント」に渡す。
   どちらに出るかは、HTML側は気にしなくてよい。

   使い方
     Receipt.print(sale)   … 会計1件を印刷する（Promiseを返す）
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
    tax :(typeof rc.tax==="number"?rc.tax:10),              /* ふつうの消費税の率（％） */
    tax2:(typeof rc.tax2==="number"?rc.tax2:8),             /* 軽減税率（飲み物など） */
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

/* ---------- 消費税 ---------- */

/* この1行の消費税の率。会計のときに焼きつけた `tx` を使う。
   印を付ける前の古い会計には `tx` が無いので、ふつうの率で見る。 */
function rateOf(l,c){
  var t=Number(l&&l.tx);
  return (isFinite(t)&&t>=0) ? t : c.tax;
}
/* 軽減税率の行か（レシートに ※ を付ける目印） */
function isLow(l,c){ return rateOf(l,c)!==c.tax }

/* 税率ごとに、売上・値引き・消費税を出す。
   値引きは、税率ごとの売上の割合で分ける（端数は最後の率で調整する）。
   返すのは税率の高い順（10% → 8%）。 */
function taxBreak(sale,c){
  var lines=(sale&&sale.lines)||[], by={}, sub=0;
  lines.forEach(function(l){
    var r=rateOf(l,c), amt=(Number(l.price)||0)*(Number(l.qty)||0);
    if(!by[r]) by[r]={rate:Number(r), sub:0};
    by[r].sub+=amt; sub+=amt;
  });
  var keys=Object.keys(by).sort(function(a,b){ return Number(b)-Number(a) });
  var disc=Math.max(0,Math.min(sub,Number(sale&&sale.discount)||0)), used=0;
  keys.forEach(function(k,i){
    var g=by[k];
    var d=(i===keys.length-1) ? (disc-used)
        : (sub>0 ? Math.round(disc*g.sub/sub) : 0);
    g.disc=Math.max(0,Math.min(g.sub,d));
    used+=g.disc;
    g.total=g.sub-g.disc;
    g.tax=Math.floor(g.total*g.rate/(100+g.rate));
  });
  return keys.map(function(k){ return by[k] });
}

/* 1行ぶん。名前が長くても折り返して、数量と金額は下の行の右に出す。 */
function lineHtml(l,c){
  var q=Number(l&&l.qty)||0, p=Number(l&&l.price)||0;
  return '<div class="rl"><div class="rn">'+esc((l&&l.name)||"")+
    (isLow(l,c)?'<span class="mk">※</span>':"")+'</div>'+
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
  h+=lines.length?lines.map(function(l){ return lineHtml(l,c) }).join("")
                  :'<div class="rl"><div class="rn">—</div></div>';
  h+='<div class="hr"></div>';

  if(disc){ h+=tr("小計",yen(sub)); h+=tr("値引き","-"+yen(disc)) }
  h+=tr("合計（"+qty+"点）",yen(tot),"big");

  /* 登録番号を入れているときだけ、税率ごとの内訳を出す（適格簡易請求書の形） */
  if(c.inv){
    taxBreak(sale,c).forEach(function(g){
      h+=tr(g.rate+"%対象",yen(g.total));
      h+=tr("　内 消費税",yen(g.tax));
    });
  }

  h+='<div class="hr"></div>';
  var pn=payName(sale.pay);
  if(pn) h+=tr("お支払い",pn);
  if(typeof sale.cash==="number"&&sale.cash>0){
    h+=tr("お預かり",yen(sale.cash));
    h+=tr("お釣り",yen(sale.cash-tot));
  }

  h+='<div class="hr"></div>';
  if(lines.some(function(l){ return isLow(l,c) }))
    h+='<div class="note">※ は軽減税率（'+c.tax2+'%）対象</div>';
  if(c.foot) h+='<div class="foot">'+esc(c.foot)+'</div>';
  if(sale.id) h+='<div class="no">No. '+esc(sale.id)+'</div>';
  return h;
}

/* ---------- ガワのアプリ（Bluetoothのプリンタ）に渡すとき ---------- */

/* ガワの中にいるか */
function inShell(){ return !!(window.ZipangShell && window.ZipangShell.print) }

/* 紙の幅ぶんの文字数。ふつうの大きさの字で何文字入るか。 */
function cols(c){ return c.w==="58" ? 32 : 48 }

/* 紙に並べる行。見た目はHTMLのレシートと同じにしてある。 */
function doc(sale,c){
  sale=sale||{};
  var lines=sale.lines||[], L=[];
  function tx(v,big,bold){ L.push({t:"l", v:v, big:!!big, bold:!!bold}) }
  function ct(v,big,bold){ L.push({t:"c", v:v, big:!!big, bold:!!bold}) }
  function lr(l,r,big,bold){ L.push({t:"lr", l:l, r:r, big:!!big, bold:!!bold}) }
  function rule(){ L.push({t:"rule"}) }

  ct(c.shop,true,true);
  if(c.addr) c.addr.split("\n").forEach(function(x){ if(x) ct(x) });
  if(c.inv) ct("登録番号 "+c.inv);
  rule();
  tx(when(sale));
  var who=[];
  if(sale.staff) who.push("担当 "+sale.staff);
  if(sale.guest) who.push(sale.guest);
  if(who.length) tx(who.join("　"));
  rule();

  var sub=Number(sale.subtotal);
  if(isNaN(sub)){ sub=0; lines.forEach(function(l){ sub+=(Number(l.price)||0)*(Number(l.qty)||0) }) }
  var disc=Number(sale.discount)||0;
  var tot=Number(sale.total); if(isNaN(tot)) tot=sub-disc;
  var qty=Number(sale.qty); if(isNaN(qty)){ qty=0; lines.forEach(function(l){ qty+=Number(l.qty)||0 }) }

  if(!lines.length) tx("—");
  lines.forEach(function(l){
    var q=Number(l.qty)||0, pr=Number(l.price)||0;
    tx(String(l.name||"")+(isLow(l,c)?" ※":""));
    lr("  "+q+" × "+yen(pr), yen(pr*q));
  });
  rule();
  if(disc){ lr("小計",yen(sub)); lr("値引き","-"+yen(disc)) }
  lr("合計（"+qty+"点）",yen(tot),true,true);
  if(c.inv){
    taxBreak(sale,c).forEach(function(g){
      lr(g.rate+"%対象",yen(g.total));
      lr("  内 消費税",yen(g.tax));
    });
  }
  rule();
  var pn=payName(sale.pay);
  if(pn) lr("お支払い",pn);
  if(typeof sale.cash==="number"&&sale.cash>0){
    lr("お預かり",yen(sale.cash));
    lr("お釣り",yen(sale.cash-tot));
  }
  rule();
  if(lines.some(function(l){ return isLow(l,c) })) tx("※ は軽減税率（"+c.tax2+"%）対象");
  if(c.foot) ct(c.foot);
  if(sale.id) ct("No. "+sale.id);
  L.push({t:"feed", n:2});
  L.push({t:"cut"});
  return { w:cols(c), lines:L };
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
  '#__rcpt .rn .mk{margin-left:.3em;font-weight:700}'+
  '#__rcpt .note{font-size:8.5pt;margin:4px 0 0}'+
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
  var c=cfg();
  /* ガワの中なら、Bluetoothのプリンタへ。失敗の文句はそのまま呼び元に返す。 */
  if(inShell()) return window.ZipangShell.print(doc(sale,c));
  /* ふつうのSafariなら、これまで通り端末の「プリント」へ */
  var box=mount();
  box.setAttribute("data-w",c.w);
  box.innerHTML=html(sale,c);
  window.print();
  return Promise.resolve();
}

/* 設定の見本。実際の会計とは関係ない中身で、紙の出かただけ確かめる。 */
function sample(){
  return print({ id:"sample", at:new Date().toISOString(), staff:"見本", guest:"日本人", pay:"cash",
    lines:[{name:"手ぬぐい　藍",price:1200,qty:2,tx:cfg().tax},
           {name:"桐の箸置き（五客組）",price:3800,qty:1,tx:cfg().tax},
           {name:"緑茶（ペットボトル）",price:160,qty:2,tx:cfg().tax2}],
    subtotal:6520, discount:200, total:6320, qty:5, cash:10000 });
}

window.Receipt={ cfg:cfg, html:html, doc:doc, print:print, sample:sample, inShell:inShell };
})();
