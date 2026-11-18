using System.Diagnostics;

namespace Whiteboard.Core;

/// <summary>单调递增的高精度时间（毫秒），对应原 utils.nowMs()。</summary>
public static class Clock
{
    private static readonly Stopwatch Watch = Stopwatch.StartNew();

    public static double NowMs() => Watch.Elapsed.TotalMilliseconds;
}

public static class Num
{
    public static double Clamp(double v, double min, double max) => v < min ? min : v > max ? max : v;

    public static double Dist(double ax, double ay, double bx, double by) =>
        Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));

    public static double Round(double v, int digits) => Math.Round(v, digits);

    public static string FormatTime(double ms)
    {
        var total = Math.Max(0, (int)Math.Round(ms / 1000.0));
        var h = total / 3600;
        var m = total % 3600 / 60;
        var s = total % 60;
        return h > 0 ? $"{h}:{m:00}:{s:00}" : $"{m:00}:{s:00}";
    }

    public static string Stamp(string ext = "png", string prefix = "whiteboard")
    {
        var d = DateTime.Now;
        return $"{prefix}-{d:yyyyMMdd-HHmmss}.{ext}";
    }

    public static string NormalizeHex(string? color)
    {
        if (string.IsNullOrWhiteSpace(color)) return "#000000";
        var c = color.Trim();
        if (c[0] != '#') return c;
        if (c.Length == 4) c = $"#{c[1]}{c[1]}{c[2]}{c[2]}{c[3]}{c[3]}";
        if (!System.Text.RegularExpressions.Regex.IsMatch(c, "^#[0-9a-fA-F]{6}$")) return "#000000";
        return c.ToLowerInvariant();
    }

    public static double Luminance(string? color)
    {
        var c = NormalizeHex(color);
        if (c[0] != '#') return 1;
        var r = Convert.ToInt32(c.Substring(1, 2), 16) / 255.0;
        var g = Convert.ToInt32(c.Substring(3, 2), 16) / 255.0;
        var b = Convert.ToInt32(c.Substring(5, 2), 16) / 255.0;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
}
