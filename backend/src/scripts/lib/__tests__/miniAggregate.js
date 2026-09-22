// Test helper for vendorReport.test.js — not used by the app.
// Minimal MongoDB aggregation evaluator — only the stages/operators the
// vendor report uses, with MongoDB semantics for nulls, missing fields,
// BSON comparison order and IST date parts.
const isOp = (o) => o && typeof o === "object" && !Array.isArray(o) && !(o instanceof Date) && Object.keys(o).length === 1 && Object.keys(o)[0].startsWith("$");
const get = (doc, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
const setPath = (doc, path, v) => {
  const ks = path.split("."); let o = doc;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = v;
};
const rank = (v) => (v instanceof String ? 3 : v === undefined || v === null ? 1 : typeof v === "number" ? 2 : typeof v === "string" ? 3 : v instanceof Date ? 9 : typeof v === "boolean" ? 8 : Array.isArray(v) ? 5 : 4);
const cmp = (a, b) => {
  if (a instanceof String) a = a.valueOf();
  if (b instanceof String) b = b.valueOf();
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) return 0;
  if (a instanceof Date) return a - b;
  if (typeof a === "object") return JSON.stringify(a).localeCompare(JSON.stringify(b));
  return a < b ? -1 : a > b ? 1 : 0;
};
const eqv = (a, b) => cmp(a, b) === 0;
const IST = 330 * 60000;
const ev = (e, doc) => {
  if (typeof e === "string" && e.startsWith("$")) return get(doc, e.slice(1));
  if (Array.isArray(e)) return e.map((x) => ev(x, doc));
  if (!isOp(e)) {
    if (e && typeof e === "object" && !(e instanceof Date)) return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, ev(v, doc)]));
    return e;
  }
  const [op, a] = Object.entries(e)[0];
  const A = () => a.map((x) => ev(x, doc));
  switch (op) {
    case "$ifNull": for (const x of a) { const v = ev(x, doc); if (v !== null && v !== undefined) return v; } return null;
    case "$arrayElemAt": { const arr = ev(a[0], doc); return Array.isArray(arr) ? arr[a[1]] : null; }
    case "$add": { const v = A(); if (v.some((x) => x == null)) return null; return v.reduce((s, x) => s + x, 0); }
    case "$subtract": { const [x, y] = A(); if (x == null || y == null) return null; if (x instanceof Date && y instanceof Date) return x - y; return x - y; }
    case "$divide": { const [x, y] = A(); if (x == null || y == null) return null; return x / y; }
    case "$max": { const src = Array.isArray(a) ? A() : ev(a, doc); const v = (Array.isArray(src) ? src : [src]).filter((x) => x != null); return v.length ? v.reduce((m, x) => (cmp(x, m) > 0 ? x : m)) : null; }
    case "$size": { const v = ev(a, doc); if (!Array.isArray(v)) throw new Error("$size needs array"); return v.length; }
    case "$filter": { const arr = ev(a.input, doc); if (arr == null) return null; return arr.filter((x) => ev(a.cond, { ...doc, ["$" + a.as]: x })); }
    case "$map": { const arr = ev(a.input, doc); if (arr == null) return null; return arr.map((x) => ev(a.in, { ...doc, ["$" + a.as]: x })); }
    case "$eq": { const [x, y] = A(); return eqv(x, y); }
    case "$gt": { const [x, y] = A(); return cmp(x, y) > 0; }
    case "$gte": { const [x, y] = A(); return cmp(x, y) >= 0; }
    case "$lt": { const [x, y] = A(); return cmp(x, y) < 0; }
    case "$in": { const [x, arr] = A(); if (!Array.isArray(arr)) throw new Error("$in needs array"); return arr.some((y) => eqv(x, y)); }
    case "$and": return A().every(Boolean);
    case "$cond": return ev(a[0], doc) ? ev(a[1], doc) : ev(a[2], doc);
    case "$toString": { const v = ev(a, doc); return v == null ? null : String(v); }
    case "$toUpper": { const v = ev(a, doc); return v == null ? "" : String(v).toUpperCase(); }
    case "$trim": { const v = ev(a.input, doc); if (v == null) return null; if (typeof v !== "string") throw new Error("$trim needs string"); return v.trim(); }
    case "$type": { const v = ev(a, doc); return v === undefined ? "missing" : v === null ? "null" : typeof v === "string" ? "string" : v instanceof Date ? "date" : typeof v === "number" ? "double" : "object"; }
    case "$regexMatch": { const v = ev(a.input, doc); if (typeof v !== "string") throw new Error("$regexMatch input must be string, got " + v); return new RegExp(a.regex, a.options || "").test(v); }
    case "$year": case "$month": {
      const d = ev(a.date, doc); if (!(d instanceof Date)) return null;
      const z = a.timezone === "Asia/Kolkata" ? new Date(d.getTime() + IST) : d;
      return op === "$year" ? z.getUTCFullYear() : z.getUTCMonth() + 1;
    }
    default: throw new Error("unsupported expression " + op);
  }
};
const matchVal = (v, cond) => {
  if (cond instanceof RegExp) return typeof v === "string" && cond.test(v);
  if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith("$"))) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case "$in": return arg.some((x) => eqv(v, x));
        case "$nin": return !arg.some((x) => eqv(v, x));
        case "$ne": return !eqv(v, arg);
        case "$gte": return v != null && rank(v) === rank(arg) && cmp(v, arg) >= 0;
        case "$lte": return v != null && rank(v) === rank(arg) && cmp(v, arg) <= 0;
        case "$regex": return typeof v === "string" && new RegExp(arg, cond.$options || "").test(v);
        case "$options": return true;
        default: throw new Error("unsupported query op " + op);
      }
    });
  }
  return eqv(v, cond);
};
const matches = (doc, q) => Object.entries(q).every(([k, c]) => {
  if (k === "$or") return c.some((s) => matches(doc, s));
  if (k === "$and") return c.every((s) => matches(doc, s));
  if (k === "$expr") return Boolean(ev(c, doc));
  return matchVal(get(doc, k), c);
});
const clone = (d) => (d instanceof Date ? new Date(d) : Array.isArray(d) ? d.map(clone) : d && typeof d === "object" ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, clone(v)])) : d);
const acc = (spec, docs) => {
  const [op, e] = Object.entries(spec)[0];
  const vals = docs.map((d) => ev(e, d));
  switch (op) {
    case "$sum": return vals.reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
    case "$first": return vals.length ? (vals[0] === undefined ? null : vals[0]) : null;
    case "$addToSet": { const out = []; vals.forEach((v) => { if (v !== undefined && !out.some((x) => eqv(x, v))) out.push(v); }); return out; }
    case "$min": { const v = vals.filter((x) => x != null); return v.length ? v.reduce((m, x) => (cmp(x, m) < 0 ? x : m)) : null; }
    case "$max": { const v = vals.filter((x) => x != null); return v.length ? v.reduce((m, x) => (cmp(x, m) > 0 ? x : m)) : null; }
    case "$avg": { const v = vals.filter((x) => typeof x === "number"); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
    default: throw new Error("unsupported accumulator " + op);
  }
};
function run(pipeline, docs, db) {
  let out = docs.map(clone);
  for (const st of pipeline) {
    const [k, s] = Object.entries(st)[0];
    if (k === "$match") out = out.filter((d) => matches(d, s));
    else if (k === "$set") out = out.map((d) => { const n = clone(d); for (const [f, x] of Object.entries(s)) setPath(n, f, ev(x, d)); return n; });
    else if (k === "$unset") out = out.map((d) => { const n = clone(d); (Array.isArray(s) ? s : [s]).forEach((f) => delete n[f]); return n; });
    else if (k === "$lookup") out = out.map((d) => { const lv = get(d, s.localField); return { ...d, [s.as]: (db[s.from] || []).filter((f) => eqv(get(f, s.foreignField), lv === undefined ? null : lv)).map(clone) }; });
    else if (k === "$unwind") { const p = (typeof s === "string" ? s : s.path).slice(1); const keep = typeof s === "object" && s.preserveNullAndEmptyArrays; out = out.flatMap((d) => { const arr = get(d, p); if (!Array.isArray(arr) || !arr.length) return keep ? [d] : []; return arr.map((x) => { const n = clone(d); setPath(n, p, x); return n; }); }); }
    else if (k === "$group") {
      const groups = new Map();
      out.forEach((d) => { const id = ev(s._id, d); const key = JSON.stringify(id ?? null); if (!groups.has(key)) groups.set(key, { id: id === undefined ? null : id, docs: [] }); groups.get(key).docs.push(d); });
      out = [...groups.values()].map(({ id, docs: g }) => { const r = { _id: id }; for (const [f, sp] of Object.entries(s)) if (f !== "_id") r[f] = acc(sp, g); return r; });
    }
    else if (k === "$sort") { const keys = Object.entries(s); out = [...out].sort((a, b) => { for (const [f, dir] of keys) { const c = cmp(get(a, f), get(b, f)); if (c) return c * dir; } return 0; }); }
    else if (k === "$limit") out = out.slice(0, s);
    else if (k === "$count") out = out.length ? [{ [s]: out.length }] : [];
    else if (k === "$project") out = out.map((d) => { const n = {}; if (s._id !== 0) n._id = d._id; for (const [f, x] of Object.entries(s)) { if (f === "_id") continue; if (x === 1 || x === true) { const v = get(d, f); if (v !== undefined) n[f] = v; } else { const v = ev(x, d); if (v !== undefined) n[f] = v; } } return n; });
    else if (k === "$facet") out = [Object.fromEntries(Object.entries(s).map(([f, p]) => [f, run(p, out, db)]))];
    else throw new Error("unsupported stage " + k);
  }
  return out;
}
module.exports = { run, matches };
