using System.Globalization;
using System.Text;
using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>导出 PNG / SVG / JSON，导入与打印（对应原 export.js）。</summary>
public sealed class ExportService
{
    private readonly BoardState _state;
    private readonly StorageService _storage;
    private readonly RenderService _render;
    private readonly HistoryService _history;
    private readonly ToolsService _tools;

    public ExportService(BoardState state, StorageService storage, RenderService render, HistoryService history, ToolsService tools)
    {
        _state = state;
        _storage = storage;
        _render = render;
        _history = history;
        _tools = tools;
    }

    public async Task ExportJsonAsync()
    {
        if (_state.Elements.Count == 0) throw new InvalidOperationException("画板是空的，没有可导出的内容");
        var json = _storage.SerializeJson(indented: true);
        await _render.DownloadTextAsync(Num.Stamp("wbjson"), json, "application/json;charset=utf-8");
    }

    public async Task<(int Width, int Height)> ExportPngAsync()
    {
        if (_state.Elements.Count == 0) throw new InvalidOperationException("画板是空的，没有可导出的内容");
        var result = await _render.ExportPngAsync();
        if (!string.IsNullOrEmpty(result.Error)) throw new InvalidOperationException(result.Error);
        return (result.Width, result.Height);
    }

    public async Task ExportSvgAsync()
    {
        if (_state.Elements.Count == 0) throw new InvalidOperationException("画板是空的，没有可导出的内容");
        await _render.MeasureAllTextsAsync();
        var box = Geometry.ContentBBox(_state.Elements, 24) ?? new BBox(0, 0, 1, 1);
        var sb = new StringBuilder();
        var parts = new List<string>();

        foreach (var el in _state.Elements)
        {
            var alpha = el.Opacity ?? 1;
            switch (el.Type)
            {
                case "pen":
                case "highlighter":
                    parts.Add(
                        $"<path d=\"{StrokePath(el)}\" fill=\"none\" stroke=\"{Esc(el.Color)}\" stroke-opacity=\"{F(el.Type == "highlighter" ? Math.Min(alpha, 0.42) : alpha)}\" stroke-width=\"{F(el.Type == "highlighter" ? el.Size ?? 2 : AvgWidth(el))}\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>");
                    break;
                case "line":
                    parts.Add(
                        $"<line x1=\"{F(el.A!.X)}\" y1=\"{F(el.A.Y)}\" x2=\"{F(el.B!.X)}\" y2=\"{F(el.B.Y)}\" stroke=\"{Esc(el.Color)}\" stroke-opacity=\"{F(alpha)}\" stroke-width=\"{F(el.Size ?? 2)}\" stroke-linecap=\"round\"/>");
                    break;
                case "arrow":
                {
                    var angle = Math.Atan2(el.B!.Y - el.A!.Y, el.B.X - el.A.X);
                    var head = Math.Max(10, (el.Size ?? 2) * 4.2);
                    var spread = Math.PI / 7;
                    var p1 = new PointD(el.B.X - head * Math.Cos(angle - spread), el.B.Y - head * Math.Sin(angle - spread));
                    var p2 = new PointD(el.B.X - head * 0.62 * Math.Cos(angle), el.B.Y - head * 0.62 * Math.Sin(angle));
                    var p3 = new PointD(el.B.X - head * Math.Cos(angle + spread), el.B.Y - head * Math.Sin(angle + spread));
                    parts.Add(
                        $"<line x1=\"{F(el.A.X)}\" y1=\"{F(el.A.Y)}\" x2=\"{F(el.B.X)}\" y2=\"{F(el.B.Y)}\" stroke=\"{Esc(el.Color)}\" stroke-opacity=\"{F(alpha)}\" stroke-width=\"{F(el.Size ?? 2)}\" stroke-linecap=\"round\"/>");
                    parts.Add(
                        $"<polygon points=\"{F(el.B.X)},{F(el.B.Y)} {F(p1.X)},{F(p1.Y)} {F(p2.X)},{F(p2.Y)} {F(p3.X)},{F(p3.Y)}\" fill=\"{Esc(el.Color)}\" fill-opacity=\"{F(alpha)}\"/>");
                    break;
                }
                case "rect":
                {
                    if (el.A is null || el.B is null) break;
                    var b = BBox.FromPoints(el.A, el.B);
                    parts.Add(
                        $"<rect x=\"{F(b.X)}\" y=\"{F(b.Y)}\" width=\"{F(b.W)}\" height=\"{F(b.H)}\" rx=\"{F(Math.Min(6, Math.Min(b.W, b.H) / 6))}\" fill=\"{(el.Fill == true ? Esc(el.Color) : "none")}\" fill-opacity=\"{F(alpha)}\" stroke=\"{Esc(el.Color)}\" stroke-opacity=\"{F(alpha)}\" stroke-width=\"{F(el.Size ?? 2)}\"/>");
                    break;
                }
                case "ellipse":
                {
                    if (el.A is null || el.B is null) break;
                    var b = BBox.FromPoints(el.A, el.B);
                    parts.Add(
                        $"<ellipse cx=\"{F(b.X + b.W / 2)}\" cy=\"{F(b.Y + b.H / 2)}\" rx=\"{F(Math.Abs(b.W / 2))}\" ry=\"{F(Math.Abs(b.H / 2))}\" fill=\"{(el.Fill == true ? Esc(el.Color) : "none")}\" fill-opacity=\"{F(alpha)}\" stroke=\"{Esc(el.Color)}\" stroke-opacity=\"{F(alpha)}\" stroke-width=\"{F(el.Size ?? 2)}\"/>");
                    break;
                }
                case "note":
                {
                    var w = el.W ?? 180;
                    var h = el.H ?? 140;
                    parts.Add($"<rect x=\"{F(el.X ?? 0)}\" y=\"{F(el.Y ?? 0)}\" width=\"{F(w)}\" height=\"{F(h)}\" rx=\"6\" fill=\"{Esc(el.NoteColor ?? "#fff3a3")}\"/>");
                    var lines = TextLines(el);
                    var group = new StringBuilder();
                    group.Append($"<g font-family=\"{Esc(el.FontFamily)}\" font-size=\"{F(el.FontSize ?? 24)}\" fill=\"{Esc(el.Color)}\" opacity=\"{F(alpha)}\">");
                    foreach (var line in lines)
                    {
                        group.Append($"<text x=\"{F((el.X ?? 0) + 12)}\" y=\"{F(line.Y + 12 + 4)}\">{Esc(line.Text)}</text>");
                    }
                    group.Append("</g>");
                    parts.Add(group.ToString());
                    break;
                }
                case "text":
                {
                    var lines = TextLines(el);
                    var group = new StringBuilder();
                    group.Append($"<g font-family=\"{Esc(el.FontFamily)}\" font-size=\"{F(el.FontSize ?? 24)}\" fill=\"{Esc(el.Color)}\" opacity=\"{F(alpha)}\">");
                    foreach (var line in lines)
                    {
                        group.Append($"<text x=\"{F(el.X ?? 0)}\" y=\"{F(line.Y)}\">{Esc(line.Text)}</text>");
                    }
                    group.Append("</g>");
                    parts.Add(group.ToString());
                    break;
                }
            }
        }

        sb.Append($"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{Math.Round(box.W)}\" height=\"{Math.Round(box.H)}\" ");
        sb.Append($"viewBox=\"{F(box.X)} {F(box.Y)} {F(box.W)} {F(box.H)}\">");
        sb.Append($"<rect x=\"{F(box.X)}\" y=\"{F(box.Y)}\" width=\"{F(box.W)}\" height=\"{F(box.H)}\" fill=\"{Esc(_state.Board.Color)}\"/>");
        sb.Append(string.Concat(parts));
        sb.Append("</svg>");

        await _render.DownloadTextAsync(Num.Stamp("svg"), sb.ToString(), "image/svg+xml;charset=utf-8");
    }

    public async Task<int> ImportJsonAsync(string text)
    {
        var data = _storage.ParseDocument(text) ?? throw new InvalidOperationException("不是有效的画板文件");
        var count = _storage.ApplyDocument(data);
        _history.Commit("导入");
        await _render.MeasureAllTextsAsync();
        _tools.FitToContent(60);
        _render.RequestRender();
        return count;
    }

    public async Task PrintAsync()
    {
        if (_state.Elements.Count == 0) throw new InvalidOperationException("画板是空的");
        await _render.PrintAsync();
    }

    private static string Esc(string? s) => (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;")
        .Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&apos;");

    private static string F(double v) => v.ToString("0.####", CultureInfo.InvariantCulture);

    private static string StrokePath(Element el)
    {
        var pts = el.Points;
        if (pts is null || pts.Count == 0) return "";
        if (pts.Count == 1) return $"M {F(pts[0].X)} {F(pts[0].Y)} L {F(pts[0].X + 0.01)} {F(pts[0].Y)}";
        var sb = new StringBuilder($"M {F(pts[0].X)} {F(pts[0].Y)}");
        for (var i = 1; i < pts.Count; i++)
        {
            var prev = pts[i - 1];
            var cur = pts[i];
            var next = i + 1 < pts.Count ? pts[i + 1] : null;
            var p0X = i == 1 ? prev.X : (prev.X + cur.X) / 2;
            var p0Y = i == 1 ? prev.Y : (prev.Y + cur.Y) / 2;
            var p1X = next is null ? cur.X : (cur.X + next.X) / 2;
            var p1Y = next is null ? cur.Y : (cur.Y + next.Y) / 2;
            sb.Append($" M {F(p0X)} {F(p0Y)} Q {F(cur.X)} {F(cur.Y)} {F(p1X)} {F(p1Y)}");
        }
        return sb.ToString();
    }

    private static double AvgWidth(Element el)
    {
        var pts = el.Points;
        if (pts is null || pts.Count == 0) return el.Size ?? 2;
        double sum = 0;
        foreach (var p in pts) sum += 0.5 + 0.5 * (p.P ?? 0.5);
        return (el.Size ?? 2) * (sum / pts.Count);
    }

    private static List<(string Text, double Y)> TextLines(Element el)
    {
        var lines = new List<(string, double)>();
        var meta = el.Meta;
        if (meta is null || meta.Lines.Count == 0) return lines;
        var lh = meta.Lh > 0 ? meta.Lh : Math.Round((el.FontSize ?? 24) * 1.35);
        for (var i = 0; i < meta.Lines.Count; i++)
        {
            lines.Add((meta.Lines[i].Text, (el.Y ?? 0) + i * lh + (el.FontSize ?? 24) * 0.92));
        }
        return lines;
    }
}
