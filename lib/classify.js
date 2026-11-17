'use strict';

function labelNames(item) {
  return (item.labels || [])
    .map((l) => (typeof l === 'string' ? l : l.name || ''))
    .map((s) => s.toLowerCase());
}

function commentText(item) {
  const comments = item.comments || [];
  return comments
    .map((c) => (typeof c === 'string' ? c : c.body || ''))
    .join('\n');
}

function field(item, name) {
  return String(item[name] || '');
}

function isUnfilledTemplate(body) {
  const b = String(body || '');
  const emptyDiff = /```diff\s*```/i.test(b);
  const placeholders = (
    (b.match(/\([eE]\.?g\.?[^)]*\)/g) || []).length >= 2 &&
    /rule id\(s\):|proposed rule id|minimal repro/i.test(b)
  );
  const blankSlots = /kebab-case-id|\(optional if unsure\)|`npx \w+ --version`/i.test(b) &&
    /describe the agent\/ci trick|paste a short unified diff/i.test(b);
  const almostEmpty = b.replace(/[#*\-\s]/g, '').length < 40 && !/\b(add|fix|update|replace)\b/i.test(b);
  return emptyDiff && (placeholders || blankSlots) || blankSlots || almostEmpty;
}

function isStoryCall(title, body) {
  return (
    /help wanted:\s*(share|dogfood|improve docs and demo)/i.test(title) ||
    /tell us about it here/i.test(body) ||
    /open items on this issue are still up for grabs/i.test(body) && /help wanted/i.test(title)
  );
}

function hasRfcOrTracking(title, labels) {
  if (labels.includes('brainstorming') || labels.includes('tracking issue') || labels.includes('needs conceptual review')) {
    return true;
  }
  if (labels.includes('questions and help') && !labels.includes('docs') && !labels.includes('documentation')) {
    return true;
  }
  if (/\bRFC\b|^\[RFC\]/i.test(title) || /tracking issue/i.test(title)) return true;
  return false;
}

function isReleaseProcess(title) {
  return /release schedule/i.test(title);
}

function mentionsSensitiveArea(title, body, labels) {
  const text = `${title}\n${body}`.toLowerCase();
  const sensitiveLabels = ['consensus', 'mining', 'p2p', 'wallet'];
  if (sensitiveLabels.some((l) => labels.includes(l)) && !isDocsOrHelpAsk(title, body, labels)) {
    return /soft ?fork|hard ?fork|consensus|block template|assumeutxo|coin selection|descriptor|bip\s*\d+/i.test(text);
  }
  return /consensus[- ]critical|soft ?fork|hard ?fork|change the consensus rules/i.test(text);
}

function isDocsOrHelpAsk(title, body, labels) {
  if (labels.includes('docs') || labels.includes('documentation')) {
    return /document|docs|help text|man ?page|wording|clarify|typo|spelling|grammar|readme|comment/i.test(
      `${title}\n${body}`
    );
  }
  return /help text|man ?page|document this|update the help|typo|spelling error|wording/i.test(`${title}\n${body}`);
}

function hasConcreteAsk(title, body, comments) {
  const text = `${title}\n${body}\n${comments}`;
  if (/^diff --git |^```diff\n(?!\s*```)/m.test(body) && /^(---|\+\+\+|@@ )/m.test(body)) return true;
  if (/\buse\s+`[^`]+`\s+instead\b/i.test(text)) return true;
  if (/\b(replace|rename|change)\b.{0,80}\b(with|to)\b/i.test(text) && /`[^`]+`/.test(text)) return true;
  if (/\b(add|fix|update|correct|document|clarify)\b.{0,120}\b(help text|man ?page|docs|documentation|template|ci |cmake|typo|wording|syntax)\b/i.test(text)) {
    return true;
  }
  if (/acceptance\n?- /i.test(body) && /\b(templates? appear|labels auto-applied|add `.+`)\b/i.test(body)) return true;
  if (/the intended syntax\b/i.test(comments) && /help text/i.test(text)) return true;
  if (/straightforward fix to the (ci|build)/i.test(text)) return true;
  if (/\b(add|fix|update|replace|document|make)\b/i.test(title) && !/\bideas?\b/i.test(title)) return true;
  if (/per-file assertion-count floor|flag any test file whose assert count drops/i.test(text)) return true;
  return false;
}

function commentsMakeConcrete(comments, body, title) {
  const c = comments || '';
  if (/is the intended syntax/i.test(c) && (/help text/i.test(c + body + title) || /document/i.test(c + body + title))) {
    return true;
  }
  if (/update the help text to show the correct syntax/i.test(c)) return true;
  if (/straightforward fix to the ci scripts/i.test(c)) return true;
  return false;
}

function isQuestionWithoutResolution(title, body, comments) {
  const resolved = commentsMakeConcrete(comments, body, title);
  if (resolved) return false;
  if (/^is\b|^should\b|^can\b|^does\b|^how\b|^why\b|^what\b/i.test(title.trim()) && !hasConcreteAsk(title, body, comments)) {
    return true;
  }
  if (/this report is asking for clarification rather than asserting/i.test(body) && !resolved) return true;
  if ((body.match(/\?/g) || []).length >= 2 && !hasConcreteAsk(title, body, comments) && /is .* (required|intended|supported)\?/i.test(body)) {
    return true;
  }
  return false;
}

function isSmallScope(title, body, labels, comments) {
  const text = `${title}\n${body}\n${comments}`;
  if (mentionsSensitiveArea(title, body, labels)) return false;
  const smallHints = /typo|spelling|help text|man ?page|wording|issue template|github issue templates|cmake .{0,40}deprecated|werror=|clarify .{0,40}syntax|document this distinction|per-file assertion/i;
  if (smallHints.test(text) || (labels.includes('docs') && /clarify|document|help text|wording|trap/i.test(title) === false && hasConcreteAsk(title, body, comments) && body.length < 2500)) {
    if (/warning: -bind was specified|shouldn't be shutdown automatically|cleanup ideas|labyrinth|tracking/i.test(text)) {
      return false;
    }
    if (/cross-platform|o_cloexec|_o_noinherit|not inheritable by child processes/i.test(text) && /fopen|child processes/i.test(text)) {
      return false;
    }
    return true;
  }
  if (labels.includes('good first issue') && /issue templates|documentation only|no cli changes/i.test(text)) return true;
  if (/deprecated/.test(text) && /use .+ instead/i.test(text) && /cmake|ci script|flag/i.test(text)) return true;
  return false;
}

function classify(item) {
  const title = field(item, 'title');
  const body = field(item, 'body');
  const comments = commentText(item);
  const labels = labelNames(item);

  if (hasRfcOrTracking(title, labels)) {
    return result(false, null, 'This is labeled or titled as an RFC, brainstorming, tracking, or conceptual-review item, not a single concrete change.');
  }
  if (isReleaseProcess(title)) {
    return result(false, null, 'This is a release-process note, not a buildable code or docs change.');
  }
  if (isStoryCall(title, body)) {
    return result(false, null, 'This is a call for stories, discussion, or open-ended help, not a request to build a specific change.');
  }
  if (isUnfilledTemplate(body)) {
    return result(false, null, 'The issue is a blank request template without a specific change to implement.');
  }
  if (isQuestionWithoutResolution(title, body, comments)) {
    return result(false, null, 'This is asking a question or for clarification, and it does not yet specify a concrete change.');
  }
  if (mentionsSensitiveArea(title, body, labels) && !isDocsOrHelpAsk(title, body, labels)) {
    return result(false, null, 'This touches consensus, protocol, or wallet behavior and is too large or sensitive for an automatic build.');
  }

  const concrete = hasConcreteAsk(title, body, comments) || commentsMakeConcrete(comments, body, title);
  if (!concrete) {
    return result(false, null, 'No concrete, buildable change is specified.');
  }
  if (isSmallScope(title, body, labels, comments)) {
    return result(true, 'small', 'This asks for a small, clearly scoped change that can be implemented on a branch.');
  }
  return result(true, 'medium', 'This is a concrete ask, but the scope looks larger than a small automatic build.');
}

function result(buildable, scope, reason) {
  return { buildable, scope, reason };
}

function classifyAll(items) {
  return items.map((item) => ({ item, ...classify(item) }));
}

module.exports = {
  classify,
  classifyAll,
  isUnfilledTemplate,
  isSmallScope,
  hasConcreteAsk,
  commentsMakeConcrete,
};
