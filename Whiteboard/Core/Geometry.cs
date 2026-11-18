using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>纯几何计算：包围盒、命中测试、变换（世界坐标）。</summary>
public static class Geometry
{
    public static double DistToSegment(double px, double py, double ax, double ay, double bx, double by)
    {
        var dx = bx - ax;
        var dy = by - ay;
        var len2 = dx * dx + dy * dy;
        if (len2 == 0) return Num.Dist(px, py, ax, ay);
        var t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return Num.Dist(px, py, ax + t * dx, ay + t * dy);
    }

    public static BBox? RawBBox(Element el)
    {
        switch (el.Type)
        {
            case "pen":
            case "highlighter":
            {
                var pts = el.Points;
                if (pts is null || pts.Count == 0) return null;
                double x1 = double.PositiveInfinity, y1 = double.PositiveInfinity;
                double x2 = double.NegativeInfinity, y2 = double.NegativeInfinity;
                foreach (var p in pts)
                {
                    x1 = Math.Min(x1, p.X);
                    y1 = Math.Min(y1, p.Y);
                    x2 = Math.Max(x2, p.X);
                    y2 = Math.Max(y2, p.Y);
                }
                return new BBox(x1, y1, x2 - x1, y2 - y1);
            }
            case "line":
            case "arrow":
            case "rect":
            case "ellipse":
                return el.A is not null && el.B is not null ? BBox.FromPoints(el.A, el.B) : null;
            case "note":
                return new BBox(el.X ?? 0, el.Y ?? 0, el.W ?? 180, el.H ?? 140);
            case "text":
                return new BBox(el.X ?? 0, el.Y ?? 0, el.Meta?.W ?? 0, el.Meta?.H ?? 0);
            default:
                return null;
        }
    }

    public static BBox? ElementBBox(Element el)
    {
        switch (el.Type)
        {
            case "pen":
            case "highlighter":
            {
                var raw = RawBBox(el);
                if (raw is not { } b) return null;
                return b.Inflate((el.Size ?? 2) / 2);
            }
            case "line":
            case "arrow":
            {
                if (el.A is null || el.B is null) return null;
                var size = el.Size ?? 2;
                var pad = size / 2 + (el.Type == "arrow" ? size * 2.4 : 0);
                return BBox.FromPoints(el.A, el.B).Inflate(pad);
            }
            case "rect":
            case "ellipse":
            {
                if (el.A is null || el.B is null) return null;
                return BBox.FromPoints(el.A, el.B).Inflate((el.Size ?? 2) / 2);
            }
            case "note":
                return new BBox(el.X ?? 0, el.Y ?? 0, el.W ?? 180, el.H ?? 140);
            case "text":
                return new BBox((el.X ?? 0) - 2, (el.Y ?? 0) - 2, (el.Meta?.W ?? 0) + 4, (el.Meta?.H ?? 0) + 4);
            default:
                return null;
        }
    }

    public static void TranslateElement(Element el, double dx, double dy)
    {
        if (el.Points is not null)
        {
            foreach (var p in el.Points)
            {
                p.X += dx;
                p.Y += dy;
            }
        }
        if (el.A is not null)
        {
            el.A.X += dx;
            el.A.Y += dy;
        }
        if (el.B is not null)
        {
            el.B.X += dx;
            el.B.Y += dy;
        }
        if (el.X is not null)
        {
            el.X += dx;
            el.Y = (el.Y ?? 0) + dy;
        }
    }

    public static void ScaleElementToBBox(Element el, BBox from, BBox to)
    {
        var raw = RawBBox(el);
        if (raw is not { } r || from.W == 0 || from.H == 0) return;

        var padX = r.X - from.X;
        var padY = r.Y - from.Y;
        var fromRaw = new BBox(r.X, r.Y, Math.Max(0.01, from.W - padX * 2), Math.Max(0.01, from.H - padY * 2));
        var toRaw = new BBox(to.X + padX, to.Y + padY, Math.Max(0.01, to.W - padX * 2), Math.Max(0.01, to.H - padY * 2));
        var sx = toRaw.W / fromRaw.W;
        var sy = toRaw.H / fromRaw.H;

        PointD Map(PointD p) => new(
            toRaw.X + (p.X - fromRaw.X) * sx,
            toRaw.Y + (p.Y - fromRaw.Y) * sy,
            p.P);

        if (el.Points is not null)
        {
            foreach (var p in el.Points)
            {
                var mapped = Map(p);
                p.X = mapped.X;
                p.Y = mapped.Y;
            }
        }
        if (el.A is not null) el.A = Map(el.A);
        if (el.B is not null) el.B = Map(el.B);
        if (el.X is not null)
        {
            var m = Map(new PointD(el.X.Value, el.Y ?? 0));
            el.X = m.X;
            el.Y = m.Y;
            if (el.Type == "note")
            {
                el.W = Math.Max(60, (el.W ?? 180) * sx);
                el.H = Math.Max(48, (el.H ?? 140) * sy);
            }
            else if (el.Type == "text")
            {
                if (el.MaxW is > 0) el.MaxW = Math.Max(24, (el.MaxW ?? 0) * sx);
                el.FontSize = Math.Max(8, (el.FontSize ?? 24) * Math.Max(sx, sy));
            }
            el.Meta = null;
        }
    }

    public static bool HitTestElement(Element el, double x, double y, double tol = 6)
    {
        var t = Math.Max(tol, (el.Size ?? 2) / 2 + 2);
        switch (el.Type)
        {
            case "pen":
            case "highlighter":
            {
                var pts = el.Points;
                if (pts is null || pts.Count == 0) return false;
                if (pts.Count == 1) return Num.Dist(x, y, pts[0].X, pts[0].Y) <= t;
                for (var i = 1; i < pts.Count; i++)
                {
                    if (DistToSegment(x, y, pts[i - 1].X, pts[i - 1].Y, pts[i].X, pts[i].Y) <= t) return true;
                }
                return false;
            }
            case "line":
            case "arrow":
                return el.A is not null && el.B is not null &&
                       DistToSegment(x, y, el.A.X, el.A.Y, el.B.X, el.B.Y) <= t;
            case "rect":
            {
                if (el.A is null || el.B is null) return false;
                var b = BBox.FromPoints(el.A, el.B);
                if (el.Fill == true) return b.Contains(x, y);
                return DistToSegment(x, y, b.X, b.Y, b.X + b.W, b.Y) <= t ||
                       DistToSegment(x, y, b.X + b.W, b.Y, b.X + b.W, b.Y + b.H) <= t ||
                       DistToSegment(x, y, b.X + b.W, b.Y + b.H, b.X, b.Y + b.H) <= t ||
                       DistToSegment(x, y, b.X, b.Y + b.H, b.X, b.Y) <= t;
            }
            case "ellipse":
            {
                if (el.A is null || el.B is null) return false;
                var b = BBox.FromPoints(el.A, el.B);
                var rx = Math.Max(b.W / 2, 0.5);
                var ry = Math.Max(b.H / 2, 0.5);
                var cx = b.X + rx;
                var cy = b.Y + ry;
                var k = Math.Pow((x - cx) / rx, 2) + Math.Pow((y - cy) / ry, 2);
                if (el.Fill == true) return k <= 1;
                var scale = (rx + ry) / 2;
                return Math.Abs(Math.Sqrt(k) - 1) * scale <= t;
            }
            case "text":
            case "note":
            {
                var bb = ElementBBox(el);
                return bb?.Contains(x, y) ?? false;
            }
            default:
                return false;
        }
    }

    public static Element? PickElement(IEnumerable<Element> elements, double x, double y, double tol = 6)
    {
        var list = elements as IList<Element> ?? elements.ToList();
        for (var i = list.Count - 1; i >= 0; i--)
        {
            if (list[i].Hidden == true) continue;
            if (HitTestElement(list[i], x, y, tol)) return list[i];
        }
        return null;
    }

    public static List<Element> ElementsInRect(IEnumerable<Element> elements, BBox rect, bool contain = false)
    {
        var result = new List<Element>();
        foreach (var el in elements)
        {
            if (el.Hidden == true) continue;
            var bb = ElementBBox(el);
            if (bb is not { } box) continue;
            if (contain ? box.FullyInside(rect) : box.Intersects(rect)) result.Add(el);
        }
        return result;
    }

    public static BBox? ContentBBox(IEnumerable<Element> elements, double pad = 24)
    {
        var merged = BBox.Merge(elements.Select(ElementBBox));
        return merged?.Inflate(pad);
    }
}
