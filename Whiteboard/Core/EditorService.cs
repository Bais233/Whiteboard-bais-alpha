using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>画布文字 / 便签编辑浮层（对应原 editor.js）。</summary>
public sealed class EditorService
{
    private readonly BoardState _state;
    private readonly RenderService _render;
    private readonly HistoryService _history;

    private Element? _current;
    private bool _isNew;
    private string _originalText = "";

    public EditorService(BoardState state, RenderService render, HistoryService history)
    {
        _state = state;
        _render = render;
        _history = history;
    }

    public bool IsEditing => _current is not null;

    public void Open(Element el, bool isNew)
    {
        if (_current is not null) CommitCore();
        _current = el;
        _isNew = isNew;
        _originalText = el.Text ?? "";
        if (isNew) el.Text = "";
        _state.EditingId = el.Id;
        _render.ShowEditor(BuildConfig(el));
        _render.RequestRender();
    }

    public void OnInput(string text)
    {
        if (_current is null) return;
        _current.Text = text;
        _current.Meta = null;
    }

    public void Cancel()
    {
        if (_current is not { } el) return;
        el.Text = _originalText;
        el.Meta = null;
        if (_isNew)
        {
            RemoveElement(el);
        }
        else if (string.IsNullOrWhiteSpace(_originalText) && el.Type == "text")
        {
            RemoveElement(el);
        }
        Close();
        _render.RequestRender();
    }

    public async Task CommitAsync()
    {
        var el = CommitCore();
        if (el is not null)
        {
            var meta = await _render.MeasureTextAsync(el);
            if (meta is not null) el.Meta = meta;
            _render.RequestRender();
        }
    }

    private Element? CommitCore()
    {
        if (_current is not { } el) return null;
        var isNew = _isNew;
        var originalText = _originalText;
        var text = el.Text ?? "";
        _current = null;
        _state.EditingId = null;
        _render.HideEditor();

        if (isNew)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                RemoveElement(el);
                el.Meta = null;
                _render.RequestRender();
                return null;
            }
            el.Pending = false;
            if (!_state.Elements.Contains(el)) _state.Elements.Add(el);
            _state.Selection.Clear();
            _state.Selection.Add(el.Id);
            el.Meta = null;
            _history.Commit(el.Type == "note" ? "便签" : "文字");
        }
        else if (string.IsNullOrWhiteSpace(text))
        {
            RemoveElement(el);
            _history.Commit("删除空文字");
        }
        else if (text != originalText)
        {
            el.Meta = null;
            _history.Commit("编辑文字");
        }

        return el;
    }

    private void RemoveElement(Element el)
    {
        _state.Elements.Remove(el);
        _state.Selection.Remove(el.Id);
    }

    private void Close()
    {
        _current = null;
        _state.EditingId = null;
        _render.HideEditor();
    }

    /// <summary>相机变化时同步浮层位置。</summary>
    public void Sync()
    {
        if (_current is not { } el) return;
        _render.UpdateEditor(BuildConfig(el));
    }

    public bool InsertIntoEditor(string text)
    {
        if (_current is null) return false;
        _render.InsertEditorText(text);
        return true;
    }

    private EditorConfigDto BuildConfig(Element el)
    {
        var scale = _state.Camera.Scale;
        var pad = el.Type == "note" ? 12 : 2;
        var offsetY = el.Type == "note" ? 16 : 0;
        var origin = _state.WorldToScreen((el.X ?? 0) + pad, (el.Y ?? 0) + pad + offsetY);

        double worldW;
        if (el.Type == "note") worldW = Math.Max(40, (el.W ?? 180) - pad * 2);
        else worldW = el.MaxW ?? Math.Max(160, (_state.Viewport.W - origin.X - 20) / scale);

        return new EditorConfigDto
        {
            Text = el.Text ?? "",
            X = origin.X,
            Y = origin.Y,
            Width = worldW,
            FontSize = el.FontSize ?? 24,
            FontFamily = el.FontFamily ?? "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif",
            Color = el.Color ?? "#111827",
            Align = el.Align ?? "left",
            Scale = scale,
            IsNote = el.Type == "note",
            TransformX = _state.Camera.X,
            TransformY = _state.Camera.Y,
            CameraX = _state.Camera.X,
            CameraY = _state.Camera.Y,
        };
    }
}
