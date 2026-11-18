using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>元素模型操作：创建、增点、橡皮分割、复制。</summary>
public static class Elements
{
    public const double MinSegment = 0.75;
    public static readonly HashSet<string> PointTools = new() { "pen", "highlighter" };
    public static readonly HashSet<string> ShapeTools = new() { "line", "arrow", "rect", "ellipse" };
    public static readonly HashSet<string> TextTools = new() { "text", "note" };

    public static readonly string[] NoteColors =
    {
        "#fff3a3", "#ffd6a5", "#caffbf", "#a5d8ff", "#e6c9ff", "#ffc9de",
    };

    public static string Uid(string prefix = "e")
    {
        var rnd = Random.Shared.NextInt64(0, 2176782336L);
        var rndText = ConvertToBase36(rnd).PadLeft(6, '0');
        var ts = ConvertToBase36((long)(DateTimeOffset.Now.ToUnixTimeMilliseconds() % 1679616));
        return prefix + rndText + ts.PadLeft(4, '0');
    }

    private static string ConvertToBase36(long value)
    {
        const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
        if (value <= 0) return "0";
        var chars = new List<char>();
        while (value > 0)
        {
            chars.Add(digits[(int)(value % 36)]);
            value /= 36;
        }
        chars.Reverse();
        return new string(chars.ToArray());
    }

    public static Element CreateStroke(string type, StyleSettings style, PointD point, double t)
    {
        var el = new Element
        {
            Id = Uid("s"),
            Type = type,
            Color = style.Color,
            Size = type == "highlighter" ? Math.Max(style.Size * 3, 10) : style.Size,
            Opacity = type == "highlighter" ? Math.Min(style.Opacity, 0.42) : style.Opacity,
            Points = new List<PointD>(),
            Times = new List<double>(),
            T = t,
            Dur = 0,
        };
        AddPoint(el, point.X, point.Y, point.P, 0);
        return el;
    }

    public static bool AddPoint(Element el, double x, double y, double? pressure, double tRel)
    {
        var pts = el.Points ??= new List<PointD>();
        el.Times ??= new List<double>();
        if (pts.Count > 0)
        {
            var last = pts[^1];
            var d = Num.Dist(x, y, last.X, last.Y);
            if (d < MinSegment) return false;
            var dt = Math.Max(1, tRel - (el.Times.Count > 0 ? el.Times[^1] : 0));
            var speed = d / dt;
            var speedFactor = Num.Clamp(1 - speed * 0.55, 0.35, 1);
            var p = Num.Clamp((pressure ?? 0.5) * 0.7 + speedFactor * 0.3, 0.12, 1);
            var smoothed = (last.P ?? 0.5) * 0.62 + p * 0.38;
            pts.Add(new PointD(x, y, smoothed));
        }
        else
        {
            pts.Add(new PointD(x, y, Num.Clamp(pressure ?? 0.5, 0.12, 1)));
        }
        el.Times.Add(tRel);
        return true;
    }

    public static Element FinalizeStroke(Element el, double tRel)
    {
        el.Dur = Math.Max(0, tRel - (el.T ?? 0));
        if (el.Points is not null)
        {
            foreach (var p in el.Points)
            {
                p.X = Math.Round(p.X * 100) / 100;
                p.Y = Math.Round(p.Y * 100) / 100;
                p.P = Math.Round((p.P ?? 0.5) * 1000) / 1000;
            }
        }
        if (el.Times is not null)
        {
            for (var i = 0; i < el.Times.Count; i++) el.Times[i] = Math.Round(el.Times[i]);
        }
        return el;
    }

    public static double StrokeWidth(Element el, int i)
    {
        var pts = el.Points;
        var n = pts?.Count ?? 0;
        var p = pts is not null && i >= 0 && i < n ? pts[i].P ?? 0.5 : 0.5;
        var factor = 0.5 + 0.5 * p;
        if (n > 3)
        {
            const double taper = 2.2;
            if (i < taper) factor *= 0.45 + 0.55 * i / taper;
            var fromEnd = n - 1 - i;
            if (fromEnd < taper) factor *= 0.45 + 0.55 * fromEnd / taper;
        }
        return Math.Max(0.4, (el.Size ?? 2) * factor);
    }

    public static Element CreateShape(string type, PointD a, PointD b, StyleSettings style, double t)
    {
        return new Element
        {
            Id = Uid("g"),
            Type = type,
            Color = style.Color,
            Size = style.Size,
            Opacity = style.Opacity,
            Fill = style.Fill,
            A = new PointD(a.X, a.Y),
            B = new PointD(b.X, b.Y),
            T = t,
            Dur = 0,
        };
    }

    public static Element CreateText(string text, double x, double y, StyleSettings style, double t)
    {
        return new Element
        {
            Id = Uid("t"),
            Type = "text",
            X = x,
            Y = y,
            Text = text,
            Color = style.Color,
            Opacity = style.Opacity,
            FontSize = style.FontSize,
            FontFamily = style.FontFamily,
            Align = "left",
            T = t,
            Dur = 0,
        };
    }

    public static Element CreateNote(double x, double y, StyleSettings style, string text = "", double w = 180, double h = 140, double t = 0)
    {
        return new Element
        {
            Id = Uid("n"),
            Type = "note",
            X = x,
            Y = y,
            W = w,
            H = h,
            Text = text,
            Color = "#1f2937",
            Opacity = 1,
            FontSize = Math.Max(14, Math.Round(style.FontSize * 0.72)),
            FontFamily = style.FontFamily,
            NoteColor = style.NoteColor,
            Align = "left",
            T = t,
            Dur = 0,
        };
    }

    public static List<Element> DuplicateElements(IEnumerable<Element> list, double dx = 16, double dy = 16)
    {
        var copies = new List<Element>();
        foreach (var source in list)
        {
            var el = source.Clone();
            el.Id = Uid(el.Type.Length > 0 ? el.Type[..1] : "e");
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
            el.Meta = null;
            copies.Add(el);
        }
        return copies;
    }

    public static (bool Removed, List<Element> Pieces) EraseFromStroke(Element el, double x, double y, double radius)
    {
        var pts = el.Points ?? new List<PointD>();
        if (pts.Count == 0) return (false, new List<Element> { el });

        var keep = pts.Select(p => Num.Dist(p.X, p.Y, x, y) > radius).ToList();
        if (keep.All(k => k)) return (false, new List<Element> { el });
        if (keep.All(k => !k)) return (true, new List<Element>());

        var pieces = new List<Element>();
        var run = new List<int>();

        void Flush()
        {
            if (run.Count >= 2)
            {
                var piece = el.Clone();
                piece.Id = Uid("s");
                piece.Points = new List<PointD>();
                piece.Times = new List<double>();
                foreach (var idx in run)
                {
                    piece.Points.Add(pts[idx].Clone());
                    piece.Times.Add(el.Times is not null && idx < el.Times.Count ? el.Times[idx] : 0);
                }
                piece.Meta = null;
                pieces.Add(piece);
            }
            run.Clear();
        }

        for (var i = 0; i < keep.Count; i++)
        {
            if (keep[i]) run.Add(i);
            else Flush();
        }
        Flush();
        return (true, pieces);
    }

    public static string ElementName(Element el) => el.Type switch
    {
        "pen" => "笔迹",
        "highlighter" => "荧光笔",
        "line" => "直线",
        "arrow" => "箭头",
        "rect" => "矩形",
        "ellipse" => "椭圆",
        "text" => "文字",
        "note" => "便签",
        _ => el.Type,
    };
}
