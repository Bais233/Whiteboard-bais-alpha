using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>Canvas 互操作：场景序列化、渲染调度、文字测量、编辑浮层与导出。</summary>
public sealed class RenderService
{
    private readonly IJSRuntime _js;
    private readonly BoardState _state;
    private DotNetObjectReference<InteropBridge>? _bridge;
    private bool _initialized;

    public RenderService(IJSRuntime js, BoardState state)
    {
        _js = js;
        _state = state;
    }

    public async Task InitAsync(ElementReference canvas, DotNetObjectReference<InteropBridge> bridge)
    {
        _bridge = bridge;
        await _js.InvokeVoidAsync("whiteboard.init", canvas, bridge);
        _initialized = true;
    }

    public string BuildSceneJson()
    {
        var scene = new SceneDto
        {
            Elements = _state.Elements,
            Camera = _state.Camera,
            Board = _state.Board,
            Selection = _state.Selection.ToList(),
            EditingId = _state.EditingId,
            Marquee = _state.Interaction.Marquee,
            Laser = _state.Laser,
            Playback = _state.Playback,
            Viewport = _state.Viewport,
            Now = Clock.NowMs(),
            Tool = _state.Tool,
        };
        return JsonSerializer.Serialize(scene, AppJsonContext.Default.SceneDto);
    }

    public void RequestRender()
    {
        if (!_initialized) return;
        var json = BuildSceneJson();
        _ = InvokeRenderAsync(json);
    }

    private async Task InvokeRenderAsync(string json)
    {
        try
        {
            await _js.InvokeVoidAsync("whiteboard.render", json);
        }
        catch
        {
            // 页面关闭或互操作尚未就绪时忽略
        }
    }

    public void SetCursor(string cursor)
    {
        if (!_initialized) return;
        _ = _js.InvokeVoidAsync("whiteboard.setCursor", cursor);
    }

    public void ShowEditor(EditorConfigDto config)
    {
        if (!_initialized) return;
        _ = _js.InvokeVoidAsync("whiteboard.editorOpen", config);
    }

    public void UpdateEditor(EditorConfigDto config)
    {
        if (!_initialized) return;
        _ = _js.InvokeVoidAsync("whiteboard.editorUpdate", config);
    }

    public void HideEditor()
    {
        if (!_initialized) return;
        _ = _js.InvokeVoidAsync("whiteboard.editorClose");
    }

    public void InsertEditorText(string text)
    {
        if (!_initialized) return;
        _ = _js.InvokeVoidAsync("whiteboard.editorInsert", text);
    }

    public async Task<TextMeta?> MeasureTextAsync(Element el)
    {
        if (!_initialized || !el.IsTextLike) return null;
        try
        {
            var request = new MeasureRequestDto
            {
                Text = el.Text ?? "",
                FontSize = el.FontSize ?? 24,
                FontFamily = el.FontFamily ?? "sans-serif",
                MaxWidth = el.Type == "note" ? Math.Max(20, (el.W ?? 180) - 24) : el.MaxW,
            };
            return await _js.InvokeAsync<TextMeta?>("whiteboard.measureText", request);
        }
        catch
        {
            return null;
        }
    }

    public async Task MeasureAllTextsAsync()
    {
        foreach (var el in _state.Elements)
        {
            if (!el.IsTextLike) continue;
            var meta = await MeasureTextAsync(el);
            if (meta is not null) el.Meta = meta;
        }
    }

    public void ApplyTextMetrics(IEnumerable<TextMetricDto> metrics)
    {
        var map = _state.Elements.ToDictionary(el => el.Id);
        foreach (var m in metrics)
        {
            if (!map.TryGetValue(m.Id, out var el)) continue;
            el.Meta = new TextMeta
            {
                Key = m.Key,
                W = m.W,
                H = m.H,
                Lh = m.Lh,
                Lines = m.Lines,
            };
        }
    }

    public async Task DownloadTextAsync(string filename, string text, string mime = "text/plain;charset=utf-8")
    {
        await _js.InvokeVoidAsync("whiteboard.downloadText", filename, text, mime);
    }

    public async Task ClickAsync(string selector)
    {
        await _js.InvokeVoidAsync("whiteboard.click", selector);
    }

    public async Task<PngResultDto> ExportPngAsync(double scale = 2, double padding = 32)
    {
        var json = BuildSceneJson();
        return await _js.InvokeAsync<PngResultDto>("whiteboard.exportPng", json, new { scale, padding });
    }

    public async Task PrintAsync()
    {
        var json = BuildSceneJson();
        await _js.InvokeVoidAsync("whiteboard.print", json);
    }
}
