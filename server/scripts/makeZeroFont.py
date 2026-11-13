# Builds a one-glyph font whose "0" is the base font's bold zero with a diagonal bar inside the oval (PDF ink-code grids).
# python3 makeZeroFont.py client/public/fonts/Sarabun-Bold.ttf client/public/fonts/SarabunZero-Bold.ttf "Sarabun Zero"
import sys, math
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
src, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
f = TTFont(src)
o = Options(); o.layout_features = []; o.name_IDs = ['*']; o.notdef_outline = True; o.hinting = False
s = Subsetter(o); s.populate(text='0'); s.subset(f)
gname = f.getBestCmap()[ord('0')]
gs = f.getGlyphSet(); rec = DecomposingRecordingPen(gs); gs[gname].draw(rec)
g = f['glyf'][gname]; g.recalcBounds(f['glyf'])
x0, y0, x1, y1 = g.xMin, g.yMin, g.xMax, g.yMax
cx, cy, a, b = (x0+x1)/2, (y0+y1)/2, (x1-x0)/2, (y1-y0)/2
upm = f['head'].unitsPerEm
k = 0.60                      # bar ends at ~0.85 of the oval radius: inside the ring, never past the outline
t = upm * 0.085 / 2           # half the bar thickness
ax, ay, bx, by = cx - k*a, cy - k*b, cx + k*a, cy + k*b
dx, dy = bx-ax, by-ay; L = math.hypot(dx, dy); nx, ny = -dy/L*t, dx/L*t
pen = TTGlyphPen(gs); rec.replay(pen)
# same winding as the outer contour (clockwise in TrueType) so the bar also fills the counter
pts = [(ax+nx, ay+ny), (bx+nx, by+ny), (bx-nx, by-ny), (ax-nx, ay-ny)]
def area(p): return sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p)))
if area(pts) > 0: pts.reverse()
pen.moveTo(pts[0]); [pen.lineTo(p) for p in pts[1:]]; pen.closePath()
f['glyf'][gname] = pen.glyph()
for r in f['name'].names:
    if r.nameID in (1, 4, 16): r.string = name
    if r.nameID == 6: r.string = name.replace(' ', '')
f.save(out)
print(out, (x0, y0, x1, y1))
