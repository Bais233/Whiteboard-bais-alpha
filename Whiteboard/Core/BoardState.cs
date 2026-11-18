using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>全局单一状态源（对应原 state.js）。</summary>
public sealed class BoardState
{
    public const string StorageKey = "whiteboard-bais-alpha:doc:v1";
    public const string UiKey = "whiteboard-bais-alpha:ui";
    public const string FirstRunKey = "whiteboard-bais-alpha:seen";

    public List<Element> Elements { get; set; } = new();
    public Camera Camera { get; } = new();
    public StyleSettings Style { get; } = new();
    public BoardSettings Board { get; } = new();
    public string Tool { get; set; } = "pen";
    public HashSet<string> Selection { get; } = new();
    public string? EditingId { get; set; }
    public SessionState Session { get; } = new();
    public PlaybackState Playback { get; } = new();
    public List<LaserBeam> Laser { get; } = new();
    public Viewport Viewport { get; } = new();
    public InteractionState Interaction { get; } = new();
    public UiState Ui { get; } = new();
    public DocumentMeta Meta { get; } = new();

    public event Action? ToolChanged;
    public event Action? StyleChanged;
    public event Action? BoardChanged;
    public event Action? RecordingChanged;
    public event Action? UiChanged;
    public event Action? DocumentChanged;

    public void RaiseToolChanged() => ToolChanged?.Invoke();
    public void RaiseStyleChanged() => StyleChanged?.Invoke();
    public void RaiseBoardChanged() => BoardChanged?.Invoke();
    public void RaiseRecordingChanged() => RecordingChanged?.Invoke();
    public void RaiseUiChanged() => UiChanged?.Invoke();
    public void RaiseDocumentChanged() => DocumentChanged?.Invoke();

    public const double MinScale = 0.1;
    public const double MaxScale = 8;

    public PointD ScreenToWorld(double sx, double sy) => new(
        (sx - Camera.X) / Camera.Scale,
        (sy - Camera.Y) / Camera.Scale);

    public PointD WorldToScreen(double wx, double wy) => new(
        wx * Camera.Scale + Camera.X,
        wy * Camera.Scale + Camera.Y);

    public static double ClampScale(double scale) => Num.Clamp(scale, MinScale, MaxScale);

    public double ZoomAt(double factor, double sx, double sy)
    {
        var before = ScreenToWorld(sx, sy);
        var scale = ClampScale(Camera.Scale * factor);
        Camera.Scale = scale;
        Camera.X = sx - before.X * scale;
        Camera.Y = sy - before.Y * scale;
        return scale;
    }

    public double SetScale(double scale, double? sx = null, double? sy = null)
    {
        var px = sx ?? Viewport.W / 2;
        var py = sy ?? Viewport.H / 2;
        var before = ScreenToWorld(px, py);
        var next = ClampScale(scale);
        Camera.Scale = next;
        Camera.X = px - before.X * next;
        Camera.Y = py - before.Y * next;
        return next;
    }

    public void PanBy(double dx, double dy)
    {
        Camera.X += dx;
        Camera.Y += dy;
    }

    public List<Element> SelectedElements()
    {
        if (Selection.Count == 0) return new List<Element>();
        return Elements.Where(el => Selection.Contains(el.Id)).ToList();
    }

    public Element? FindElement(string id) => Elements.FirstOrDefault(el => el.Id == id);

    public void ClearSelection() => Selection.Clear();

    public double SessionTime()
    {
        if (!Session.Recording) return Session.Elapsed;
        return Session.Elapsed + (Clock.NowMs() - Session.StartedAt);
    }

    public void Touch() => Meta.UpdatedAt = DateTimeOffset.Now.ToUnixTimeMilliseconds();
}
