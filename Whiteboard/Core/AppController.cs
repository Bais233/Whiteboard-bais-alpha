using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Whiteboard.Models;

namespace Whiteboard.Core;

public sealed class ToastItem
{
    public Guid Id { get; } = Guid.NewGuid();
    public string Message { get; init; } = "";
    public string Kind { get; init; } = "info";
    public bool Leaving { get; set; }
}

/// <summary>应用编排：启动、UI 持久化、快捷键、菜单动作、提示与保存状态。</summary>
public sealed class AppController
{
    private readonly BoardState _state;
    private readonly HistoryService _history;
    private readonly StorageService _storage;
    private readonly RenderService _render;
    private readonly ToolsService _tools;
    private readonly EditorService _editor;
    private readonly PlaybackService _playback;
    private readonly ExportService _export;
    private readonly IJSRuntime _js;

    private readonly List<ToastItem> _toasts = new();
    private CancellationTokenSource? _saveCts;
    private CancellationTokenSource? _uiCts;
    private DotNetObjectReference<InteropBridge>? _bridge;
    private bool _initializing;
    private bool _disposed;

    public AppController(
        BoardState state,
        HistoryService history,
        StorageService storage,
        RenderService render,
        ToolsService tools,
        EditorService editor,
        PlaybackService playback,
        ExportService export,
        IJSRuntime js)
    {
        _state = state;
        _history = history;
        _storage = storage;
        _render = render;
        _tools = tools;
        _editor = editor;
        _playback = playback;
        _export = export;
        _js = js;

        _history.Changed += OnHistoryChanged;
        _state.ToolChanged += PersistUi;
        _state.StyleChanged += PersistUi;
        _state.UiChanged += PersistUi;
        _state.BoardChanged += OnBoardChanged;
    }

    public event Action? HistoryStateChanged;
    public event Action? ToastsChanged;
    public event Action? SaveStateChanged;
    public event Action? PlaybackStateChanged;
    public event Action? DocumentReloaded;

    public bool CanUndo => _history.CanUndo;
    public bool CanRedo => _history.CanRedo;
    public string SaveLabel => _saveState;
    public IReadOnlyList<ToastItem> Toasts => _toasts;
    public bool MathOpen => _state.Ui.MathOpen;
    public bool HelpOpen => _state.Ui.HelpOpen;
    public bool ToolsCollapsed => _state.Ui.ToolsCollapsed;
    public string MobilePanel => _state.Ui.MobilePanel;
    public bool IsRecording => _state.Session.Recording;
    public PlaybackService Playback => _playback;

    private string _saveState = "saved";
    private bool IsDirty => _saveState == "dirty";
    public bool IsSaving => _saveState == "dirty";
    public bool HasSelection => _state.Selection.Count > 0;

    /* ------------------------------------------------------------------ 启动 */

    public async Task InitializeAsync(ElementReference canvas)
    {
        _initializing = true;
        var bridge = new InteropBridge(_tools, _editor, this, _render, _state);
        _bridge = DotNetObjectReference.Create(bridge);
        await _render.InitAsync(canvas, _bridge);
        await RefreshViewportAsync();

        var prefs = await _storage.ReadUiAsync();
        ApplyPrefs(prefs);

        var raw = await _storage.LocalGetAsync(BoardState.StorageKey);
        var doc = raw is null ? null : _storage.ParseDocument(raw);
        var restored = doc is not null ? _storage.ApplyDocument(doc) : 0;
        if (doc is not null) _state.Ui.Theme = IsDarkBoard ? "dark" : "light";

        _history.Init();

        if (restored > 0)
        {
            await _render.MeasureAllTextsAsync();
            _tools.FitToContent(72);
            ShowToast($"已恢复上次画板（{restored} 个元素）", "ok");
        }
        else
        {
            var seen = await _storage.LocalGetAsync(BoardState.FirstRunKey);
            if (string.IsNullOrEmpty(seen))
            {
                SeedWelcome();
                if (_state.Viewport.W < 900 || _state.Viewport.H < 640)
                {
                    await _render.MeasureAllTextsAsync();
                    _tools.FitToContent(48);
                }
                await _storage.LocalSetAsync(BoardState.FirstRunKey, "1");
            }
            else
            {
                await _render.MeasureAllTextsAsync();
                _tools.FitToContent(72);
            }
        }

        _initializing = false;
        _saveState = "saved";
        SaveStateChanged?.Invoke();
        _tools.UpdateCursor();
        _state.RaiseToolChanged();
        _state.RaiseStyleChanged();
        _state.RaiseBoardChanged();
        _state.RaiseUiChanged();
        _render.RequestRender();
        await SaveNowAsync();
    }

    private async Task RefreshViewportAsync()
    {
        try
        {
            var vp = await _js.InvokeAsync<ViewportDto>("whiteboard.getViewport");
            if (vp is not null)
            {
                _state.Viewport.W = vp.W;
                _state.Viewport.H = vp.H;
                _state.Viewport.Dpr = vp.Dpr;
            }
        }
        catch
        {
            _state.Viewport.W = 1280;
            _state.Viewport.H = 800;
        }
    }

    private void ApplyPrefs(UiPrefsDto? prefs)
    {
        if (prefs is null) return;
        if (prefs.Style is not null)
        {
            _state.Style.Color = prefs.Style.Color;
            _state.Style.Size = prefs.Style.Size > 0 ? prefs.Style.Size : 3;
            _state.Style.Opacity = prefs.Style.Opacity > 0 ? prefs.Style.Opacity : 1;
            _state.Style.Fill = prefs.Style.Fill;
            _state.Style.FontSize = prefs.Style.FontSize > 0 ? prefs.Style.FontSize : 24;
            if (!string.IsNullOrWhiteSpace(prefs.Style.FontFamily)) _state.Style.FontFamily = prefs.Style.FontFamily;
            if (!string.IsNullOrWhiteSpace(prefs.Style.NoteColor)) _state.Style.NoteColor = prefs.Style.NoteColor;
        }
        if (prefs.Board is not null)
        {
            _state.Board.Color = prefs.Board.Color;
            _state.Board.GridColor = prefs.Board.GridColor;
            _state.Board.Grid = prefs.Board.Grid is "dots" or "lines" or "none" ? prefs.Board.Grid : "dots";
            _state.Board.GridSize = prefs.Board.GridSize > 0 ? prefs.Board.GridSize : 24;
            _state.Board.Snap = prefs.Board.Snap;
        }
        _state.Ui.Theme = prefs.Theme ?? (IsDarkBoard ? "dark" : "light");
        if (!string.IsNullOrWhiteSpace(prefs.Tool) && ToolsService.ToolList.Any(t => t.Id == prefs.Tool))
        {
            _state.Tool = prefs.Tool;
        }
        _state.Ui.ToolsCollapsed = prefs.Collapsed;
    }

    private void SeedWelcome()
    {
        var cx = _state.Viewport.W / 2;
        var cy = _state.Viewport.H / 2;
        var font = _state.Style.FontFamily;
        _state.Elements.Add(new Element
        {
            Id = "seed-title", Type = "text", X = cx - 190, Y = cy - 150,
            Text = "白色画板 · Whiteboard bais alpha", Color = "#1f2937", Opacity = 1,
            FontSize = 34, FontFamily = font, Align = "left", T = 0, Dur = 0,
        });
        _state.Elements.Add(new Element
        {
            Id = "seed-sub", Type = "text", X = cx - 190, Y = cy - 96,
            Text = "按 P 写字，M 打开数学面板，F9 录制，F10 回放，? 看全部快捷键",
            Color = "#64748b", Opacity = 1, FontSize = 18, FontFamily = font, Align = "left", T = 0, Dur = 0,
        });
        _state.Elements.Add(new Element
        {
            Id = "seed-formula", Type = "text", X = cx - 190, Y = cy - 40,
            Text = "x = (-b ± √(b²-4ac))/(2a)", Color = "#2563eb", Opacity = 1,
            FontSize = 26, FontFamily = font, Align = "left", T = 0, Dur = 0,
        });
        _state.Elements.Add(new Element
        {
            Id = "seed-arrow", Type = "arrow", Color = "#ef4444", Size = 3, Opacity = 1, Fill = false,
            A = new PointD(cx + 120, cy - 20), B = new PointD(cx + 190, cy + 30), T = 0, Dur = 0,
        });
        _state.Elements.Add(new Element
        {
            Id = "seed-note", Type = "note", X = cx + 200, Y = cy + 20, W = 190, H = 130,
            Text = "便签可以拖出大小，\n双击再次编辑。", Color = "#1f2937", Opacity = 1,
            FontSize = 17, FontFamily = font, Align = "left", NoteColor = "#fff3a3", T = 0, Dur = 0,
        });
        _history.Commit("欢迎");
    }

    /* -------------------------------------------------------------- 保存状态 */

    private void OnHistoryChanged()
    {
        HistoryStateChanged?.Invoke();
        if (_initializing) return;
        MarkDirty();
    }

    private void MarkDirty()
    {
        if (_initializing || _disposed) return;
        _saveState = "dirty";
        SaveStateChanged?.Invoke();
        _saveCts?.Cancel();
        _saveCts = new CancellationTokenSource();
        _ = SaveAfterDelayAsync(_saveCts.Token);
    }

    private async Task SaveAfterDelayAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(600, ct);
            await SaveNowAsync();
        }
        catch (TaskCanceledException)
        {
            // 有新的变更，等待下一次
        }
    }

    public async Task SaveNowAsync()
    {
        try
        {
            await _storage.LocalSetAsync(BoardState.StorageKey, _storage.SerializeJson());
            _saveState = "saved";
            SaveStateChanged?.Invoke();
        }
        catch
        {
            // 忽略写入异常
        }
    }

    /* ------------------------------------------------------------------ 提示 */

    private void ShowToast(string message, string kind = "info", int ms = 2200)
    {
        var item = new ToastItem { Message = message, Kind = kind };
        _toasts.Add(item);
        ToastsChanged?.Invoke();
        _ = DismissToastAsync(item, ms);
    }

    private async Task DismissToastAsync(ToastItem item, int ms)
    {
        await Task.Delay(ms);
        item.Leaving = true;
        ToastsChanged?.Invoke();
        await Task.Delay(300);
        _toasts.Remove(item);
        ToastsChanged?.Invoke();
    }

    /* ---------------------------------------------------------------- 工具条 */

    public void SetTool(string id) => _tools.SetTool(id);

    public void ZoomIn() => _tools.ZoomBy(1.25);
    public void ZoomOut() => _tools.ZoomBy(1 / 1.25);
    public void ZoomReset() => _tools.ZoomTo(1);
    public void FitToContent(double padding = 60) => _tools.FitToContent(padding);

    public void CycleGrid()
    {
        var order = new[] { "dots", "lines", "none" };
        var index = Array.IndexOf(order, _state.Board.Grid);
        _state.Board.Grid = order[(index + 1) % order.Length];
        _state.RaiseBoardChanged();
        _render.RequestRender();
        MarkDirty();
        ShowToast($"网格：{(_state.Board.Grid switch { "dots" => "点阵", "lines" => "方格", _ => "关闭" })}");
    }

    public void ToggleSnap()
    {
        _state.Board.Snap = !_state.Board.Snap;
        _state.RaiseBoardChanged();
        ShowToast(_state.Board.Snap ? "已开启对齐网格" : "已关闭对齐网格");
    }

    public void ToggleRecording()
    {
        if (!_state.Session.Recording)
        {
            _state.Session.Recording = true;
            _state.Session.StartedAt = Clock.NowMs();
            ShowToast("录制已开始，笔迹将带时间轴");
        }
        else
        {
            _state.Session.Recording = false;
            _state.Session.Elapsed += Clock.NowMs() - _state.Session.StartedAt;
            ShowToast($"录制已停止，共 {Num.FormatTime(_state.Session.Elapsed)}");
        }
        _state.RaiseRecordingChanged();
        MarkDirty();
    }

    public void TogglePlayback()
    {
        if (_state.Playback.Active)
        {
            _playback.Stop();
            PlaybackStateChanged?.Invoke();
            return;
        }
        if (_playback.Duration() <= 0)
        {
            ShowToast("还没有可回放的笔迹，先打开录制（F9）再画几笔", "err");
            return;
        }
        _playback.Start();
        PlaybackStateChanged?.Invoke();
    }

    public void StopPlayback()
    {
        _playback.Stop();
        PlaybackStateChanged?.Invoke();
    }

    public void TogglePause() => _playback.TogglePause();
    public void SeekPlayback(double ratio) => _playback.Seek(ratio);
    public void SetPlaybackSpeed(double speed) => _playback.SetSpeed(speed);

    /* ---------------------------------------------------------------- 样式条 */

    public void SetColor(string color)
    {
        _state.Style.Color = color;
        if (_state.Selection.Count > 0) _tools.ApplyStyleToSelection(el => el.Color = color);
        _state.RaiseStyleChanged();
        _render.RequestRender();
    }

    public void SetNoteColor(string color)
    {
        _state.Style.NoteColor = color;
        _state.RaiseStyleChanged();
    }

    public void ToggleFill()
    {
        _state.Style.Fill = !_state.Style.Fill;
        if (_state.Selection.Count > 0) _tools.ApplyStyleToSelection(el => el.Fill = _state.Style.Fill);
        _state.RaiseStyleChanged();
        _render.RequestRender();
    }

    public void SetSize(double size)
    {
        _state.Style.Size = size;
        if (_state.Selection.Count > 0) _tools.ApplyStyleToSelection(el => el.Size = size);
        _state.RaiseStyleChanged();
        _render.RequestRender();
    }

    public void SetOpacity(double opacity)
    {
        _state.Style.Opacity = opacity;
        if (_state.Selection.Count > 0) _tools.ApplyStyleToSelection(el => el.Opacity = opacity);
        _state.RaiseStyleChanged();
        _render.RequestRender();
    }

    public void SetFontSize(double size)
    {
        _state.Style.FontSize = size;
        if (_state.Selection.Count > 0) _tools.ApplyStyleToSelection(el => el.FontSize = size);
        _state.RaiseStyleChanged();
        _render.RequestRender();
    }

    /* ------------------------------------------------------------ 选择 / 历史 */

    public void Undo()
    {
        if (_history.Undo()) _render.RequestRender();
        else ShowToast("没有可撤销的操作");
    }

    public void Redo()
    {
        if (_history.Redo()) _render.RequestRender();
        else ShowToast("没有可重做的操作");
    }

    public void DeleteSelection()
    {
        if (_tools.DeleteSelection()) ShowToast("已删除选中元素");
    }

    public void DuplicateSelection()
    {
        if (_tools.DuplicateSelection().Count > 0) ShowToast("已复制选中元素");
    }

    public void SelectAll()
    {
        _tools.SetTool("select");
        _tools.SelectAll();
    }

    public void Nudge(double dx, double dy) => _tools.NudgeSelection(dx, dy);

    public void Reorder(string mode) => _tools.ReorderSelection(mode);

    /* ---------------------------------------------------------------- 面板 */

    public void ToggleMathPanel()
    {
        _state.Ui.MobilePanel = "none";
        _state.Ui.MathOpen = !_state.Ui.MathOpen;
        _state.RaiseUiChanged();
    }

    public void CloseMathPanel()
    {
        if (!_state.Ui.MathOpen && _state.Ui.MobilePanel == "none") return;
        _state.Ui.MathOpen = false;
        _state.RaiseUiChanged();
    }

    public void ToggleMobilePanel(string panel)
    {
        var next = _state.Ui.MobilePanel == panel ? "none" : panel;
        _state.Ui.MobilePanel = next;
        if (next != "none") _state.Ui.MathOpen = false;
        _state.RaiseUiChanged();
    }

    public void CloseMobilePanel()
    {
        if (_state.Ui.MobilePanel == "none") return;
        _state.Ui.MobilePanel = "none";
        _state.RaiseUiChanged();
    }

    public void ToggleTools()
    {
        _state.Ui.ToolsCollapsed = !_state.Ui.ToolsCollapsed;
        _state.RaiseUiChanged();
    }

    public void ToggleHelp()
    {
        _state.Ui.MobilePanel = "none";
        _state.Ui.HelpOpen = !_state.Ui.HelpOpen;
        _state.RaiseUiChanged();
    }

    public void CloseHelp()
    {
        if (!_state.Ui.HelpOpen) return;
        _state.Ui.HelpOpen = false;
        _state.RaiseUiChanged();
    }

    /* ---------------------------------------------------------------- 数学 */

    public void InsertSymbol(string symbol)
    {
        if (_editor.InsertIntoEditor(symbol)) return;
        PlaceFormula(symbol);
    }

    public void InsertTex(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return;
        var text = MathService.TexToUnicode(raw);
        if (!_editor.InsertIntoEditor(text)) PlaceFormula(text);
    }

    public void PlaceFormula(string text)
    {
        if (string.IsNullOrEmpty(text)) return;
        var center = _state.ScreenToWorld(_state.Viewport.W / 2, _state.Viewport.H / 2);
        var node = Elements.CreateText(text, center.X, center.Y, _state.Style, _state.SessionTime());
        _state.Elements.Add(node);
        _state.Selection.Clear();
        _state.Selection.Add(node.Id);
        _history.Commit("公式");
        _tools.SetTool("select");
        _render.RequestRender();
        ShowToast("已插入到画板中心，可用选择工具拖动");
    }

    /* ---------------------------------------------------------------- 菜单 */

    public async Task RunActionAsync(string act)
    {
        try
        {
            switch (act)
            {
                case "save-json":
                    await _export.ExportJsonAsync();
                    ShowToast("已导出 .wbjson 工程", "ok");
                    break;
                case "open-json":
                    await _render.ClickAsync("#fileInput");
                    break;
                case "export-png":
                {
                    var (width, height) = await _export.ExportPngAsync();
                    ShowToast($"已导出 PNG（{width}×{height}）", "ok");
                    break;
                }
                case "export-svg":
                    await _export.ExportSvgAsync();
                    ShowToast("已导出 SVG", "ok");
                    break;
                case "print":
                    await _export.PrintAsync();
                    break;
                case "install-pwa":
                    await InstallPwaAsync();
                    break;
                case "help":
                    ToggleHelp();
                    break;
                case "board-white":
                    SetBoard("white");
                    break;
                case "board-eye":
                    SetBoard("eye");
                    break;
                case "board-dark":
                    SetBoard("dark");
                    break;
                case "clear":
                    await ClearBoardAsync();
                    break;
            }
        }
        catch (Exception ex)
        {
            ShowToast(ex.Message, "err", 3600);
        }
    }

    public async Task InstallPwaAsync()
    {
        try
        {
            var result = await _js.InvokeAsync<string>("whiteboard.installPwa");
            switch (result)
            {
                case "accepted":
                    ShowToast("正在安装到主屏幕…", "ok");
                    break;
                case "dismissed":
                    break;
                default:
                    ShowToast("请使用浏览器菜单里的“添加到主屏幕”");
                    break;
            }
        }
        catch
        {
            ShowToast("当前浏览器不支持自动安装，请使用浏览器菜单添加");
        }
    }

    private static readonly Dictionary<string, (string Color, string Grid, string Name)> BoardPresets = new()
    {
        ["white"] = ("#ffffff", "#dbe3ee", "纯白"),
        ["eye"] = ("#fdf9ef", "#e6dcc4", "护眼米色"),
        ["dark"] = ("#1b1f27", "#333a47", "深色墨板"),
    };

    public void SetBoard(string preset)
    {
        if (!BoardPresets.TryGetValue(preset, out var conf)) return;
        _state.Board.Color = conf.Color;
        _state.Board.GridColor = conf.Grid;
        _state.Ui.Theme = preset == "dark" ? "dark" : "light";
        if (IsDarkBoard && _state.Style.Color == "#1f2937") _state.Style.Color = "#ffffff";
        if (!IsDarkBoard && _state.Style.Color == "#ffffff") _state.Style.Color = "#1f2937";
        _state.RaiseBoardChanged();
        _state.RaiseStyleChanged();
        _render.RequestRender();
        MarkDirty();
        ShowToast($"板面：{conf.Name}");
    }

    public async Task ClearBoardAsync()
    {
        if (_state.Elements.Count == 0)
        {
            ShowToast("画板已经是空的");
            return;
        }
        var ok = await _js.InvokeAsync<bool>("whiteboard.confirm", $"确定清空 {_state.Elements.Count} 个元素？此操作可以撤销（Ctrl+Z）。");
        if (!ok) return;
        _state.Elements.Clear();
        _state.Selection.Clear();
        _history.Commit("清空");
        _render.RequestRender();
        ShowToast("已清空画板", "ok");
    }

    public async Task ImportJsonAsync(string text)
    {
        try
        {
            var count = await _export.ImportJsonAsync(text);
            _state.Ui.Theme = IsDarkBoard ? "dark" : "light";
            _state.RaiseBoardChanged();
            _state.RaiseStyleChanged();
            _state.RaiseUiChanged();
            DocumentReloaded?.Invoke();
            ShowToast($"已导入 {count} 个元素", "ok");
        }
        catch (Exception ex)
        {
            ShowToast($"导入失败：{ex.Message}", "err", 3600);
        }
    }

    public void NotifyError(string message) => ShowToast(message, "err", 3600);

    public async Task ImportDroppedFileAsync(string name, string text)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"\.(wb)?json$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        {
            ShowToast("只支持 .wbjson / .json 工程文件", "err");
            return;
        }
        await ImportJsonAsync(text);
    }

    /* ---------------------------------------------------------------- 快捷键 */

    public bool IsDarkBoard => Num.Luminance(_state.Board.Color) < 0.45;

    public void HandleKeyDown(KeyboardEventDto e)
    {
        _state.Interaction.AltDown = e.AltKey;
        var mod = e.CtrlKey || e.MetaKey;

        if (e.Code == "Space" && !e.Typing)
        {
            if (!_state.Interaction.SpaceDown)
            {
                _state.Interaction.SpaceDown = true;
                _tools.SetInteractionPanCursor();
            }
            return;
        }

        if (mod && e.Key.Equals("z", StringComparison.OrdinalIgnoreCase) && !e.ShiftKey)
        {
            Undo();
            return;
        }
        if ((mod && e.Key.Equals("y", StringComparison.OrdinalIgnoreCase)) ||
            (mod && e.ShiftKey && e.Key.Equals("z", StringComparison.OrdinalIgnoreCase)))
        {
            Redo();
            return;
        }
        if (mod && e.Key.Equals("s", StringComparison.OrdinalIgnoreCase))
        {
            _ = RunActionAsync("save-json");
            return;
        }
        if (mod && e.Key.Equals("p", StringComparison.OrdinalIgnoreCase))
        {
            _ = RunActionAsync("print");
            return;
        }
        if (mod && e.Key.Equals("b", StringComparison.OrdinalIgnoreCase))
        {
            ToggleTools();
            return;
        }
        if (e.Typing) return;

        if (mod && e.Key.Equals("d", StringComparison.OrdinalIgnoreCase))
        {
            DuplicateSelection();
            return;
        }
        if (mod && e.Key.Equals("a", StringComparison.OrdinalIgnoreCase))
        {
            SelectAll();
            return;
        }

        switch (e.Key)
        {
            case "Delete":
            case "Backspace":
                DeleteSelection();
                return;
            case "Escape":
                if (_state.Playback.Active) StopPlayback();
                CloseHelp();
                _state.Selection.Clear();
                _render.RequestRender();
                return;
            case "+":
            case "=":
                ZoomIn();
                return;
            case "-":
            case "_":
                ZoomOut();
                return;
            case "0":
                ZoomReset();
                return;
            case "1":
                FitToContent(60);
                return;
            case "g":
                CycleGrid();
                return;
            case "G":
                ToggleSnap();
                return;
            case "m":
                ToggleMathPanel();
                return;
            case "?":
                ToggleHelp();
                return;
            case "F9":
                ToggleRecording();
                return;
            case "F10":
                TogglePlayback();
                return;
            case "ArrowUp":
            case "ArrowDown":
            case "ArrowLeft":
            case "ArrowRight":
            {
                var step = (e.ShiftKey ? 10 : 1) / _state.Camera.Scale;
                var dx = e.Key == "ArrowLeft" ? -step : e.Key == "ArrowRight" ? step : 0;
                var dy = e.Key == "ArrowUp" ? -step : e.Key == "ArrowDown" ? step : 0;
                if (_state.Selection.Count > 0) Nudge(dx, dy);
                return;
            }
        }

        if (mod) return;
        var tool = ToolsService.ToolList.FirstOrDefault(t => t.Key.Equals(e.Key, StringComparison.OrdinalIgnoreCase));
        if (tool is not null) SetTool(tool.Id);
    }

    public void HandleKeyUp(KeyboardEventDto e)
    {
        _state.Interaction.AltDown = e.AltKey;
        if (e.Code == "Space")
        {
            _state.Interaction.SpaceDown = false;
            _tools.SetInteractionPanCursor();
        }
    }

    public void HandleWindowBlur()
    {
        _state.Interaction.SpaceDown = false;
        _state.Interaction.AltDown = false;
        _tools.SetInteractionPanCursor();
    }

    /* ------------------------------------------------------------ UI 持久化 */

    private void OnBoardChanged()
    {
        PersistUi();
        if (!_initializing) MarkDirty();
    }

    private void PersistUi()
    {
        if (_initializing || _disposed) return;
        _uiCts?.Cancel();
        _uiCts = new CancellationTokenSource();
        _ = PersistUiAfterAsync(_uiCts.Token);
    }

    private async Task PersistUiAfterAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(300, ct);
            await _storage.WriteUiAsync(new UiPrefsDto
            {
                Tool = _state.Tool,
                Style = _state.Style.Clone(),
                Board = _state.Board.Clone(),
                Theme = _state.Ui.Theme,
                Collapsed = _state.Ui.ToolsCollapsed,
            });
        }
        catch (TaskCanceledException)
        {
            // 忽略
        }
    }

    public void Dispose()
    {
        _disposed = true;
        _bridge?.Dispose();
        _bridge = null;
    }
}
