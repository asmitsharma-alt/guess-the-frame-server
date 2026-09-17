// Fuzzy Matcher & Spoiler Shield for Guess The Frame
const FuzzyMatcher = {
  STOP_WORDS: new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'nor', 'for', 'yet', 'so',
    'in', 'on', 'at', 'to', 'by', 'of', 'off', 'up', 'out', 'over', 'into', 'with', 'from', 'as', 'down', 'about', 'under', 'between', 'through', 'after', 'before', 'without', 'against', 'during', 'around', 'among',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here',
    'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',
    'what', 'which', 'who', 'whom', 'whose', 'why', 'where', 'when', 'how',
    'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
    'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
    'not', 'no', 'yes', 'just', 'too', 'very', 'really',
    'movie', 'film', 'cinema', 'frame', 'guess', 'scene'
  ]),

  normalize(text) {
    if (!text) return '';
    let t = String(text).toLowerCase();
    // Normalize unicode diacritics / accents (e.g. Amélie -> Amelie)
    t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Remove year patterns like (1968) or 1968
    t = t.replace(/\(\d{4}\)|\b\d{4}\b/g, '');
    // Replace '&' with 'and'
    t = t.replace(/&/g, ' and ');
    // Remove all punctuation except alphanumeric and whitespace
    t = t.replace(/[^\w\s]/g, ' ');
    // Normalize word numbers and roman numerals to digits for consistent matching
    t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, m => {
      const map = { 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10' };
      return map[m] || m;
    });
    t = t.replace(/\b(ii|iii|iv|v)\b/g, m => {
      const map = { 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5' };
      return map[m] || m;
    });
    // Strip leading common articles
    t = t.replace(/^(the|a|an|el|la|le|les)\s+/i, '').trim();
    // Collapse multiple spaces
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  },

  levenshtein(s1, s2) {
    if (s1.length < s2.length) return this.levenshtein(s2, s1);
    if (s2.length === 0) return s1.length;
    let prev = [];
    for (let i = 0; i <= s2.length; i++) prev[i] = i;
    for (let i = 0; i < s1.length; i++) {
      let curr = [i + 1];
      for (let j = 0; j < s2.length; j++) {
        let ins = prev[j + 1] + 1;
        let del = curr[j] + 1;
        let sub = prev[j] + (s1[i] === s2[j] ? 0 : 1);
        curr[j + 1] = Math.min(ins, del, sub);
      }
      prev = curr;
    }
    return prev[s2.length];
  },

  canonicalWord(w) {
    if (!w) return '';
    if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) {
      return w.slice(0, -1);
    }
    return w;
  },

  isWordMatch(w1, w2) {
    if (!w1 || !w2) return false;
    if (w1 === w2) return true;
    const c1 = this.canonicalWord(w1);
    const c2 = this.canonicalWord(w2);
    if (c1 === c2) return true;

    const lenDiff = Math.abs(c1.length - c2.length);
    if (lenDiff > 2) return false;

    if (Math.min(c1.length, c2.length) >= 4) {
      const dist = this.levenshtein(c1, c2);
      if (Math.max(c1.length, c2.length) <= 6 && dist <= 1) return true;
      if (Math.max(c1.length, c2.length) > 6 && dist <= 2) return true;
    }
    return false;
  },

  getSignificantWords(normalizedStr) {
    if (!normalizedStr) return [];
    return normalizedStr.split(' ')
      .map(w => w.trim())
      .filter(w => w.length >= 3 && !this.STOP_WORDS.has(w));
  },

  isMatch(guess, answer) {
    if (!guess || !answer) return false;
    const nGuess = this.normalize(guess);
    const nAns = this.normalize(answer);
    if (!nGuess || !nAns) return false;

    // 1. Exact normalized match
    if (nGuess === nAns) return true;

    // Direct compact comparison without spaces (e.g. "spiderman" vs "spider man", "wall e" vs "walle")
    const compactGuess = nGuess.replace(/\s+/g, '');
    const compactAns = nAns.replace(/\s+/g, '');
    if (compactGuess === compactAns) return true;
    if (Math.abs(compactGuess.length - compactAns.length) <= 2) {
      const cDist = this.levenshtein(compactGuess, compactAns);
      if (compactAns.length <= 6 && cDist <= 1) return true;
      if (compactAns.length > 6 && cDist <= 2) return true;
    }

    // 2. Whole-string Levenshtein distance (for full phrase typos)
    const lenDiff = Math.abs(nGuess.length - nAns.length);
    if (lenDiff <= 3) {
      const dist = this.levenshtein(nGuess, nAns);
      if (nAns.length <= 4) {
        if (dist === 0) return true;
      } else if (nAns.length <= 8) {
        if (dist <= 1) return true;
      } else if (nAns.length <= 15) {
        if (dist <= 2) return true;
      } else {
        if (dist <= 3) return true;
      }
    }

    // 3. Subtitle handling
    if (answer.includes(':') || answer.includes(' - ') || answer.includes('–')) {
      const parts = answer.split(/[:–]|\s-\s/).map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        if (this.isMatch(guess, part)) return true;
      }
    }

    // 4. Token-by-token alignment
    const gWords = this.getSignificantWords(nGuess);
    const aWords = this.getSignificantWords(nAns);
    if (aWords.length > 0 && gWords.length >= aWords.length) {
      let allFound = true;
      for (const aW of aWords) {
        if (!gWords.some(gW => this.isWordMatch(gW, aW))) {
          allFound = false;
          break;
        }
      }
      if (allFound) return true;
    }

    return false;
  },

  isSpoiler(messageText, targetAnswer) {
    const normMsg = this.normalize(messageText);
    const normTarget = this.normalize(targetAnswer);

    if (!normMsg || !normTarget) return false;
    if (this.isMatch(normMsg, normTarget)) return true;

    // Check if substantial distinct words from target are leaked
    const targetWords = this.getSignificantWords(normTarget);
    for (const word of targetWords) {
      if (word.length >= 4 && normMsg.includes(word)) return true;
    }
    return false;
  },

  generateMaskedHint(answer) {
    if (!answer) return '???';
    const cleanAnswer = answer.replace(/\(\d{4}\)/g, '').trim();
    const words = cleanAnswer.split(' ');
    return words.map(word => {
      const chars = word.split('');
      const unmaskedCount = Math.max(1, Math.floor(chars.length * 0.4));
      const indicesToReveal = new Set();
      indicesToReveal.add(0);

      while (indicesToReveal.size < unmaskedCount && indicesToReveal.size < chars.length) {
        indicesToReveal.add(Math.floor(Math.random() * chars.length));
      }

      return chars.map((ch, idx) => {
        if (/[^a-zA-Z0-9]/.test(ch)) return ch;
        return indicesToReveal.has(idx) ? ch : '_';
      }).join(' ');
    }).join('   ');
  }
};

module.exports = FuzzyMatcher;
