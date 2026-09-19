#!/usr/bin/env python3
"""アプリアイコン（外部ライブラリ不要）。緑の地に、ホームのタイルを表す白い4つの角丸。"""
import struct, zlib, os
BG = (0x2B, 0xA5, 0x5F)
FG = (0xFF, 0xFF, 0xFF)

def blend(d, s, a): return tuple(round(x*(1-a) + y*a) for x, y in zip(d, s))
def rrect(px, w, h, x0, y0, x1, y1, r, c, a=1.0):
    for y in range(max(0,int(y0)), min(h,int(y1)+1)):
        for x in range(max(0,int(x0)), min(w,int(x1)+1)):
            cx = x0+r if x < x0+r else (x1-r if x > x1-r else x)
            cy = y0+r if y < y0+r else (y1-r if y > y1-r else y)
            if (x-cx)**2 + (y-cy)**2 > r*r: continue
            px[y][x] = blend(px[y][x], c, a)

def render(s):
    px = [[BG]*s for _ in range(s)]
    m, g = 0.225*s, 0.055*s
    t = (s - m*2 - g)/2
    for i in range(4):
        x = m + (i % 2)*(t+g); y = m + (i//2)*(t+g)
        rrect(px, s, s, x, y, x+t, y+t, t*0.30, FG, 1.0 if i in (0,3) else 0.78)
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in px)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(d, exist_ok=True)
for n, s in [("icon-192.png",192), ("icon-512.png",512), ("apple-touch-icon.png",180), ("favicon-32.png",32)]:
    open(os.path.join(d, n), "wb").write(render(s)); print(n)
