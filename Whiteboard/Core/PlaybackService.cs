using Whiteboard.Models;

namespace Whiteboard.Core;

/// <summary>笔迹回放时间轴（对应原 playback.js）。</summary>
public sealed class PlaybackService
{
    private readonly BoardState _state;
    private readonly RenderService _render;
    private CancellationTokenSource? _cts;

    public PlaybackService(BoardState state, RenderService render)
    {
        _state = state;
        _render = render;
    }

    public event Action? Changed;

    public double Duration()
    {
        var max = 0.0;
        foreach (var el in _state.Elements)
        {
            if (el.T is null) continue;
            max = Math.Max(max, el.T.Value + el.Dur);
        }
        return max;
    }

    public bool Start()
    {
        var duration = Duration();
        if (duration <= 0) return false;
        _state.Playback.Active = true;
        _state.Playback.Paused = false;
        _state.Playback.T = 0;
        _state.Playback.Duration = duration;
        _state.Playback.StartedAt = Clock.NowMs();
        _render.RequestRender();
        Changed?.Invoke();
        _cts?.Cancel();
        _cts = new CancellationTokenSource();
        _ = TickAsync(_cts.Token);
        return true;
    }

    public void Stop()
    {
        _cts?.Cancel();
        _cts = null;
        _state.Playback.Active = false;
        _state.Playback.Paused = false;
        Changed?.Invoke();
        _render.RequestRender();
    }

    public void TogglePause()
    {
        if (!_state.Playback.Active) return;
        _state.Playback.Paused = !_state.Playback.Paused;
        Changed?.Invoke();
    }

    public void Seek(double ratio)
    {
        var duration = Duration();
        if (duration > 0) _state.Playback.Duration = duration;
        _state.Playback.T = Num.Clamp(ratio, 0, 1) * _state.Playback.Duration;
        Changed?.Invoke();
        _render.RequestRender();
    }

    public void SetSpeed(double speed)
    {
        _state.Playback.Speed = speed;
    }

    private async Task TickAsync(CancellationToken ct)
    {
        var last = Clock.NowMs();
        try
        {
            while (!ct.IsCancellationRequested && _state.Playback.Active)
            {
                await Task.Delay(16, ct);
                var now = Clock.NowMs();
                var dt = now - last;
                last = now;
                if (!_state.Playback.Paused)
                {
                    _state.Playback.T += dt * _state.Playback.Speed;
                    if (_state.Playback.T >= _state.Playback.Duration)
                    {
                        _state.Playback.T = _state.Playback.Duration;
                        Stop();
                        return;
                    }
                }
                _render.RequestRender();
                Changed?.Invoke();
            }
        }
        catch (TaskCanceledException)
        {
            // 正常停止
        }
    }
}
