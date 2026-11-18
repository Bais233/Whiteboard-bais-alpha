using Microsoft.JSInterop;
using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>JS → C# 回调入口。</summary>
public sealed class InteropBridge
{
    private readonly ToolsService _tools;
    private readonly EditorService _editor;
    private readonly AppController _app;
    private readonly RenderService _render;
    private readonly BoardState _state;

    public InteropBridge(ToolsService tools, EditorService editor, AppController app, RenderService render, BoardState state)
    {
        _tools = tools;
        _editor = editor;
        _app = app;
        _render = render;
        _state = state;
    }

    [JSInvokable]
    public void PointerDown(PointerEventDto e) => _tools.PointerDown(e);

    [JSInvokable]
    public void PointerMove(PointerEventDto e) => _tools.PointerMove(e);

    [JSInvokable]
    public void PointerUp(PointerEventDto e) => _tools.PointerUp(e);

    [JSInvokable]
    public void PointerCancel(PointerEventDto e) => _tools.PointerCancel(e);

    [JSInvokable]
    public void PointerLeave() => _tools.PointerLeave();

    [JSInvokable]
    public void Wheel(WheelEventDto e) => _tools.Wheel(e);

    [JSInvokable]
    public void DoubleClick(PointerEventDto e) => _tools.DoubleClick(e);

    [JSInvokable]
    public void KeyDown(KeyboardEventDto e) => _app.HandleKeyDown(e);

    [JSInvokable]
    public void KeyUp(KeyboardEventDto e) => _app.HandleKeyUp(e);

    [JSInvokable]
    public void WindowBlur() => _app.HandleWindowBlur();

    [JSInvokable]
    public void OnViewport(ViewportDto vp)
    {
        _state.Viewport.W = vp.W;
        _state.Viewport.H = vp.H;
        _state.Viewport.Dpr = vp.Dpr;
        _editor.Sync();
    }

    [JSInvokable]
    public void EditorInput(string text) => _editor.OnInput(text);

    [JSInvokable]
    public Task EditorCommit() => _editor.CommitAsync();

    [JSInvokable]
    public void EditorCancel() => _editor.Cancel();

    [JSInvokable]
    public void TextMetrics(TextMetricDto[] metrics) => _render.ApplyTextMetrics(metrics);

    [JSInvokable]
    public Task FileDropped(string name, string text) => _app.ImportDroppedFileAsync(name, text);

    [JSInvokable]
    public Task SaveNow() => _app.SaveNowAsync();

    [JSInvokable]
    public Task EditorFocused() => Task.CompletedTask;
}
