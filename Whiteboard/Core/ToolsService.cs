using Whiteboard.Models;

namespace Whiteboard.Core;

public sealed record ToolDef(string Id, string Name, string Icon, string Key, string Hint);

/// <summary>指针交互状态机（对应原 tools.js）。</summary>
public sealed class ToolsService
{
    private const double EraseScreenRadius = 13;

    public static readonly ToolDef[] ToolList =
    {
        new("select", "选择", "i-select", "V", "框选 / 移动 / 缩放元素，双击文字可编辑"),
        new("hand", "抓手", "i-hand", "H", "拖动平移画布（等同按住 Space）"),
        new("pen", "钢笔", "i-pen", "P", "自由书写，支持压感与书写速度"),
        new("highlighter", "荧光笔", "i-highlighter", "Y", "半透明标记，叠加不加深"),
        new("eraser", "橡皮", "i-eraser", "E", "擦除笔迹（可只擦掉一段）或整个图形"),
        new("line", "直线", "i-line", "L", "按住 Shift 画水平/垂直线"),
        new("arrow", "箭头", "i-arrow", "A", "按住 Shift 约束角度"),
        new("rect", "矩形", "i-rect", "R", "按住 Shift 画正方形"),
        new("ellipse", "椭圆", "i-ellipse", "O", "按住 Shift 画正圆"),
        new("text", "文字", "i-text", "T", "点击落字，Esc 结束编辑"),
        new("note", "便签", "i-note", "N", "拖出便签，双击可再次编辑"),
        new("laser", "激光笔", "i-laser", "Z", "演示用，轨迹自动消失，不写入文档"),
    };

    private sealed class DragState
    {
        public string Mode = "";
        public Element? El;
        public Element? Origin;
        public PointD? StartWorld;
        public PointD? LastScreen;
        public PointD? Current;
        public double StartTime;
        public bool Moved;
        public bool Changed;
        public bool Additive;
        public string? Handle;
        public BBox? BBox;
        public LaserBeam? Beam;
    }

    private readonly BoardState _state;
    private readonly RenderService _render;
    private readonly HistoryService _history;
    private readonly EditorService _editor;

    private DragState? _drag;
    private readonly Dictionary<long, PointD> _pointers = new();
    private double _pinchDist;
    private PointD _pinchMid = new();
    private double _pinchScale = 1;
    private bool _laserAnimating;

    public ToolsService(BoardState state, RenderService render, HistoryService history, EditorService editor)
    {
        _state = state;
        _render = render;
        _history = history;
        _editor = editor;
    }

    public void SetTool(string id)
    {
        if (!ToolList.Any(t => t.Id == id)) return;
        if (_state.Tool == id) return;
        _state.Tool = id;
        if (id != "select") _state.Selection.Clear();
        UpdateCursor();
        _state.RaiseToolChanged();
        _render.RequestRender();
    }

    public void UpdateCursor()
    {
        var cursor = _state.Tool switch
        {
            "select" => "select",
            "hand" => _state.Interaction.Panning ? "handing" : "hand",
            "eraser" => "eraser",
            "text" => "text",
            "note" => "text",
            _ => _state.Interaction.SpaceDown ? "hand" : "crosshair",
        };
        _render.SetCursor(cursor);
    }

    /* ------------------------------------------------------------ 坐标换算 */

    private PointD ScreenToWorld(PointD screen) => _state.ScreenToWorld(screen.X, screen.Y);

    private void PanBy(double dx, double dy)
    {
        _state.PanBy(dx, dy);
        _editor.Sync();
    }

    private void ZoomAt(double factor, double x, double y)
    {
        _state.ZoomAt(factor, x, y);
        _editor.Sync();
    }

    private void SetScale(double scale, double? x = null, double? y = null)
    {
        _state.SetScale(scale, x, y);
        _editor.Sync();
    }

    /* -------------------------------------------------------------- 橡皮擦 */

    private bool EraseAt(double wx, double wy)
    {
        var r = EraseScreenRadius / _state.Camera.Scale;
        var hit = Geometry.PickElement(_state.Elements, wx, wy, r);
        if (hit is null) return false;
        if (Elements.PointTools.Contains(hit.Type))
        {
            var (removed, pieces) = Elements.EraseFromStroke(hit, wx, wy, r);
            if (!removed) return false;
            var i = _state.Elements.IndexOf(hit);
            _state.Elements.RemoveAt(i);
            _state.Elements.InsertRange(i, pieces);
            _state.Selection.Remove(hit.Id);
        }
        else
        {
            var i = _state.Elements.IndexOf(hit);
            if (i < 0) return false;
            _state.Elements.RemoveAt(i);
            _state.Selection.Remove(hit.Id);
        }
        return true;
    }

    /* ------------------------------------------------------------ 选择操作 */

    public bool DeleteSelection()
    {
        if (_state.Selection.Count == 0) return false;
        var ids = _state.Selection.ToHashSet();
        var before = _state.Elements.Count;
        _state.Elements = _state.Elements.Where(el => !ids.Contains(el.Id)).ToList();
        _state.Selection.Clear();
        if (_state.Elements.Count != before) _history.Commit("删除");
        _render.RequestRender();
        return true;
    }

    public List<Element> DuplicateSelection()
    {
        var list = _state.SelectedElements();
        if (list.Count == 0) return new List<Element>();
        var copies = Elements.DuplicateElements(list);
        _state.Elements.AddRange(copies);
        _state.Selection.Clear();
        foreach (var el in copies) _state.Selection.Add(el.Id);
        _history.Commit("复制");
        _render.RequestRender();
        return copies;
    }

    public void NudgeSelection(double dx, double dy)
    {
        var list = _state.SelectedElements();
        if (list.Count == 0) return;
        foreach (var el in list)
        {
            Geometry.TranslateElement(el, dx, dy);
            el.Meta = null;
        }
        _history.Commit("微调");
        _render.RequestRender();
    }

    public void SelectAll()
    {
        _state.Selection.Clear();
        foreach (var el in _state.Elements) _state.Selection.Add(el.Id);
        _render.RequestRender();
    }

    public void ReorderSelection(string mode)
    {
        var list = _state.SelectedElements();
        if (list.Count == 0) return;
        var ids = list.Select(el => el.Id).ToHashSet();
        var rest = _state.Elements.Where(el => !ids.Contains(el.Id)).ToList();
        _state.Elements = mode == "front" ? rest.Concat(list).ToList() : list.Concat(rest).ToList();
        _history.Commit(mode == "front" ? "置顶" : "置底");
        _render.RequestRender();
    }

    public void ApplyStyleToSelection(Action<Element> apply)
    {
        var list = _state.SelectedElements();
        if (list.Count == 0) return;
        foreach (var el in list)
        {
            apply(el);
            el.Meta = null;
        }
        _history.Commit("样式");
        _render.RequestRender();
    }

    private List<(string Id, PointD Screen)> HandlesFor(Element el)
    {
        var handles = new List<(string, PointD)>();
        if (el.A is not null && el.B is not null && (el.Type == "line" || el.Type == "arrow"))
        {
            handles.Add(("a", _state.WorldToScreen(el.A.X, el.A.Y)));
            handles.Add(("b", _state.WorldToScreen(el.B.X, el.B.Y)));
            return handles;
        }
        if (el.Type is "pen" or "highlighter") return handles;
        var bb = Geometry.ElementBBox(el);
        if (bb is not { } b) return handles;
        var p1 = _state.WorldToScreen(b.X, b.Y);
        var p2 = _state.WorldToScreen(b.X + b.W, b.Y + b.H);
        handles.Add(("nw", p1));
        handles.Add(("ne", new PointD(p2.X, p1.Y)));
        handles.Add(("sw", new PointD(p1.X, p2.Y)));
        handles.Add(("se", p2));
        return handles;
    }

    private (Element El, string Handle)? PickHandle(double sx, double sy)
    {
        if (_state.Selection.Count != 1) return null;
        var el = _state.SelectedElements()[0];
        foreach (var (id, p) in HandlesFor(el))
        {
            if (Math.Abs(p.X - sx) <= 8 && Math.Abs(p.Y - sy) <= 8) return (el, id);
        }
        return null;
    }

    /* ---------------------------------------------------------------- 指针 */

    public void PointerDown(PointerEventDto e)
    {
        var sp = new PointD(e.X, e.Y);
        var wp = ScreenToWorld(sp);
        _pointers[e.PointerId] = sp;

        if (_pointers.Count == 2)
        {
            var (dist, mid, scale) = PinchState();
            _pinchDist = dist;
            _pinchMid = mid;
            _pinchScale = scale;
            _drag = new DragState { Mode = "pinch" };
            return;
        }

        var wantPan = _state.Tool == "hand" || _state.Interaction.SpaceDown || _state.Interaction.AltDown ||
                      e.Button == 1 || (e.Button == 2 && _state.Tool != "select");
        if (wantPan)
        {
            _drag = new DragState { Mode = "pan", LastScreen = sp };
            _state.Interaction.Panning = true;
            UpdateCursor();
            return;
        }
        if (e.Button != 0) return;

        var tool = _state.Tool;

        if (tool == "select")
        {
            var handle = PickHandle(sp.X, sp.Y);
            if (handle is { } h)
            {
                _drag = new DragState
                {
                    Mode = "resize",
                    Handle = h.Handle,
                    El = h.El,
                    Origin = h.El.Clone(),
                    BBox = Geometry.ElementBBox(h.El),
                    StartWorld = wp,
                    Moved = false,
                };
                return;
            }
            var hit = Geometry.PickElement(_state.Elements, wp.X, wp.Y, 7 / _state.Camera.Scale);
            if (hit is not null)
            {
                if (e.ShiftKey)
                {
                    if (!_state.Selection.Remove(hit.Id)) _state.Selection.Add(hit.Id);
                }
                else if (!_state.Selection.Contains(hit.Id))
                {
                    _state.Selection.Clear();
                    _state.Selection.Add(hit.Id);
                }
                _drag = new DragState { Mode = "move", StartWorld = wp, Moved = false };
                _render.RequestRender();
                return;
            }
            if (!e.ShiftKey) _state.Selection.Clear();
            _drag = new DragState { Mode = "marquee", StartWorld = wp, Additive = e.ShiftKey };
            _state.Interaction.Marquee = new BBox(wp.X, wp.Y, 0, 0);
            _render.RequestRender();
            return;
        }

        if (tool == "eraser")
        {
            _drag = new DragState { Mode = "erase", Changed = false };
            if (EraseAt(wp.X, wp.Y)) _drag.Changed = true;
            _render.RequestRender();
            return;
        }

        if (tool == "laser")
        {
            var beam = new LaserBeam { Born = Clock.NowMs(), Points = new List<PointD> { wp } };
            _state.Laser.Add(beam);
            _drag = new DragState { Mode = "laser", Beam = beam };
            KeepAnimating();
            return;
        }

        if (Elements.PointTools.Contains(tool))
        {
            var t = _state.SessionTime();
            var el = Elements.CreateStroke(tool, _state.Style, new PointD(wp.X, wp.Y, PressureOf(e)), t);
            _state.Elements.Add(el);
            _drag = new DragState { Mode = "draw", El = el, StartTime = t };
            _render.RequestRender();
            return;
        }

        if (Elements.ShapeTools.Contains(tool))
        {
            var start = _state.Board.Snap ? SnapPoint(wp) : wp;
            var el = Elements.CreateShape(tool, start, new PointD(start.X, start.Y), _state.Style, _state.SessionTime());
            _state.Elements.Add(el);
            _drag = new DragState { Mode = "shape", El = el, StartWorld = start };
            _render.RequestRender();
            return;
        }

        if (tool == "note")
        {
            _drag = new DragState { Mode = "note", StartWorld = wp };
            return;
        }

        if (tool == "text")
        {
            _drag = new DragState { Mode = "idle" };
            StartTextAt(wp);
            return;
        }

        _drag = new DragState { Mode = "idle" };
    }

    private static double PressureOf(PointerEventDto e)
    {
        if (e.PointerType == "pen" && e.Pressure > 0) return Num.Clamp(e.Pressure * 1.25, 0.15, 1);
        return 0.55;
    }

    private PointD SnapPoint(PointD p)
    {
        var g = _state.Board.GridSize;
        return new PointD(Math.Round(p.X / g) * g, Math.Round(p.Y / g) * g);
    }

    private (double Dist, PointD Mid, double Scale) PinchState()
    {
        var pts = _pointers.Values.ToList();
        var a = pts[0];
        var b = pts[1];
        return (Num.Dist(a.X, a.Y, b.X, b.Y), new PointD((a.X + b.X) / 2, (a.Y + b.Y) / 2), _state.Camera.Scale);
    }

    public void PointerMove(PointerEventDto e)
    {
        var sp = new PointD(e.X, e.Y);
        var wp = ScreenToWorld(sp);
        _state.Interaction.Pointer = wp;
        if (_pointers.ContainsKey(e.PointerId)) _pointers[e.PointerId] = sp;

        if (_drag?.Mode == "pinch" && _pointers.Count == 2)
        {
            var (dist, mid, _) = PinchState();
            var factor = dist / Math.Max(1, _pinchDist);
            SetScale(_pinchScale * factor, _pinchMid.X, _pinchMid.Y);
            _state.PanBy(mid.X - _pinchMid.X, mid.Y - _pinchMid.Y);
            _render.RequestRender();
            return;
        }

        if (_drag is null)
        {
            if (_state.Tool == "select" && !_state.Interaction.SpaceDown)
            {
                var handle = PickHandle(sp.X, sp.Y);
                var hit = handle is null
                    ? Geometry.PickElement(_state.Elements, wp.X, wp.Y, 7 / _state.Camera.Scale)
                    : null;
                _render.SetCursor(handle is not null || hit is not null ? "move" : "select");
            }
            return;
        }

        switch (_drag.Mode)
        {
            case "pan":
            {
                var last = _drag.LastScreen!;
                PanBy(sp.X - last.X, sp.Y - last.Y);
                _drag.LastScreen = sp;
                _render.RequestRender();
                break;
            }
            case "draw":
            {
                Elements.AddPoint(_drag.El!, wp.X, wp.Y, PressureOf(e), _state.SessionTime() - _drag.StartTime);
                _render.RequestRender();
                break;
            }
            case "erase":
            {
                if (EraseAt(wp.X, wp.Y)) _drag.Changed = true;
                _render.RequestRender();
                break;
            }
            case "shape":
            {
                var end = _state.Board.Snap ? SnapPoint(wp) : wp;
                if (e.ShiftKey) end = ConstrainShape(_drag.El!.Type, _drag.StartWorld!, end);
                _drag.El!.B = end;
                _render.RequestRender();
                break;
            }
            case "move":
            {
                var start = _drag.StartWorld!;
                var dx = wp.X - start.X;
                var dy = wp.Y - start.Y;
                if (Math.Abs(dx) > 0.5 || Math.Abs(dy) > 0.5) _drag.Moved = true;
                if (!_drag.Moved) break;
                foreach (var el in _state.SelectedElements())
                {
                    Geometry.TranslateElement(el, dx, dy);
                    el.Meta = null;
                }
                _drag.StartWorld = wp;
                _render.RequestRender();
                break;
            }
            case "marquee":
            {
                var rect = BBox.FromPoints(_drag.StartWorld!, wp);
                _state.Interaction.Marquee = rect;
                var found = Geometry.ElementsInRect(_state.Elements, rect);
                var ids = found.Select(el => el.Id).ToHashSet();
                if (_drag.Additive)
                {
                    foreach (var id in ids) _state.Selection.Add(id);
                }
                else
                {
                    _state.Selection.Clear();
                    foreach (var id in ids) _state.Selection.Add(id);
                }
                _render.RequestRender();
                break;
            }
            case "resize":
                ApplyResize(wp);
                _render.RequestRender();
                break;
            case "laser":
                _drag.Beam!.Points.Add(wp);
                _render.RequestRender();
                break;
            case "note":
                _drag.Current = wp;
                _state.Interaction.Marquee = BBox.FromPoints(_drag.StartWorld!, wp);
                _render.RequestRender();
                break;
        }
    }

    private static PointD ConstrainShape(string type, PointD a, PointD b)
    {
        if (type is "line" or "arrow")
        {
            var dx = b.X - a.X;
            var dy = b.Y - a.Y;
            var angle = Math.Atan2(dy, dx);
            const double step = Math.PI / 12;
            var snapped = Math.Round(angle / step) * step;
            var len = Math.Sqrt(dx * dx + dy * dy);
            return new PointD(a.X + Math.Cos(snapped) * len, a.Y + Math.Sin(snapped) * len);
        }
        var size = Math.Max(Math.Abs(b.X - a.X), Math.Abs(b.Y - a.Y));
        return new PointD(
            a.X + Math.Sign(b.X - a.X == 0 ? 1 : b.X - a.X) * size,
            a.Y + Math.Sign(b.Y - a.Y == 0 ? 1 : b.Y - a.Y) * size);
    }

    private void ApplyResize(PointD wp)
    {
        if (_drag is null || _drag.El is not { } el || _drag.Origin is not { } origin) return;

        if (el.Type is "line" or "arrow")
        {
            var target = _drag.Handle == "a" ? "a" : "b";
            var next = origin.Clone();
            var point = _state.Board.Snap ? SnapPoint(wp) : new PointD(wp.X, wp.Y);
            if (target == "a") next.A = point;
            else next.B = point;
            el.A = next.A;
            el.B = next.B;
            _drag.Moved = true;
            return;
        }

        if (_drag.BBox is not { } bbox) return;
        double x1 = bbox.X, y1 = bbox.Y, x2 = bbox.X + bbox.W, y2 = bbox.Y + bbox.H;
        if (_drag.Handle!.Contains('w')) x1 = wp.X;
        if (_drag.Handle.Contains('e')) x2 = wp.X;
        if (_drag.Handle.Contains('n')) y1 = wp.Y;
        if (_drag.Handle.Contains('s')) y2 = wp.Y;
        var targetBox = BBox.FromPoints(new PointD(x1, y1), new PointD(x2, y2));
        if (targetBox.W < 4 || targetBox.H < 4) return;
        var resized = origin.Clone();
        Geometry.ScaleElementToBBox(resized, bbox, targetBox);
        el.Points = resized.Points;
        el.A = resized.A;
        el.B = resized.B;
        el.X = resized.X;
        el.Y = resized.Y;
        el.W = resized.W;
        el.H = resized.H;
        el.FontSize = resized.FontSize;
        el.MaxW = resized.MaxW;
        el.Meta = null;
        _drag.Moved = true;
    }

    public void PointerUp(PointerEventDto e)
    {
        _pointers.Remove(e.PointerId);
        if (_state.Interaction.Panning && _pointers.Count == 0)
        {
            _state.Interaction.Panning = false;
            UpdateCursor();
        }
        if (_drag is null) return;

        switch (_drag.Mode)
        {
            case "draw":
                Elements.FinalizeStroke(_drag.El!, _state.SessionTime());
                _history.Commit("绘制");
                break;
            case "shape":
            {
                var el = _drag.El!;
                var len = el.A is not null && el.B is not null
                    ? Num.Dist(el.A.X, el.A.Y, el.B.X, el.B.Y)
                    : 0;
                if (len < 2)
                {
                    _state.Elements.Remove(el);
                }
                else
                {
                    el.Dur = 0;
                    _history.Commit("图形");
                    _state.Selection.Clear();
                    _state.Selection.Add(el.Id);
                    SetTool("select");
                }
                break;
            }
            case "erase":
                if (_drag.Changed) _history.Commit("擦除");
                break;
            case "move":
                if (_drag.Moved) _history.Commit("移动");
                break;
            case "resize":
                if (_drag.Moved) _history.Commit("缩放");
                break;
            case "marquee":
                _state.Interaction.Marquee = null;
                break;
            case "note":
            {
                _state.Interaction.Marquee = null;
                var box = _drag.Current is not null ? BBox.FromPoints(_drag.StartWorld!, _drag.Current) : (BBox?)null;
                var w = box is { } b && b.W > 60 ? Math.Round(b.W) : 180;
                var h = box is { } b2 && b2.H > 48 ? Math.Round(b2.H) : 140;
                var start = _drag.StartWorld!;
                var el = Elements.CreateNote(start.X, start.Y, _state.Style, "", w, h, _state.SessionTime());
                _state.Elements.Add(el);
                _state.Selection.Clear();
                _state.Selection.Add(el.Id);
                _editor.Open(el, true);
                break;
            }
        }
        _drag = null;
        _render.RequestRender();
    }

    public void PointerCancel(PointerEventDto e)
    {
        _pointers.Remove(e.PointerId);
        if (_drag is { Mode: "draw" or "shape" } && _drag.El is not null)
        {
            _state.Elements.Remove(_drag.El);
        }
        _drag = null;
        _state.Interaction.Marquee = null;
        _render.RequestRender();
    }

    public void PointerLeave()
    {
        _state.Interaction.Pointer = null;
    }

    /* -------------------------------------------------------------- 滚轮缩放 */

    public void Wheel(WheelEventDto e)
    {
        if (e.ShiftKey && !e.CtrlKey && !e.MetaKey)
        {
            PanBy(-e.DeltaY, 0);
            _render.RequestRender();
            return;
        }
        var unit = e.DeltaMode == 1 ? 16 : e.DeltaMode == 2 ? 400 : 1;
        var delta = e.DeltaY * unit;
        var factor = Math.Exp(-delta * 0.0016);
        ZoomAt(factor, e.X, e.Y);
        _render.RequestRender();
    }

    /* ------------------------------------------------------------ 双击编辑 */

    public void DoubleClick(PointerEventDto e)
    {
        var wp = _state.ScreenToWorld(e.X, e.Y);
        var hit = Geometry.PickElement(_state.Elements, wp.X, wp.Y, 8 / _state.Camera.Scale);
        if (hit is not null && hit.IsTextLike)
        {
            _editor.Open(hit, false);
            return;
        }
        if (hit is null)
        {
            SetTool("text");
            StartTextAt(wp);
        }
    }

    private void StartTextAt(PointD wp)
    {
        var el = new Element
        {
            Id = $"tmp-{DateTimeOffset.Now.ToUnixTimeMilliseconds():x}",
            Type = "text",
            X = wp.X,
            Y = wp.Y,
            Text = "",
            Color = _state.Style.Color,
            Opacity = _state.Style.Opacity,
            FontSize = _state.Style.FontSize,
            FontFamily = _state.Style.FontFamily,
            Align = "left",
            T = _state.SessionTime(),
            Dur = 0,
            Pending = true,
        };
        _editor.Open(el, true);
    }

    /* ------------------------------------------------------------ 激光清理 */

    private void KeepAnimating()
    {
        if (_laserAnimating) return;
        _laserAnimating = true;
        _ = LaserTickAsync();
    }

    private async Task LaserTickAsync()
    {
        while (true)
        {
            var now = Clock.NowMs();
            _state.Laser.RemoveAll(b => now - b.Born >= 900);
            _render.RequestRender();
            if (_state.Laser.Count == 0)
            {
                _laserAnimating = false;
                return;
            }
            await Task.Delay(16);
        }
    }

    /* -------------------------------------------------------------- 缩放 API */

    public double ZoomBy(double factor)
    {
        var s = _state.ZoomAt(factor, _state.Viewport.W / 2, _state.Viewport.H / 2);
        _editor.Sync();
        _render.RequestRender();
        return s;
    }

    public double ZoomTo(double scale)
    {
        var s = _state.SetScale(scale);
        _editor.Sync();
        _render.RequestRender();
        return s;
    }

    public double FitToContent(double padding = 48)
    {
        var boxes = _state.Elements.Select(Geometry.ElementBBox).Where(b => b is not null).Select(b => b!.Value).ToList();
        if (boxes.Count == 0)
        {
            _state.Camera.Scale = 1;
            _state.Camera.X = 0;
            _state.Camera.Y = 0;
            _editor.Sync();
            _render.RequestRender();
            return 1;
        }
        var merged = BBox.Merge(boxes.Select(b => (BBox?)b))!.Value;
        var w = Math.Max(1, merged.W);
        var h = Math.Max(1, merged.H);
        var scale = Num.Clamp(
            Math.Min((_state.Viewport.W - padding * 2) / w, (_state.Viewport.H - padding * 2) / h), 0.1, 4);
        _state.Camera.Scale = scale;
        _state.Camera.X = _state.Viewport.W / 2 - (merged.X + merged.W / 2) * scale;
        _state.Camera.Y = _state.Viewport.H / 2 - (merged.Y + merged.H / 2) * scale;
        _editor.Sync();
        _render.RequestRender();
        return scale;
    }

    public void SetInteractionPanCursor()
    {
        UpdateCursor();
    }
}
