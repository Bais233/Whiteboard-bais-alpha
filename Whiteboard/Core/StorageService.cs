using System.Text.Json;
using Microsoft.JSInterop;
using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>localStorage 持久化与文档序列化（对应原 storage.js）。</summary>
public sealed class StorageService
{
    private readonly IJSRuntime _js;
    private readonly BoardState _state;

    public StorageService(IJSRuntime js, BoardState state)
    {
        _js = js;
        _state = state;
    }

    public async Task<string?> LocalGetAsync(string key)
    {
        try
        {
            return await _js.InvokeAsync<string?>("whiteboard.localGet", key);
        }
        catch
        {
            return null;
        }
    }

    public async Task LocalSetAsync(string key, string value)
    {
        try
        {
            await _js.InvokeVoidAsync("whiteboard.localSet", key, value);
        }
        catch
        {
            // 隐私模式 / 配额不足时忽略
        }
    }

    public async Task LocalRemoveAsync(string key)
    {
        try
        {
            await _js.InvokeVoidAsync("whiteboard.localRemove", key);
        }
        catch
        {
            // ignore
        }
    }

    public DocumentDto Serialize()
    {
        return new DocumentDto
        {
            Meta = new DocumentMeta
            {
                Id = _state.Meta.Id,
                Title = _state.Meta.Title,
                CreatedAt = _state.Meta.CreatedAt,
                UpdatedAt = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
                Version = _state.Meta.Version,
            },
            Board = _state.Board.Clone(),
            Camera = _state.Camera.Clone(),
            Session = new SessionDto { Elapsed = _state.Session.Elapsed },
            Elements = _state.Elements.Select(el => el.Clone()).ToList(),
        };
    }

    public string SerializeJson(bool indented = false) =>
        JsonSerializer.Serialize(Serialize(), indented ? JsonDefaults.Indented : JsonDefaults.Compact);

    public DocumentDto? ParseDocument(string json)
    {
        try
        {
            var data = JsonSerializer.Deserialize(json, AppJsonContext.Default.DocumentDto);
            if (data is null || data.Elements is null) throw new FormatException("不是有效的画板文件");
            data.Elements = data.Elements.Select(NormalizeElement).ToList();
            return data;
        }
        catch
        {
            return null;
        }
    }

    public int ApplyDocument(DocumentDto data)
    {
        _state.Elements = data.Elements.Select(NormalizeElement).ToList();
        if (data.Meta is not null)
        {
            _state.Meta.Id = data.Meta.Id;
            _state.Meta.Title = data.Meta.Title;
            _state.Meta.CreatedAt = data.Meta.CreatedAt;
            _state.Meta.UpdatedAt = data.Meta.UpdatedAt;
            _state.Meta.Version = data.Meta.Version;
        }
        if (data.Board is not null)
        {
            _state.Board.Color = data.Board.Color;
            _state.Board.GridColor = data.Board.GridColor;
            _state.Board.Grid = data.Board.Grid;
            _state.Board.GridSize = data.Board.GridSize > 0 ? data.Board.GridSize : 24;
            _state.Board.Snap = data.Board.Snap;
        }
        if (data.Camera is not null)
        {
            _state.Camera.X = data.Camera.X;
            _state.Camera.Y = data.Camera.Y;
            _state.Camera.Scale = BoardState.ClampScale(data.Camera.Scale);
        }
        _state.Session.Elapsed = data.Session?.Elapsed ?? 0;
        _state.Session.Recording = false;
        _state.Selection.Clear();
        return _state.Elements.Count;
    }

    public static Element NormalizeElement(Element el)
    {
        el.Meta = null;
        if (el.Points is not null)
        {
            foreach (var p in el.Points)
            {
                p.P = p.P ?? 0.5;
            }
            if (el.Times is null || el.Times.Count != el.Points.Count)
            {
                el.Times = el.Points.Select((_, i) => i * 16.0).ToList();
            }
        }
        el.Size = el.Size is > 0 ? el.Size : 2;
        el.Opacity ??= 1;
        el.T ??= 0;
        el.Dur = double.IsFinite(el.Dur) ? el.Dur : 0;
        el.Text ??= el.Type is "text" or "note" ? "" : null;
        el.FontSize ??= el.Type == "note" ? 17 : 24;
        el.FontFamily ??= "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif";
        el.Align ??= "left";
        el.Fill ??= false;
        if (el.Type == "note")
        {
            el.W ??= 180;
            el.H ??= 140;
            el.NoteColor ??= "#fff3a3";
        }
        return el;
    }

    public async Task<UiPrefsDto?> ReadUiAsync()
    {
        var raw = await LocalGetAsync(BoardState.UiKey);
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try
        {
            return JsonSerializer.Deserialize(raw, AppJsonContext.Default.UiPrefsDto);
        }
        catch
        {
            return null;
        }
    }

    public async Task WriteUiAsync(UiPrefsDto prefs)
    {
        var raw = JsonSerializer.Serialize(prefs, AppJsonContext.Default.UiPrefsDto);
        await LocalSetAsync(BoardState.UiKey, raw);
    }
}
