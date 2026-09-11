/**
 * math.js —— 数学草稿支持
 * 1) texToUnicode(): 把常见 LaTeX 速记转成 Unicode 文本（离线、无渲染引擎）
 * 2) SYMBOL_GROUPS: 数学符号面板数据
 */

/* ---------------------------------------------------------------- 命令表 */

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const SYMBOLS = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆',
  circ: '∘', bullet: '∙', oplus: '⊕', otimes: '⊗', odot: '⊙',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', equiv: '≡',
  approx: '≈', cong: '≅', sim: '∼', simeq: '≃', propto: '∝',
  ll: '≪', gg: '≫',
  infty: '∞', partial: '∂', nabla: '∇',
  int: '∫', iint: '∬', iiint: '∭', oint: '∮', sum: 'Σ', prod: 'Π', coprod: '∐',
  lim: 'lim', limsup: 'lim sup', liminf: 'lim inf',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃',
 subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩',
  setminus: '∖', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬',
  land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  therefore: '∴', because: '∵',
  angle: '∠', triangle: '△', perp: '⊥', parallel: '∥', nparallel: '∦',
  degree: '°', prime: '′',
  ldots: '…', cdots: '⋯', vdots: '⋮', dots: '…',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  mapsto: '↦', uparrow: '↑', downarrow: '↓',
  aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', wp: '℘',
  mathbb: '', // 见下（\mathbb{} 单独处理）
  quad: '  ',
  qquad: '    ',
};

const FUNCTIONS = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'det', 'dim', 'deg',
  'gcd', 'max', 'min', 'sup', 'inf', 'arg', 'ker', 'mod', 'bmod',
];

/** 上标 / 下标映射 */
const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', k: 'ᵏ', m: 'ᵐ', t: 'ᵗ', x: 'ˣ', y: 'ʸ' };
const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };

/** 分数塌缩判定：两侧都足够“简单”时省略外层括号 */
const SIMPLE = /^[\w\u0370-\u03FF\u2070-\u209C]+$/;

const BB = { A: '𝔸', B: '𝔹', C: 'ℂ', D: '𝔻', E: '𝔼', F: '𝔽', G: '𝔾', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };

/* ------------------------------------------------------------ 解析辅助 */

/** 读取从 i 开始的 {…} 分组，返回 [内容, 结束下标]；没有花括号时读一个 token */
function readGroup(src, i) {
  if (src[i] !== '{') {
    // 单 token：命令或单字符
    if (src[i] === '\\') {
      const m = /^\\[a-zA-Z]+/.exec(src.slice(i));
      if (m) return [m[0], i + m[0].length];
    }
    return [src[i] ?? '', i + 1];
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return [src.slice(i + 1, j), j + 1];
    }
  }
  return [src.slice(i + 1), src.length];
}

/** 逐字符映射为上标 / 下标；返回 [文本, 是否全部可映射] */
function mapChars(text, table) {
  let out = '';
  let complete = text.length > 0;
  for (const ch of text) {
    if (table[ch]) out += table[ch];
    else {
      complete = false;
      out += ch;
    }
  }
  return [out, complete];
}

/** 上/下标：能整段映射就用 Unicode 上下标，否则退回 ^(…) / _(…) 写法 */
function scriptText(conv, kind) {
  const [mapped, complete] = mapChars(conv, kind === '^' ? SUP : SUB);
  if (complete) return mapped;
  const trimmed = conv.trim();
  if ([...trimmed].length === 1) return kind + trimmed;
  return `${kind}(${trimmed})`;
}

/* ------------------------------------------------------------- 主函数 */

/**
 * 把 LaTeX 速记转换为 Unicode 文本。
 * 支持：\命令、^{}/_{}、\frac{}{}、\sqrt[]{}、\text{}、\mathbb{}、函数名。
 * 无法识别的命令会保留可读的原文（去掉反斜杠）。
 */
export function texToUnicode(input) {
  if (!input) return '';
  let src = String(input).replace(/\r\n?/g, '\n');

  // 常见环境速记
  src = src
    .replace(/\\begin\{[a-z*]+\}/gi, '')
    .replace(/\\end\{[a-z*]+\}/gi, '')
    .replace(/\\\\/g, '\n')
    .replace(/\\left|\\right|\\bigg?l?r?/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\\:/g, '  ')
    .replace(/\\!/g, '')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\&/g, '&')
    .replace(/\\_/g, '_')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\$/g, '$');

  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '^' || ch === '_') {
      const [content, next] = readGroup(src, i + 1);
      out += scriptText(convertGroup(content), ch);
      i = next;
      continue;
    }

    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) {
        out += ch;
        i++;
        continue;
      }
      const name = m[1];
      i += m[0].length;

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [num, n1] = readGroup(src, i);
        const [den, n2] = readGroup(src, n1);
        out += `(${convertGroup(num)})/(${convertGroup(den)})`;
        i = n2;
        continue;
      }
      if (name === 'sqrt') {
        let index = '';
        if (src[i] === '[') {
          const end = src.indexOf(']', i);
          index = src.slice(i + 1, end === -1 ? undefined : end);
          i = end === -1 ? src.length : end + 1;
        }
        const [radicand, n1] = readGroup(src, i);
        const r = convertGroup(radicand);
        out += `${rootSymbol(index)}(${r})`;
        i = n1;
        continue;
      }
      if (name === 'text' || name === 'mathrm' || name === 'operatorname' || name === 'mbox') {
        const [t, n1] = readGroup(src, i);
        out += t;
        i = n1;
        continue;
      }
      if (name === 'mathbb' || name === 'mathbf' || name === 'mathcal') {
        const [t, n1] = readGroup(src, i);
        out += name === 'mathbb' ? [...t].map((c) => BB[c] || c).join('') : t;
        i = n1;
        continue;
      }
      if (name === 'overline' || name === 'bar') {
        const [t, n1] = readGroup(src, i);
        out += `${convertGroup(t)}̄`;
        i = n1;
        continue;
      }
      if (name === 'vec' || name === 'hat') {
        const [t, n1] = readGroup(src, i);
        out += `${convertGroup(t)}${name === 'vec' ? '⃗' : '̂'}`;
        i = n1;
        continue;
      }
      if (name === 'begin' || name === 'end') continue;

      if (GREEK[name]) {
        out += GREEK[name];
        continue;
      }
      if (FUNCTIONS.includes(name)) {
        out += name === 'ln' ? 'ln' : name;
        continue;
      }
      if (SYMBOLS[name] !== undefined) {
        out += SYMBOLS[name];
        continue;
      }
      // 未识别命令：去掉反斜杠，保留可读文本
      out += name;
      continue;
    }

    out += ch;
    i++;
  }

  return out
    .replace(/\(\s*([^()]*?)\s*\)\/\(\s*([^()]*?)\s*\)/g, (_m, a, b) =>
      SIMPLE.test(a) && SIMPLE.test(b) ? `${a}/${b}` : `(${a})/(${b})`
    )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ {2,}\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** \sqrt[n]{} 的根号符号 */
function rootSymbol(index) {
  const idx = index ? String(index).trim() : '';
  if (idx === '' || idx === '2') return '√';
  if (idx === '3') return '∛';
  if (idx === '4') return '∜';
  return `${scriptText(texToUnicode(idx), '^')}√`;
}

function convertGroup(text) {
  return texToUnicode(text);
}

/* --------------------------------------------------------- 符号面板数据 */

export const SYMBOL_GROUPS = [
  {
    id: 'ops',
    label: '运算',
    items: ['+', '−', '×', '÷', '±', '∓', '·', '∗', '=', '≠', '≈', '≡', '∼', '∝', '<', '>', '≤', '≥', '≪', '≫', '∞'],
  },
  {
    id: 'greek',
    label: '希腊',
    items: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'λ', 'μ', 'ν', 'ξ', 'π', 'ρ', 'σ', 'τ', 'φ', 'χ', 'ψ', 'ω', 'Γ', 'Δ', 'Θ', 'Λ', 'Ξ', 'Π', 'Σ', 'Φ', 'Ψ', 'Ω'],
  },
  {
    id: 'calc',
    label: '微积分',
    items: ['∫', '∬', '∮', '∑', '∏', '∂', '∇', '′', '″', 'lim', '→', 'dx', 'dy', '∆', '√', '∛', 'ⁿ', '√x', 'x²', 'x³', 'eˣ', 'ln x'],
  },
  {
    id: 'set',
    label: '集合逻辑',
    items: ['∈', '∉', '∋', '⊂', '⊆', '⊃', '⊇', '∪', '∩', '∖', '∅', '∀', '∃', '∄', '¬', '∧', '∨', '∴', '∵', 'ℕ', 'ℤ', 'ℚ', 'ℝ', 'ℂ'],
  },
  {
    id: 'geo',
    label: '几何',
    items: ['∠', '△', '⊥', '∥', '°', '□', '○', '⌒', '≅', '∽', 'π', '½', '⅓', '¼', '⅔', '¾'],
  },
  {
    id: 'arrow',
    label: '箭头',
    items: ['→', '←', '↔', '⇒', '⇐', '⇔', '↦', '↑', '↓', '↗', '↘', '⟶', '↺', '↻'],
  },
  {
    id: 'scripts',
    label: '上下标',
    items: ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', '⁺', '⁻', 'ⁿ', 'ⁱ', '₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉', 'ₙ', 'ₓ'],
  },
];

/** 常用速记示例（面板底部提示用） */
export const TEX_EXAMPLES = [
  'x^2 + y^2 = r^2',
  '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}',
  '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  'e^{i\\pi} + 1 = 0',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
  '\\nabla \\cdot \\vec{E} = \\frac{\\rho}{\\varepsilon_0}',
  'a^2 + b^2 = c^2',
];
