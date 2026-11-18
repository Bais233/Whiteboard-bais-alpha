using System.Text.Json.Serialization;

namespace Whiteboard.Models;

public sealed class Camera
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Scale { get; set; } = 1;

    public Camera Clone() => new() { X = X, Y = Y, Scale = Scale };
}

public sealed class BoardSettings
{
    public string Color { get; set; } = "#ffffff";
    public string GridColor { get; set; } = "#dbe3ee";
    public string Grid { get; set; } = "dots"; // dots | lines | none
    public double GridSize { get; set; } = 24;
    public bool Snap { get; set; }

    public BoardSettings Clone() => new()
    {
        Color = Color,
        GridColor = GridColor,
        Grid = Grid,
        GridSize = GridSize,
        Snap = Snap,
    };
}

public sealed class StyleSettings
{
    public string Color { get; set; } = "#1f2937";
    public double Size { get; set; } = 3;
    public double Opacity { get; set; } = 1;
    public bool Fill { get; set; }
    public double FontSize { get; set; } = 24;
    public string FontFamily { get; set; } = "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif";
    public string NoteColor { get; set; } = "#fff3a3";

    public StyleSettings Clone() => new()
    {
        Color = Color,
        Size = Size,
        Opacity = Opacity,
        Fill = Fill,
        FontSize = FontSize,
        FontFamily = FontFamily,
        NoteColor = NoteColor,
    };
}

public sealed class SessionState
{
    public bool Recording { get; set; }
    public double StartedAt { get; set; }
    public double Elapsed { get; set; }
}

public sealed class PlaybackState
{
    public bool Active { get; set; }
    public bool Paused { get; set; }
    public double T { get; set; }
    public double Speed { get; set; } = 1;
    public double Duration { get; set; }
    public double StartedAt { get; set; }
}

public sealed class LaserBeam
{
    public double Born { get; set; }
    public List<PointD> Points { get; set; } = new();
}

public sealed class Viewport
{
    public double W { get; set; }
    public double H { get; set; }
    public double Dpr { get; set; } = 1;
}

public sealed class InteractionState
{
    public PointD? Pointer { get; set; }
    public bool Panning { get; set; }
    public bool SpaceDown { get; set; }
    public bool AltDown { get; set; }
    public BBox? Marquee { get; set; }
    public bool HoverResize { get; set; }
}

public sealed class UiState
{
    public string Theme { get; set; } = "light";
    public bool MathOpen { get; set; }
    public bool ToolsCollapsed { get; set; }
    public bool HelpOpen { get; set; }
}

public sealed class DocumentMeta
{
    public string Id { get; set; } = "doc-" + Guid.NewGuid().ToString("N")[..8];
    public string Title { get; set; } = "未命名画板";
    public double CreatedAt { get; set; } = DateTimeOffset.Now.ToUnixTimeMilliseconds();
    public double UpdatedAt { get; set; } = DateTimeOffset.Now.ToUnixTimeMilliseconds();
    public int Version { get; set; } = 1;
}

public sealed class SessionDto
{
    public double Elapsed { get; set; }
}

public sealed class DocumentDto
{
    public string Format { get; set; } = "whiteboard-bais-alpha";
    public int Version { get; set; } = 1;
    public DocumentMeta Meta { get; set; } = new();
    public BoardSettings Board { get; set; } = new();
    public Camera Camera { get; set; } = new();
    public SessionDto Session { get; set; } = new();
    public List<Element> Elements { get; set; } = new();
}

public sealed class SceneDto
{
    public List<Element> Elements { get; set; } = new();
    public Camera Camera { get; set; } = new();
    public BoardSettings Board { get; set; } = new();
    public List<string> Selection { get; set; } = new();
    public string? EditingId { get; set; }
    public BBox? Marquee { get; set; }
    public List<LaserBeam> Laser { get; set; } = new();
    public PlaybackState Playback { get; set; } = new();
    public Viewport Viewport { get; set; } = new();
    public double Now { get; set; }
    public string Tool { get; set; } = "pen";
}

public sealed class UiPrefsDto
{
    public string? Tool { get; set; }
    public StyleSettings? Style { get; set; }
    public BoardSettings? Board { get; set; }
    public string? Theme { get; set; }
    public bool Collapsed { get; set; }
}

public sealed class PointerEventDto
{
    public long PointerId { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public int Button { get; set; }
    public string? PointerType { get; set; }
    public double Pressure { get; set; }
    public bool ShiftKey { get; set; }
    public bool CtrlKey { get; set; }
    public bool AltKey { get; set; }
    public bool MetaKey { get; set; }
}

public sealed class WheelEventDto
{
    public double X { get; set; }
    public double Y { get; set; }
    public double DeltaY { get; set; }
    public int DeltaMode { get; set; }
    public bool ShiftKey { get; set; }
    public bool CtrlKey { get; set; }
    public bool MetaKey { get; set; }
}

public sealed class KeyboardEventDto
{
    public string Key { get; set; } = "";
    public string Code { get; set; } = "";
    public bool CtrlKey { get; set; }
    public bool ShiftKey { get; set; }
    public bool AltKey { get; set; }
    public bool MetaKey { get; set; }
    public bool Typing { get; set; }
}

public sealed class TextMetricDto
{
    public string Id { get; set; } = "";
    public string Key { get; set; } = "";
    public double W { get; set; }
    public double H { get; set; }
    public double Lh { get; set; }
    public List<TextLine> Lines { get; set; } = new();
}

public sealed class MeasureRequestDto
{
    public string Text { get; set; } = "";
    public double FontSize { get; set; } = 24;
    public string FontFamily { get; set; } = "sans-serif";
    public double? MaxWidth { get; set; }
}

public sealed class ViewportDto
{
    public double W { get; set; }
    public double H { get; set; }
    public double Dpr { get; set; }
}

public sealed class EditorConfigDto
{
    public string Text { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double FontSize { get; set; }
    public string FontFamily { get; set; } = "sans-serif";
    public string Color { get; set; } = "#111827";
    public string Align { get; set; } = "left";
    public double Scale { get; set; } = 1;
    public bool IsNote { get; set; }
    public double TransformX { get; set; }
    public double TransformY { get; set; }
    public double CameraX { get; set; }
    public double CameraY { get; set; }
}

public sealed class ImportResultDto
{
    public int Count { get; set; }
}

public sealed class PngResultDto
{
    public int Width { get; set; }
    public int Height { get; set; }
    public string? Error { get; set; }
}
