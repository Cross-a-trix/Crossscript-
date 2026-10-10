// ===================== CrossScript interpreter =====================
// Syntax: command.name{arg}{arg}...   Comments: $$ to end of line

class CSError extends Error {
  constructor(line, msg) { super(`Line ${line}: ${msg}`); }
}

// Step 1: turn source text into a list of statements {name, args, line}
function parseCrossScript(src) {
  const stmts = [];
  const n = src.length;
  let i = 0, line = 1;

  while (i < n) {
    const ch = src[i];
    if (ch === "\n") { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "$" && src[i + 1] === "$") {          // comment
      while (i < n && src[i] !== "\n") i++;
      continue;
    }

    const startLine = line;
    let name = "";
    while (i < n && /[A-Za-z0-9_.]/.test(src[i])) name += src[i++];
    if (!name) throw new CSError(line, `Unexpected character '${ch}'`);

    const args = [];
    while (true) {
      let j = i;
      while (j < n && (src[j] === " " || src[j] === "\t")) j++;
      if (src[j] !== "{") break;
      i = j + 1;
      let depth = 1, arg = "";
      while (i < n) {
        const c = src[i];
        if (c === "\n") line++;
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
        arg += c;
        i++;
      }
      if (depth > 0) throw new CSError(startLine, `Missing closing '}' in ${name}`);
      args.push(arg);
    }
    stmts.push({ name, args, line: startLine });
  }
  return stmts;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getVar(vars, name, line) {
  if (!Object.prototype.hasOwnProperty.call(vars, name))
    throw new CSError(line, `Variable '${name}' is not defined`);
  return vars[name];
}

// Resolves a value written in var.def: number, 'quoted text', ~variable, or plain text
function parseValue(raw, vars, line) {
  const t = raw.trim();
  if (t.startsWith("~")) {
    const nm = t.slice(1);
    if (!NAME_RE.test(nm)) throw new CSError(line, `Invalid variable name '${nm}'`);
    return getVar(vars, nm, line);
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  if (t !== "" && !isNaN(Number(t))) return Number(t);
  return raw;
}

// Resolves out.printvar argument: 'text' and ~name pieces, joined together
function resolvePrintVar(raw, vars, line) {
  let out = "", i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      const end = raw.indexOf("'", i + 1);
      if (end === -1) throw new CSError(line, "Missing closing ' in text");
      out += raw.slice(i + 1, end);
      i = end + 1;
    } else if (c === "~") {
      let j = i + 1, nm = "";
      while (j < n && /[A-Za-z0-9_]/.test(raw[j])) nm += raw[j++];
      if (!NAME_RE.test(nm)) throw new CSError(line, "Expected a variable name after '~'");
      out += String(getVar(vars, nm, line));
      i = j;
    } else {
      throw new CSError(line, `out.printvar expects 'text' or ~name, found '${c}'`);
    }
  }
  return out;
}

function expectArgs(st, count) {
  if (st.args.length !== count)
    throw new CSError(st.line, `${st.name} expects ${count} argument(s) in {}, got ${st.args.length}`);
}

// Step 2: run the statements
async function runCrossScript(source, io) {
  const stmts = parseCrossScript(source);   // syntax errors show before anything runs
  const vars = {};

  for (const st of stmts) {
    switch (st.name) {
      case "out.print":
        expectArgs(st, 1);
        io.print(st.args[0]);
        break;

      case "var.def": {
        expectArgs(st, 2);
        const name = st.args[0].trim();
        if (!NAME_RE.test(name))
          throw new CSError(st.line, `Invalid variable name '${name}' (use letters, digits, _; no leading digit)`);
        vars[name] = parseValue(st.args[1], vars, st.line);
        break;
      }

      case "out.printvar":
        expectArgs(st, 1);
        io.print(resolvePrintVar(st.args[0], vars, st.line));
        break;

      default:
        throw new CSError(st.line, `Unknown command '${st.name}'`);
    }
  }
}
