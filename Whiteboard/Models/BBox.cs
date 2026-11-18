namespace Whiteboard.Models;

public readonly record struct BBox(double X, double Y, double W, double H)
{
    public double X2 => X + W;
    public double Y2 => Y + H;

    public static BBox FromPoints(PointD a, PointD b) => new(
        Math.Min(a.X, b.X),
        Math.Min(a.Y, b.Y),
        Math.Abs(a.X - b.X),
        Math.Abs(a.Y - b.Y));

    public BBox Inflate(double pad) => new(X - pad, Y - pad, W + pad * 2, H + pad * 2);

    public bool Contains(double x, double y, double pad = 0) =>
        x >= X - pad && x <= X + W + pad && y >= Y - pad && y <= Y + H + pad;

    public bool Intersects(BBox other) =>
        X < other.X + other.W && X + W > other.X && Y < other.Y + other.H && Y + H > other.Y;

    public bool FullyInside(BBox other) =>
        X >= other.X && Y >= other.Y && X + W <= other.X + other.W && Y + H <= other.Y + other.H;

    public static BBox? Merge(IEnumerable<BBox?> boxes)
    {
        double x1 = double.PositiveInfinity, y1 = double.PositiveInfinity;
        double x2 = double.NegativeInfinity, y2 = double.NegativeInfinity;
        var any = false;
        foreach (var b in boxes)
        {
            if (b is not { } box) continue;
            any = true;
            x1 = Math.Min(x1, box.X);
            y1 = Math.Min(y1, box.Y);
            x2 = Math.Max(x2, box.X + box.W);
            y2 = Math.Max(y2, box.Y + box.H);
        }
        return any ? new BBox(x1, y1, x2 - x1, y2 - y1) : null;
    }
}
