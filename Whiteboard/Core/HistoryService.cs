using System.Text.Json;
using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>撤销 / 重做（快照式）。</summary>
public sealed class HistoryService
{
    private const int Limit = 80;
    private readonly BoardState _state;
    private readonly List<Snapshot> _stack = new();
    private int _index = -1;

    private sealed record Snapshot(List<Element> Elements, string Json);

    public HistoryService(BoardState state) => _state = state;

    public event Action? Changed;

    public bool CanUndo => _index > 0;
    public bool CanRedo => _index < _stack.Count - 1;
    public int Depth => _stack.Count;

    private static string Serialize(List<Element> elements) =>
        JsonSerializer.Serialize(elements, AppJsonContext.Default.ListElement);

    private Snapshot Take() => new(_state.Elements.Select(el => el.Clone()).ToList(), Serialize(_state.Elements));

    public void Init()
    {
        _stack.Clear();
        _stack.Add(Take());
        _index = 0;
        Changed?.Invoke();
    }

    public void Commit(string label = "")
    {
        _ = label;
        var snapshot = Take();
        if (_index >= 0 && _stack[_index].Json == snapshot.Json)
        {
            Changed?.Invoke();
            return;
        }
        if (_index < _stack.Count - 1) _stack.RemoveRange(_index + 1, _stack.Count - _index - 1);
        _stack.Add(snapshot);
        if (_stack.Count > Limit) _stack.RemoveAt(0);
        _index = _stack.Count - 1;
        _state.Touch();
        Changed?.Invoke();
    }

    public bool Undo()
    {
        if (_index <= 0) return false;
        _index--;
        Apply(_stack[_index]);
        Changed?.Invoke();
        return true;
    }

    public bool Redo()
    {
        if (_index >= _stack.Count - 1) return false;
        _index++;
        Apply(_stack[_index]);
        Changed?.Invoke();
        return true;
    }

    private void Apply(Snapshot snapshot)
    {
        _state.Elements = snapshot.Elements.Select(el => el.Clone()).ToList();
        foreach (var el in _state.Elements) el.Meta = null;
        var alive = _state.Elements.Select(el => el.Id).ToHashSet();
        foreach (var id in _state.Selection.ToList())
        {
            if (!alive.Contains(id)) _state.Selection.Remove(id);
        }
    }

    public void Reset() => Init();
}
