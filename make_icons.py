#!/usr/bin/env python3
"""アプリアイコン（外部ライブラリ不要）。黒地の真ん中に白い「ZIPANG」。

文字は字形をそのまま多角形で持っていて、3倍の細かさで塗ってから縮めている
（フォントを使えないので、こうして輪郭のギザギザを消している）。
小さいファビコンだけは ZIPANG が潰れて読めないので「Z」1文字にしている。
直したら sw.js の CACHE の番号も上げること。"""
import math, os, struct, zlib

BG = (0x00, 0x00, 0x00)      # 背景（黒）
FG = (0xFF, 0xFF, 0xFF)      # 文字（白）
T  = 0.17                    # 線の太さ（文字の高さを1としたとき）
TRACK = 0.12                 # 字と字のあいだ
KERN  = {"IP":0.01, "PA":-0.035, "AN":-0.015}   # 見た目が空きすぎる組だけ詰める
SS = 3                       # 何倍の細かさで塗るか

# ---- 形をつくる道具（文字の高さ＝1、yは下向き） ----
def rect(x0, y0, x1, y1): return [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]

def rrect(x0, y0, x1, y1, r, seg=12):
    r = max(0.0, min(r, (x1-x0)/2, (y1-y0)/2)); p = []
    def arc(cx, cy, a0, a1):
        for i in range(seg+1):
            a = a0 + (a1-a0)*i/seg
            p.append((cx + r*math.cos(a), cy + r*math.sin(a)))
    arc(x1-r, y0+r, -math.pi/2, 0); arc(x1-r, y1-r, 0, math.pi/2)
    arc(x0+r, y1-r, math.pi/2, math.pi); arc(x0+r, y0+r, math.pi, math.pi*1.5)
    return p

def ell(cx, cy, rx, ry, seg=80):
    return [(cx + rx*math.cos(2*math.pi*i/seg), cy + ry*math.sin(2*math.pi*i/seg))
            for i in range(seg)]

# ---- 字形（幅, [(多角形, 1=白 / 0=黒), …]） ----
def g_Z():
    W, t = 0.80, T; hw = t*0.75
    return W, [(rect(0,0,W,t),1), (rect(0,1-t,W,1),1),
               ([(W,t),(W-2*hw,t),(0,1-t),(2*hw,1-t)],1)]

def g_I():
    return T, [(rect(0,0,T,1),1)]

def g_P():
    W, t = 0.76, T; yb = 0.66; r = yb/2
    return W, [(rect(0,0,t,1),1), (rrect(0,0,W,yb,r),1),
               (rrect(t,t,W-t,yb-t,r-t),0)]

def g_A():
    """先のとがった三角のA。外側の三角を白で塗り、内側の三角と脚のあいだを黒で抜く。"""
    W, t = 0.95, T; cx = W/2
    sw = t*math.hypot(cx, 1.0)          # 斜めの脚を横向きに測った太さ
    yb = 0.68; bt = t*0.82              # 横棒の位置と太さ
    inL = lambda y: cx + sw + (-cx)*y   # 左の脚の内側
    inR = lambda y: W - inL(y)
    ya = 2*sw/W                         # 内側の線が交わる高さ
    return W, [([(cx,0),(W,1),(0,1)],1),
               ([(cx,ya),(inR(yb),yb),(inL(yb),yb)],0),
               ([(inL(yb+bt),yb+bt),(inR(yb+bt),yb+bt),(inR(1),1),(inL(1),1)],0)]

def g_N():
    W, t = 0.80, T; d = t*1.35
    return W, [(rect(0,0,t,1),1), (rect(W-t,0,W,1),1),
               ([(0,0),(d,0),(W,1),(W-d,1)],1)]

def g_G():
    """輪を描いてから、右上を扇形に切り落として横棒を足す。"""
    W, t = 0.82, T; cx, cy = W/2, 0.5
    a0, a1 = math.radians(-50), math.radians(-2)
    wedge = [(cx, cy)] + [(cx + W*math.cos(a0 + (a1-a0)*i/14),
                           cy + W*math.sin(a0 + (a1-a0)*i/14)) for i in range(15)]
    # 横棒。右端は輪の外側に沿わせる（はみ出さないように）
    y0, y1 = cy-t/2, cy+t/2
    edge = []
    for i in range(9):
        yy = y0 + (y1-y0)*i/8
        edge.append((cx + (W/2)*math.sqrt(max(0.0, 1-((yy-cy)/0.5)**2)), yy))
    bar = [(cx, y0)] + edge + [(cx, y1)]
    return W, [(ell(cx,cy,W/2,0.5),1), (ell(cx,cy,W/2-t,0.5-t),0),
               (wedge,0), (bar,1)]

GLYPH = {"Z":g_Z, "I":g_I, "P":g_P, "A":g_A, "N":g_N, "G":g_G}

# ---- 塗り（走査線＋偶奇判定） ----
def fill(rows, W, H, pts, val):
    ys = [p[1] for p in pts]
    y0 = max(0, int(math.floor(min(ys)))); y1 = min(H-1, int(math.ceil(max(ys))))
    n = len(pts)
    for y in range(y0, y1+1):
        yc = y + 0.5; xs = []
        for i in range(n):
            ax, ay = pts[i]; bx, by = pts[(i+1) % n]
            if (ay <= yc < by) or (by <= yc < ay):
                xs.append(ax + (yc-ay)*(bx-ax)/(by-ay))
        if len(xs) < 2: continue
        xs.sort(); row = rows[y]
        for k in range(0, len(xs)-1, 2):
            a = max(0, int(math.floor(xs[k]+0.5)))
            b = min(W-1, int(math.ceil(xs[k+1]-0.5)))
            if b >= a: row[a:b+1] = bytes([val])*(b-a+1)

def render(size, text="ZIPANG", frac=0.76):
    N = size*SS
    rows = [bytearray(N) for _ in range(N)]
    gs = [GLYPH[c]() for c in text]
    gaps = [TRACK + KERN.get(text[i:i+2], 0.0) for i in range(len(text)-1)]
    total = sum(g[0] for g in gs) + sum(gaps)
    cap = frac*N/total
    x = (N - total*cap)/2.0
    y = (N - cap)/2.0
    for i, (w, shapes) in enumerate(gs):
        for poly, val in shapes:
            fill(rows, N, N, [(x + px*cap, y + py*cap) for px, py in poly], val)
        x += (w + (gaps[i] if i < len(gaps) else 0.0))*cap

    # 3倍で塗ったものを縮める（ここで輪郭がなめらかになる）
    q = SS*SS
    out = bytearray()
    for oy in range(size):
        line = bytearray(b"\x00")
        src = rows[oy*SS:(oy+1)*SS]
        for ox in range(size):
            s = 0; a = ox*SS
            for r in src: s += sum(r[a:a+SS])
            for i in range(3):
                line.append(round(BG[i] + (FG[i]-BG[i])*s/q))
        out += line
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(out), 9)) + chunk(b"IEND", b""))

if __name__ == "__main__":
    d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
    os.makedirs(d, exist_ok=True)
    for n, s in [("icon-192.png",192), ("icon-512.png",512), ("apple-touch-icon.png",180)]:
        open(os.path.join(d, n), "wb").write(render(s)); print(n)
    open(os.path.join(d, "favicon-32.png"), "wb").write(render(32, "Z", 0.46)); print("favicon-32.png")
