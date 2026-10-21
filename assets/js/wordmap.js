/*
  ワードマップ（書き込みによく出る言葉の強弱）の計算
  - 書き込みを言葉に分け（ブラウザの日本語の単語分割 Intl.Segmenter を使い、使えないときは文字の種類で分ける）、
    名詞らしい言葉（漢字・カタカナ・英数字だけでできた言葉）を数えます。
  - 1つの書き込みの中で同じ言葉が何度出ても1回と数えます（長い書き込みだけが目立たないように）。
  - 「最近」の表示では、新しい書き込みほど重く数えます（halfLifeDays 日で重みが半分）。
  - glossary の言葉は分けずに1語として、stopwords の言葉は数えません（content/board.json の wordmap）。
  画面の部品は持たず、計算だけをします（board.js から使います）。
*/
(function (root) {
  'use strict';

  var KANJI = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3005\\u3006\\u30F5\\u30F6';
  var KATAKANA = '\\u30A1-\\u30FA\\u30FC\\u30FD\\u30FE\\u31F0-\\u31FF';
  var reWordChars = new RegExp('^[' + KANJI + KATAKANA + 'A-Za-z0-9]+$');
  var reRun = new RegExp('[' + KANJI + ']+|[' + KATAKANA + ']+|[A-Za-z][A-Za-z0-9]*', 'g');
  var reDigit = /[0-9]/;
  var DAY = 86400000;

  var segmenter = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    }
  } catch (e) { segmenter = null; }

  function normalize(text) {
    var s = String(text || '');
    return typeof s.normalize === 'function' ? s.normalize('NFKC') : s;
  }

  /** 言葉の候補を、文中の位置つきで取り出す */
  function rawTokens(text) {
    var out = [];
    if (segmenter) {
      var it = segmenter.segment(text);
      var iter = it[Symbol.iterator]();
      for (var step = iter.next(); !step.done; step = iter.next()) {
        var seg = step.value;
        if (seg.isWordLike === false) continue;
        out.push({ text: seg.segment, index: seg.index });
      }
      return out;
    }
    reRun.lastIndex = 0;
    var m;
    while ((m = reRun.exec(text))) out.push({ text: m[0], index: m.index });
    return out;
  }

  var reHiragana = /[ぁ-ゖ]/;
  var PARTICLES = ['から', 'まで', 'より', 'など', 'です', 'でし', 'だっ', 'が', 'を', 'に', 'は', 'の', 'で', 'と', 'も', 'や', 'へ', 'だ'];
  var SURU = ['し', 'す', 'さ', 'せ'];
  var startsWithAny = function (text, at, list) {
    for (var i = 0; i < list.length; i += 1) if (text.substr(at, list[i].length) === list[i]) return true;
    return false;
  };
  /**
   * 言葉のすぐ後ろを見て、名詞として数えるかを決める
   * 「本が」「候補を」のように助詞が続く → 数える／「紹介して」のように「する」が続く2文字以上の言葉 → 数える
   * 「使わせて」「知って」「面白そう」のように送りがなが続く → 動詞・形容詞の一部なので数えない
   */
  function keepNoun(text, end, word) {
    var next = text.charAt(end);
    if (!next || !reHiragana.test(next)) return true;
    if (startsWithAny(text, end, PARTICLES)) return true;
    if (word.length >= 2 && startsWithAny(text, end, SURU)) return true;
    return false;
  }

  /** となり合う名詞らしい言葉をつなげて、複合語にする（例：「書庫」「整理」→「書庫整理」） */
  function nounsOf(text) {
    var tokens = rawTokens(text);
    var words = [];
    var current = null;
    var finish = function () {
      if (current && keepNoun(text, current.end, current.text)) words.push(current.text);
      current = null;
    };
    tokens.forEach(function (t) {
      var isWord = reWordChars.test(t.text);
      if (!isWord) { finish(); return; }
      if (current && current.end === t.index && current.parts < 3 && (current.text + t.text).length <= 10) {
        current.text += t.text;
        current.end = t.index + t.text.length;
        current.parts += 1;
      } else {
        finish();
        current = { text: t.text, end: t.index + t.text.length, parts: 1 };
      }
    });
    finish();
    return words;
  }

  /**
   * 1つの書き込みから、数える言葉の一覧（重複なし）を返す
   * options.glossary：1語として数える言葉、options.stopwords：数えない言葉
   */
  function wordsOf(text, options) {
    options = options || {};
    var glossary = (options.glossary || []).map(normalize).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    var stop = {};
    (options.stopwords || []).forEach(function (w) { stop[normalize(w)] = true; });
    var rest = normalize(text);
    var found = [];
    // 先に glossary の言葉を取り出し、その部分は区切りに置きかえる
    glossary.forEach(function (term) {
      if (rest.indexOf(term) === -1) return;
      found.push(term);
      rest = rest.split(term).join('、');
    });
    nounsOf(rest).forEach(function (w) { found.push(w); });
    var seen = {};
    var out = [];
    found.forEach(function (w) {
      var key = /^[A-Za-z0-9]+$/.test(w) ? w.toUpperCase() : w;
      if (seen[key] || stop[key] || stop[w]) return;
      if (reDigit.test(key)) return; // 「2件」「週1回」のような数の言葉は数えない
      // 1文字の言葉も、stopwords になければ数える（「本」「棚」など）
      seen[key] = true;
      out.push(key);
    });
    return out;
  }

  /**
   * 書き込みの一覧から、言葉ごとの重みを計算する
   * posts：[{ text, at（ミリ秒） }]、options.mode：'recent'（新しいほど重い）か 'all'
   * 戻り値：[{ word, score, posts, rank, level（0〜1） }]（重い順）
   */
  function compute(posts, options) {
    options = options || {};
    var now = options.now || Date.now();
    var half = Math.max(1, Number(options.halfLifeDays) || 7);
    var recent = options.mode !== 'all';
    var table = {};
    (posts || []).forEach(function (post) {
      var age = Math.max(0, (now - (post.at || now)) / DAY);
      var weight = recent ? Math.pow(0.5, age / half) : 1;
      wordsOf(post.text, options).forEach(function (word) {
        var row = table[word] || (table[word] = { word: word, score: 0, posts: 0 });
        row.score += weight;
        row.posts += 1;
      });
    });
    var rows = Object.keys(table).map(function (k) { return table[k]; });
    rows.sort(function (a, b) { return b.score - a.score || b.posts - a.posts || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0); });
    rows = rows.slice(0, Math.max(1, Number(options.maxWords) || 24));
    var max = rows.length ? rows[0].score : 0;
    var min = rows.length ? rows[rows.length - 1].score : 0;
    rows.forEach(function (row, i) {
      row.rank = i + 1;
      row.level = max === min ? 1 : Math.sqrt((row.score - min) / (max - min));
    });
    return rows;
  }

  /** 見た目の並び：重い言葉ほど中央に来るよう、左右に振り分けた順番を返す（読み上げは重い順のまま） */
  function centerOrder(count) {
    var order = new Array(count);
    var left = [];
    var right = [];
    for (var i = 0; i < count; i += 1) { if (i % 2 === 0) right.push(i); else left.push(i); }
    var sequence = left.reverse().concat(right);
    sequence.forEach(function (rankIndex, position) { order[rankIndex] = position; });
    return order;
  }

  var api = { wordsOf: wordsOf, compute: compute, centerOrder: centerOrder, usesSegmenter: Boolean(segmenter) };
  root.InfostaWordmap = api;
})(typeof window !== 'undefined' ? window : globalThis);
