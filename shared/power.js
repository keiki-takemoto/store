/* 5つの力。スタッフ用アプリと、店長の集計の「スタッフ」で同じ出し方をするために、
   ここにまとめてある。直したら、もうひとつのアプリの shared/power.js にも同じものを置くこと。

   どちらも同じ形の行を渡す：
   {name, vis, buy, qty, hiqty, visA:{west,asia,jp}, buyA:{west,asia,jp}, cats:{種類:点数}} */
(function (root) {
  "use strict";
  function esc(s){
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var AXES=[
    {k:"sell", nm:"販売力", ds:"来たお客さまが買ってくれた割合",
      v:function(r){ return r.vis?r.buy/r.vis:null },
      tx:function(r){ return (r.vis?Math.round(r.buy/r.vis*100):0)+"%" },
      av:function(x){ return Math.round(x*100)+"%" },
      tip:"来たお客さまに、まず声をかける数を増やしてみましょう。"},
    {k:"set", nm:"提案力", ds:"1回のお会計で売れた点数",
      v:function(r){ return r.buy?r.qty/r.buy:null },
      tx:function(r){ return (r.buy?(r.qty/r.buy).toFixed(1):"0.0")+"点" },
      av:function(x){ return x.toFixed(1)+"点" },
      tip:"お会計のときに「こちらもいかがですか」をひとこと添えてみましょう。"},
    {k:"hi", nm:"単価力", ds:"高単価の商品が売れた割合",
      v:function(r){ return r.qty?r.hiqty/r.qty:null },
      tx:function(r){ return (r.qty?Math.round(r.hiqty/r.qty*100):0)+"%" },
      av:function(x){ return Math.round(x*100)+"%" },
      tip:"いいものを先に見せると、高いものが選ばれやすくなります。"},
    {k:"world", nm:"海外力", ds:"欧米・アジアのお客さまの販売力",
      v:function(r){ var a=r.visA||{}, b=r.buyA||{};
        var v=(a.west||0)+(a.asia||0); return v?((b.west||0)+(b.asia||0))/v:null },
      tx:function(r){ var a=r.visA||{}, b=r.buyA||{};
        var v=(a.west||0)+(a.asia||0);
        return (v?Math.round(((b.west||0)+(b.asia||0))/v*100):0)+"%" },
      av:function(x){ return Math.round(x*100)+"%" },
      tip:"かんたんな英語のひとことだけでも、お客さまの足は止まります。"},
    {k:"wide", nm:"商品力", ds:"売った商品の種類の数",
      v:function(r){ return catKinds(r) },
      tx:function(r){ return catKinds(r)+"種類" },
      av:function(x){ return (Math.round(x*10)/10)+"種類" },
      tip:"いつもと違う棚のものも、すすめてみましょう。"}
  ];
  function catKinds(r){ var c=r.cats||{}, n=0; for(var k in c){ if(c[k]>0) n++ } return n }

  /* みんなの中での位置を0〜100にする。平均が50、お店でいちばんが100。 */
  function axisScores(rows,me){
    var out={};
    AXES.forEach(function(a){
      var vs=[], mv=null;
      rows.forEach(function(r){
        var v=a.v(r); if(v===null) return;
        vs.push(v); if(r.name===me) mv=v;
      });
      if(mv===null||!vs.length){ out[a.k]={s:null}; return }
      var sum=0; vs.forEach(function(x){ sum+=x });
      var avg=sum/vs.length, mx=Math.max.apply(null,vs), mn=Math.min.apply(null,vs);
      var sc;
      if(mx===mn) sc=50;
      else if(mv>=avg) sc=50+50*(mv-avg)/((mx-avg)||1);
      else sc=50-25*(avg-mv)/((avg-mn)||1);
      /* 下は25で止める。いちばん下の人の五角形がつぶれて見えないようにするため */
      sc=Math.max(25,Math.min(100,Math.round(sc)));
      /* 同じ数字なら同じ順位 */
      var sorted=vs.slice().sort(function(x,y){ return y-x }), pos=1;
      for(var i=0;i<sorted.length;i++){ if(sorted[i]>mv) pos++; }
      out[a.k]={s:sc, v:mv, avg:avg, pos:pos, n:vs.length, alone:(mx===mn)};
    });
    return out;
  }
  function totalScore(sc){
    var t=0, c=0;
    AXES.forEach(function(a){ var x=sc[a.k]; if(x&&x.s!==null){ t+=x.s; c++ } });
    return c?Math.round(t/c):null;
  }
  /* 五角形。絵はその場で描くので、電波が無くても出る */
  function radarSvg(sc){
    var W=300,H=248,cx=150,cy=126,R=88,n=AXES.length;
    function pt(i,f){
      var a=-Math.PI/2+2*Math.PI*i/n;
      return [cx+Math.cos(a)*R*f, cy+Math.sin(a)*R*f];
    }
    function poly(f){
      return AXES.map(function(_,i){ var p=pt(i,f);
        return (i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1) }).join("")+"Z";
    }
    var g="";
    [.25,.5,.75,1].forEach(function(f){ g+='<path class="g'+(f===1?" o":"")+'" d="'+poly(f)+'"/>' });
    AXES.forEach(function(_,i){ var p=pt(i,1);
      g+='<line class="g" x1="'+cx+'" y1="'+cy+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'"/>' });
    var d="", dots="", lab="";
    AXES.forEach(function(a,i){
      var x=sc[a.k], v=(x&&x.s!==null)?x.s:0;
      var p=pt(i,Math.max(.06,v/100));
      d+=(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1);
      dots+='<circle class="dot" cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="4"/>';
      var q=pt(i,1.19), an=(Math.abs(q[0]-cx)<8)?"middle":(q[0]>cx?"start":"end");
      lab+='<text class="ax" x="'+q[0].toFixed(1)+'" y="'+(q[1]+4).toFixed(1)+
           '" text-anchor="'+an+'">'+esc(a.nm)+'</text>';
    });
    return '<svg class="radar" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="5つの力">'+
      g+'<path class="area" d="'+d+'Z"/>'+dots+lab+'</svg>';
  }

  root.Power = {
    AXES: AXES,
    catKinds: catKinds,
    axisScores: axisScores,
    totalScore: totalScore,
    radarSvg: radarSvg
  };
})(typeof window !== "undefined" ? window : this);
