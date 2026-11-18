using System.Text;
using System.Text.RegularExpressions;

namespace Whiteboard.Core;

/// <summary>数学草稿：LaTeX 速记 → Unicode 文本，以及符号面板数据。</summary>
public static partial class MathService
{
    private static readonly Dictionary<string, string> Greek = new()
    {
        ["alpha"] = "α", ["beta"] = "β", ["gamma"] = "γ", ["delta"] = "δ", ["epsilon"] = "ε",
        ["varepsilon"] = "ε", ["zeta"] = "ζ", ["eta"] = "η", ["theta"] = "θ", ["vartheta"] = "ϑ",
        ["iota"] = "ι", ["kappa"] = "κ", ["lambda"] = "λ", ["mu"] = "μ", ["nu"] = "ν",
        ["xi"] = "ξ", ["pi"] = "π", ["varpi"] = "ϖ", ["rho"] = "ρ", ["sigma"] = "σ",
        ["varsigma"] = "ς", ["tau"] = "τ", ["upsilon"] = "υ", ["phi"] = "φ", ["varphi"] = "φ",
        ["chi"] = "χ", ["psi"] = "ψ", ["omega"] = "ω",
        ["Gamma"] = "Γ", ["Delta"] = "Δ", ["Theta"] = "Θ", ["Lambda"] = "Λ", ["Xi"] = "Ξ",
        ["Pi"] = "Π", ["Sigma"] = "Σ", ["Upsilon"] = "Υ", ["Phi"] = "Φ", ["Psi"] = "Ψ",
        ["Omega"] = "Ω",
    };

    private static readonly Dictionary<string, string> Symbols = new()
    {
        ["times"] = "×", ["cdot"] = "·", ["div"] = "÷", ["pm"] = "±", ["mp"] = "∓",
        ["ast"] = "∗", ["star"] = "⋆", ["circ"] = "∘", ["bullet"] = "∙", ["oplus"] = "⊕",
        ["otimes"] = "⊗", ["odot"] = "⊙",
        ["le"] = "≤", ["leq"] = "≤", ["ge"] = "≥", ["geq"] = "≥", ["ne"] = "≠",
        ["neq"] = "≠", ["equiv"] = "≡", ["approx"] = "≈", ["cong"] = "≅", ["sim"] = "∼",
        ["simeq"] = "≃", ["propto"] = "∝", ["ll"] = "≪", ["gg"] = "≫",
        ["infty"] = "∞", ["partial"] = "∂", ["nabla"] = "∇",
        ["int"] = "∫", ["iint"] = "∬", ["iiint"] = "∭", ["oint"] = "∮", ["sum"] = "Σ",
        ["prod"] = "Π", ["coprod"] = "∐", ["lim"] = "lim", ["limsup"] = "lim sup", ["liminf"] = "lim inf",
        ["in"] = "∈", ["notin"] = "∉", ["ni"] = "∋", ["subset"] = "⊂", ["supset"] = "⊃",
        ["subseteq"] = "⊆", ["supseteq"] = "⊇", ["cup"] = "∪", ["cap"] = "∩",
        ["setminus"] = "∖", ["emptyset"] = "∅", ["varnothing"] = "∅",
        ["forall"] = "∀", ["exists"] = "∃", ["nexists"] = "∄", ["neg"] = "¬", ["lnot"] = "¬",
        ["land"] = "∧", ["wedge"] = "∧", ["lor"] = "∨", ["vee"] = "∨",
        ["therefore"] = "∴", ["because"] = "∵",
        ["angle"] = "∠", ["triangle"] = "△", ["perp"] = "⊥", ["parallel"] = "∥", ["nparallel"] = "∦",
        ["degree"] = "°", ["prime"] = "′",
        ["ldots"] = "…", ["cdots"] = "⋯", ["vdots"] = "⋮", ["dots"] = "…",
        ["to"] = "→", ["rightarrow"] = "→", ["leftarrow"] = "←", ["leftrightarrow"] = "↔",
        ["Rightarrow"] = "⇒", ["Leftarrow"] = "⇐", ["Leftrightarrow"] = "⇔",
        ["mapsto"] = "↦", ["uparrow"] = "↑", ["downarrow"] = "↓",
        ["aleph"] = "ℵ", ["hbar"] = "ℏ", ["ell"] = "ℓ", ["Re"] = "ℜ", ["Im"] = "ℑ", ["wp"] = "℘",
        ["mathbb"] = "",
        ["quad"] = "  ", ["qquad"] = "    ",
    };

    private static readonly HashSet<string> Functions = new()
    {
        "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
        "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "det", "dim", "deg",
        "gcd", "max", "min", "sup", "inf", "arg", "ker", "mod", "bmod",
    };

    private static readonly Dictionary<char, string> Sup = new()
    {
        ['0'] = "⁰", ['1'] = "¹", ['2'] = "²", ['3'] = "³", ['4'] = "⁴", ['5'] = "⁵",
        ['6'] = "⁶", ['7'] = "⁷", ['8'] = "⁸", ['9'] = "⁹", ['+'] = "⁺", ['-'] = "⁻",
        ['='] = "⁼", ['('] = "⁽", [')'] = "⁾", ['n'] = "ⁿ", ['i'] = "ⁱ", ['a'] = "ᵃ",
        ['b'] = "ᵇ", ['c'] = "ᶜ", ['d'] = "ᵈ", ['e'] = "ᵉ", ['k'] = "ᵏ", ['m'] = "ᵐ",
        ['t'] = "ᵗ", ['x'] = "ˣ", ['y'] = "ʸ",
    };

    private static readonly Dictionary<char, string> Sub = new()
    {
        ['0'] = "₀", ['1'] = "₁", ['2'] = "₂", ['3'] = "₃", ['4'] = "₄", ['5'] = "₅",
        ['6'] = "₆", ['7'] = "₇", ['8'] = "₈", ['9'] = "₉", ['+'] = "₊", ['-'] = "₋",
        ['='] = "₌", ['('] = "₍", [')'] = "₎", ['a'] = "ₐ", ['e'] = "ₑ", ['i'] = "ᵢ",
        ['j'] = "ⱼ", ['k'] = "ₖ", ['l'] = "ₗ", ['m'] = "ₘ", ['n'] = "ₙ", ['o'] = "ₒ",
        ['p'] = "ₚ", ['r'] = "ᵣ", ['s'] = "ₛ", ['t'] = "ₜ", ['u'] = "ᵤ", ['v'] = "ᵥ",
        ['x'] = "ₓ",
    };

    private static readonly Dictionary<char, string> Bb = new()
    {
        ['A'] = "𝔸", ['B'] = "𝔹", ['C'] = "ℂ", ['D'] = "𝔻", ['E'] = "𝔼", ['F'] = "𝔽",
        ['G'] = "𝔾", ['H'] = "ℍ", ['N'] = "ℕ", ['P'] = "ℙ", ['Q'] = "ℚ", ['R'] = "ℝ",
        ['Z'] = "ℤ",
    };

    private static readonly Regex Simple = new(@"^[A-Za-z0-9_\u0370-\u03FF\u2070-\u209C]+$", RegexOptions.Compiled);

    private static (string Content, int Next) ReadGroup(string src, int i)
    {
        if (i >= src.Length) return ("", i + 1);
        if (src[i] != '{')
        {
            if (src[i] == '\\')
            {
                var m = Regex.Match(src[i..], @"^\\[a-zA-Z]+");
                if (m.Success) return (m.Value, i + m.Value.Length);
            }
            return (src[i].ToString(), i + 1);
        }

        var depth = 0;
        for (var j = i; j < src.Length; j++)
        {
            if (src[j] == '{') depth++;
            else if (src[j] == '}')
            {
                depth--;
                if (depth == 0) return (src.Substring(i + 1, j - i - 1), j + 1);
            }
        }
        return (src[(i + 1)..], src.Length);
    }

    private static (string Text, bool Complete) MapChars(string text, Dictionary<char, string> table)
    {
        var sb = new StringBuilder();
        var complete = text.Length > 0;
        foreach (var ch in text)
        {
            if (table.TryGetValue(ch, out var mapped)) sb.Append(mapped);
            else
            {
                complete = false;
                sb.Append(ch);
            }
        }
        return (sb.ToString(), complete);
    }

    private static string ScriptText(string conv, char kind)
    {
        var (mapped, complete) = MapChars(conv, kind == '^' ? Sup : Sub);
        if (complete) return mapped;
        var trimmed = conv.Trim();
        if (trimmed.Length == 1) return kind + trimmed;
        return $"{kind}({trimmed})";
    }

    public static string TexToUnicode(string? input)
    {
        if (string.IsNullOrEmpty(input)) return "";
        var src = input.Replace("\r\n", "\n").Replace("\r", "\n");

        src = Regex.Replace(src, @"\\begin\{[a-z*]+\}", "", RegexOptions.IgnoreCase);
        src = Regex.Replace(src, @"\\end\{[a-z*]+\}", "", RegexOptions.IgnoreCase);
        src = Regex.Replace(src, @"\\\\", "\n");
        src = Regex.Replace(src, @"\\left|\\right|\\bigg?l?r?", "");
        src = src.Replace("\\,", " ").Replace("\\;", " ").Replace("\\:", "  ").Replace("\\!", "");
        src = src.Replace("\\%", "%").Replace("\\#", "#").Replace("\\&", "&").Replace("\\_", "_")
                 .Replace("\\{", "{").Replace("\\}", "}").Replace("\\$", "$");

        var output = new StringBuilder();
        var i = 0;
        while (i < src.Length)
        {
            var ch = src[i];

            if (ch is '^' or '_')
            {
                var (content, next) = ReadGroup(src, i + 1);
                output.Append(ScriptText(TexToUnicode(content), ch));
                i = next;
                continue;
            }

            if (ch == '\\')
            {
                var m = Regex.Match(src[i..], @"^\\([a-zA-Z]+|.)");
                if (!m.Success)
                {
                    output.Append(ch);
                    i++;
                    continue;
                }
                var name = m.Groups[1].Value;
                i += m.Length;

                if (name is "frac" or "dfrac" or "tfrac")
                {
                    var (num, n1) = ReadGroup(src, i);
                    var (den, n2) = ReadGroup(src, n1);
                    output.Append($"({TexToUnicode(num)})/({TexToUnicode(den)})");
                    i = n2;
                    continue;
                }
                if (name == "sqrt")
                {
                    var index = "";
                    if (i < src.Length && src[i] == '[')
                    {
                        var end = src.IndexOf(']', i);
                        index = end == -1 ? src[(i + 1)..] : src.Substring(i + 1, end - i - 1);
                        i = end == -1 ? src.Length : end + 1;
                    }
                    var (radicand, n1) = ReadGroup(src, i);
                    output.Append($"{RootSymbol(index)}({TexToUnicode(radicand)})");
                    i = n1;
                    continue;
                }
                if (name is "text" or "mathrm" or "operatorname" or "mbox")
                {
                    var (t, n1) = ReadGroup(src, i);
                    output.Append(t);
                    i = n1;
                    continue;
                }
                if (name is "mathbb" or "mathbf" or "mathcal")
                {
                    var (t, n1) = ReadGroup(src, i);
                    output.Append(name == "mathbb"
                        ? string.Concat(t.Select(c => Bb.TryGetValue(c, out var v) ? v : c.ToString()))
                        : t);
                    i = n1;
                    continue;
                }
                if (name is "overline" or "bar")
                {
                    var (t, n1) = ReadGroup(src, i);
                    output.Append(TexToUnicode(t)).Append('̄');
                    i = n1;
                    continue;
                }
                if (name is "vec" or "hat")
                {
                    var (t, n1) = ReadGroup(src, i);
                    output.Append(TexToUnicode(t)).Append(name == "vec" ? '⃗' : '̂');
                    i = n1;
                    continue;
                }
                if (name is "begin" or "end") continue;

                if (Greek.TryGetValue(name, out var greek))
                {
                    output.Append(greek);
                    continue;
                }
                if (Functions.Contains(name))
                {
                    output.Append(name);
                    continue;
                }
                if (Symbols.TryGetValue(name, out var symbol))
                {
                    output.Append(symbol);
                    continue;
                }
                output.Append(name);
                continue;
            }

            output.Append(ch);
            i++;
        }

        var result = FractionRegex().Replace(output.ToString(), m =>
        {
            var a = m.Groups[1].Value;
            var b = m.Groups[2].Value;
            return Simple.IsMatch(a) && Simple.IsMatch(b) ? $"{a}/{b}" : $"({a})/({b})";
        });
        result = Regex.Replace(result, @"[ \t]{2,}", " ");
        result = Regex.Replace(result, " {2,}\n", "\n");
        result = Regex.Replace(result, @"\n{3,}", "\n\n");
        return result.Trim();
    }

    [GeneratedRegex(@"\(\s*([^()]*?)\s*\)/\(\s*([^()]*?)\s*\)")]
    private static partial Regex FractionRegex();

    private static string RootSymbol(string index)
    {
        var idx = index.Trim();
        return idx switch
        {
            "" or "2" => "√",
            "3" => "∛",
            "4" => "∜",
            _ => ScriptText(TexToUnicode(idx), '^') + "√",
        };
    }

    public sealed record SymbolGroup(string Id, string Label, string[] Items);

    public static readonly SymbolGroup[] SymbolGroups =
    {
        new("ops", "运算", new[]
        {
            "+", "−", "×", "÷", "±", "∓", "·", "∗", "=", "≠", "≈", "≡", "∼", "∝", "<", ">", "≤", "≥", "≪", "≫", "∞",
        }),
        new("greek", "希腊", new[]
        {
            "α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "λ", "μ", "ν", "ξ", "π", "ρ", "σ", "τ", "φ", "χ", "ψ", "ω",
            "Γ", "Δ", "Θ", "Λ", "Ξ", "Π", "Σ", "Φ", "Ψ", "Ω",
        }),
        new("calc", "微积分", new[]
        {
            "∫", "∬", "∮", "∑", "∏", "∂", "∇", "′", "″", "lim", "→", "dx", "dy", "∆", "√", "∛", "ⁿ", "√x", "x²", "x³", "eˣ", "ln x",
        }),
        new("set", "集合逻辑", new[]
        {
            "∈", "∉", "∋", "⊂", "⊆", "⊃", "⊇", "∪", "∩", "∖", "∅", "∀", "∃", "∄", "¬", "∧", "∨", "∴", "∵", "ℕ", "ℤ", "ℚ", "ℝ", "ℂ",
        }),
        new("geo", "几何", new[]
        {
            "∠", "△", "⊥", "∥", "°", "□", "○", "⌒", "≅", "∽", "π", "½", "⅓", "¼", "⅔", "¾",
        }),
        new("arrow", "箭头", new[]
        {
            "→", "←", "↔", "⇒", "⇐", "⇔", "↦", "↑", "↓", "↗", "↘", "⟶", "↺", "↻",
        }),
        new("scripts", "上下标", new[]
        {
            "⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹", "⁺", "⁻", "ⁿ", "ⁱ",
            "₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉", "ₙ", "ₓ",
        }),
    };

    public static readonly string[] TexExamples =
    {
        "x^2 + y^2 = r^2",
        "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
        "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}",
        "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
        "e^{i\\pi} + 1 = 0",
        "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
        "\\nabla \\cdot \\vec{E} = \\frac{\\rho}{\\varepsilon_0}",
        "a^2 + b^2 = c^2",
    };
}
