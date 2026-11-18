using System.Text.Json.Serialization;

namespace Whiteboard.Models;

public sealed class PointD
{
    public double X { get; set; }
    public double Y { get; set; }
    public double? P { get; set; }

    public PointD() { }
    public PointD(double x, double y, double? p = null)
    {
        X = x;
        Y = y;
        P = p;
    }

    public PointD Clone() => new(X, Y, P);
}

public sealed class TextLine
{
    public string Text { get; set; } = "";
    public double Width { get; set; }
}

public sealed class TextMeta
{
    public string Key { get; set; } = "";
    public double W { get; set; }
    public double H { get; set; }
    public double Lh { get; set; }
    public List<TextLine> Lines { get; set; } = new();
}

/// <summary>
/// 统一元素模型。字段与前端序列化格式保持一致，便于导入旧版 .wbjson 工程。
/// </summary>
public sealed class Element
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "pen";
    public string? Color { get; set; }
    public double? Size { get; set; }
    public double? Opacity { get; set; }
    public bool? Fill { get; set; }

    public List<PointD>? Points { get; set; }
    public List<double>? Times { get; set; }
    public PointD? A { get; set; }
    public PointD? B { get; set; }

    public double? X { get; set; }
    public double? Y { get; set; }
    public double? W { get; set; }
    public double? H { get; set; }

    public string? Text { get; set; }
    public double? FontSize { get; set; }
    public string? FontFamily { get; set; }
    public string? Align { get; set; }
    public string? NoteColor { get; set; }

    public double? T { get; set; }
    public double Dur { get; set; }
    public bool? Hidden { get; set; }
    public bool? Pending { get; set; }
    public double? MaxW { get; set; }

    /// <summary>文字排版缓存，仅运行时使用，不进入 JSON。</summary>
    [JsonIgnore]
    public TextMeta? Meta { get; set; }

    [JsonIgnore] public bool IsPointTool => Type is "pen" or "highlighter";
    [JsonIgnore] public bool IsShape => Type is "line" or "arrow" or "rect" or "ellipse";
    [JsonIgnore] public bool IsTextLike => Type is "text" or "note";

    public Element Clone()
    {
        return new Element
        {
            Id = Id,
            Type = Type,
            Color = Color,
            Size = Size,
            Opacity = Opacity,
            Fill = Fill,
            Points = Points?.Select(p => p.Clone()).ToList(),
            Times = Times is null ? null : new List<double>(Times),
            A = A?.Clone(),
            B = B?.Clone(),
            X = X,
            Y = Y,
            W = W,
            H = H,
            Text = Text,
            FontSize = FontSize,
            FontFamily = FontFamily,
            Align = Align,
            NoteColor = NoteColor,
            T = T,
            Dur = Dur,
            Hidden = Hidden,
            Pending = Pending,
            MaxW = MaxW,
            Meta = null,
        };
    }
}
